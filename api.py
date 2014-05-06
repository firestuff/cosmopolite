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
  msg = entry.ToMessage()
  clients = (models.Client.all()
             .ancestor(client.parent_key()))
  for client in clients:
    client.SendMessage(msg)

  return {}


def CreateChannel(google_user, client, args):
  token = channel.create_channel(
      client_id=str(client.key()),
      duration_minutes=config.CHANNEL_DURATION_SECONDS / 60)
  messages = [x.ToMessage()
              for x in client.parent().GetStateEntries()]
  if google_user:
    messages.append({
        'message_type': 'login',
        'google_user':  google_user.email(),
    })
  else:
    messages.append({
        'message_type': 'logout',
    })

  return {
    'token': token,
    'messages': messages,
  }


class APIWrapper(webapp2.RequestHandler):

  _COMMANDS = {
      'createChannel': CreateChannel,
      'setValue': SetValue,
  }

  @utils.chaos_monkey
  @utils.expects_json
  @utils.returns_json
  @utils.local_namespace
  @security.google_user_xsrf_protection
  @security.weak_security_checks
  @session.session_required
  def post(self):
    ret = []
    for command in self.request_json['commands']:
      callback = self._COMMANDS[command['command']]
      result = callback(self.verified_google_user, self.client, command.get('arguments', {}))
      ret.append(result)
    return ret


app = webapp2.WSGIApplication([
  (config.URL_PREFIX + '/api', APIWrapper),
])
