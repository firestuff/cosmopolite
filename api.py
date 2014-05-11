# Copyright 2014, Ian Gulliver
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import webapp2

from google.appengine.api import channel
from google.appengine.ext import db

from cosmopolite.lib import auth
from cosmopolite.lib import models
from cosmopolite.lib import security
from cosmopolite.lib import session
from cosmopolite.lib import utils

import config


def CreateChannel(google_user, client, args):
  token = channel.create_channel(
      client_id=str(client.key()),
      duration_minutes=config.CHANNEL_DURATION_SECONDS / 60)
  events = [x.ToEvent() for x in client.parent().GetStateEntries()]
  if google_user:
    events.append({
      'event_type':   'login',
      'google_user':  google_user.email(),
    })
  else:
    events.append({
      'event_type': 'logout',
    })

  return {
    'token': token,
    'events': events,
  }


def SendMessage(google_user, client, args):
  subject = args['subject']
  message = args['message']
  key = args.get('key', None)

  models.Subject.FindOrCreate(subject).SendMessage(message, client.parent_key(), key)

  return {}


@db.transactional()
def SetValue(google_user, client, args):
  entry_key = args['key']
  entry_value = args['value']
  public = (args['public'] == 'true')

  entries = (models.StateEntry.all()
             .ancestor(client.parent_key())
             .filter('entry_key =', entry_key)
             .fetch(1))
  if entries:
    entry = entries[0]
    entry.entry_value = entry_value
    entry.public = public
  else:
    entry = models.StateEntry(
        parent=client.parent_key(),
        entry_key=entry_key,
        entry_value=entry_value,
        public=public)

  entry.put()
  event = entry.ToEvent()
  clients = (models.Client.all()
             .ancestor(client.parent_key()))
  for client in clients:
    client.SendEvent(event)

  return {}


def Subscribe(google_user, client, args):
  subject = models.Subject.FindOrCreate(args['subject'])
  messages = args.get('messages', 0)
  keys = args.get('keys', [])

  ret = {
    'events': models.Subscription.FindOrCreate(subject, client, messages),
  }
  for key in keys:
    message = models.Subject.GetKey(key)
    if message:
      ret['events'].append(message)
  return ret


def Unsubscribe(google_user, client, args):
  subject = models.Subject.FindOrCreate(args['subject'])
  models.Subscription.Remove(subject, client)

  return {}


class APIWrapper(webapp2.RequestHandler):

  _COMMANDS = {
      'createChannel': CreateChannel,
      'sendMessage': SendMessage,
      'setValue': SetValue,
      'subscribe': Subscribe,
      'unsubscribe': Unsubscribe,
  }

  @utils.chaos_monkey
  @utils.expects_json
  @utils.returns_json
  @utils.local_namespace
  @security.google_user_xsrf_protection
  @security.weak_security_checks
  @session.session_required
  def post(self):
    ret = {
        'status': 'ok',
        'responses': [],
        'events': [],
    }
    for command in self.request_json['commands']:
      callback = self._COMMANDS[command['command']]
      result = callback(
          self.verified_google_user,
          self.client,
          command.get('arguments', {}))
      # Magic: if result contains "events", haul them up a level so the
      # client can see them as a single stream.
      ret['events'].extend(result.pop('events', []))
      ret['responses'].append(result)
    return ret


app = webapp2.WSGIApplication([
  (config.URL_PREFIX + '/api', APIWrapper),
])
