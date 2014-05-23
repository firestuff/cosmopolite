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

import logging
import webapp2

from google.appengine.api import channel
from google.appengine.ext import db

from cosmopolite.lib import auth
from cosmopolite.lib import models
from cosmopolite.lib import security
from cosmopolite.lib import session
from cosmopolite.lib import utils

import config


def CreateChannel(google_user, client, instance_id, args):
  instance = models.Instance.FindOrCreate(instance_id, client)

  token = channel.create_channel(
      client_id=str(instance.id()),
      duration_minutes=config.CHANNEL_DURATION_SECONDS / 60)
  events = []
  if google_user:
    events.append({
      'event_type':   'login',
      'profile':      str(client.parent_key()),
      'google_user':  google_user.email(),
    })
  else:
    events.append({
      'event_type': 'logout',
      'profile':      str(client.parent_key()),
    })

  return {
    'token': token,
    'events': events,
  }


def SendMessage(google_user, client, instance_id, args):
  subject = args['subject']
  message = args['message']
  sender_message_id = args['sender_message_id']
  key = args.get('key', None)

  try:
    models.Subject.FindOrCreate(subject).SendMessage(
        message, client.parent_key(), sender_message_id, key)
  except models.DuplicateMessage:
    logging.exception('Duplicate message: %s', sender_message_id)
    return {
      'result': 'duplicate_message',
    }
  except models.AccessDenied:
    logging.exception('SendMessage access denied')
    return {
      'result': 'access_denied',
    }

  return {
    'result': 'ok',
  }


def Subscribe(google_user, client, instance_id, args):
  instance = models.Instance.FromID(instance_id, client)
  subject = models.Subject.FindOrCreate(args['subject'])
  messages = args.get('messages', 0)
  last_id = args.get('last_id', None)
  keys = args.get('keys', [])

  try:
    ret = {
      'result': 'ok',
      'events': models.Subscription.FindOrCreate(
          subject, instance, messages, last_id),
    }
  except models.AccessDenied:
    logging.exception('Subscribe access denied')
    return {
      'result': 'access_denied',
    }

  for key in keys:
    message = subject.GetKey(key)
    if message:
      ret['events'].append(message.ToEvent())

  return ret


def Unsubscribe(google_user, client, instance_id, args):
  instance = models.Instance.FromID(instance_id, client)
  subject = models.Subject.FindOrCreate(args['subject'])
  models.Subscription.Remove(subject, instance)

  return {}


class APIWrapper(webapp2.RequestHandler):

  _COMMANDS = {
      'createChannel': CreateChannel,
      'sendMessage': SendMessage,
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
          self.request_json['instance_id'],
          command.get('arguments', {}))
      # Magic: if result contains "events", haul them up a level so the
      # client can see them as a single stream.
      ret['events'].extend(result.pop('events', []))
      ret['responses'].append(result)
    return ret


app = webapp2.WSGIApplication([
  (config.URL_PREFIX + '/api', APIWrapper),
])
