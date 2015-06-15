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


def CreateChannel(google_user, client, client_address, instance_id, args):
  instance = models.Instance.FindOrCreate(instance_id, polling=False)
  assert not instance.polling

  token = channel.create_channel(
      client_id=instance_id,
      duration_minutes=config.CHANNEL_DURATION_SECONDS / 60)
  events = []
  if google_user:
    events.append({
      'event_type':  'login',
      'google_user': google_user.email(),
    })
  else:
    events.append({
      'event_type': 'logout',
    })

  return {
    'result': 'ok',
    'token': token,
    'events': events,
  }


def Poll(google_user, client, client_address, instance_id, args):
  instance = models.Instance.FindOrCreate(instance_id, polling=True, active=True)
  assert instance.polling

  # Update last_poll
  instance.save()

  events = []
  if google_user:
    events.append({
      'event_type':  'login',
      'google_user': google_user.email(),
    })
  else:
    events.append({
      'event_type': 'logout',
    })

  for subscription in instance.GetSubscriptions():
    events.extend(subscription.GetEvents(args['ack']))

  return {
    'result': 'ok',
    'events': events,
  }


def Pin(google_user, client, client_address, instance_id, args):
  instance = models.Instance.FromID(instance_id)
  if not instance or not instance.active:
    # Probably a race with the channel opening
    return {
      'result': 'retry',
    }

  subject = args['subject']
  message = args['message']
  sender_message_id = args['sender_message_id']

  try:
    pin = models.Subject.FindOrCreate(subject, client).Pin(
        message,
        models.Client.profile.get_value_for_datastore(client),
        sender_message_id,
        client_address,
        instance,
        subject)
  except models.DuplicateMessage as e:
    logging.warning('Duplicate pin: %s', sender_message_id)
    return {
      'result': 'duplicate_message',
      'message': e.original,
    }
  except models.AccessDenied:
    logging.warning('Pin access denied')
    return {
      'result': 'access_denied',
    }

  return {
    'result': 'ok',
    'pin': pin,
  }


def SendMessage(google_user, client, client_address, instance_id, args):
  subject = args['subject']
  message = args['message']
  sender_message_id = args['sender_message_id']

  try:
    msg = models.Subject.FindOrCreate(subject, client).SendMessage(
        message,
        models.Client.profile.get_value_for_datastore(client),
        sender_message_id,
        client_address,
        subject)
  except models.DuplicateMessage as e:
    logging.warning('Duplicate message: %s', sender_message_id)
    return {
      'result': 'duplicate_message',
      'message': e.original,
    }
  except models.AccessDenied:
    logging.warning('SendMessage access denied')
    return {
      'result': 'access_denied',
    }

  return {
    'result': 'ok',
    'message': msg,
  }


def Subscribe(google_user, client, client_address, instance_id, args):
  instance = models.Instance.FromID(instance_id)
  subject = models.Subject.FindOrCreate(args['subject'], client)
  messages = args.get('messages', 0)
  last_id = args.get('last_id', None)

  try:
    subject.VerifyReadable(models.Client.profile.get_value_for_datastore(client))
  except models.AccessDenied:
    logging.warning('Subscribe access denied')
    return {
      'result': 'access_denied',
    }


  if not instance or not instance.active:
    # Probably a race with the channel opening
    return {
      'result': 'retry',
      'events': subject.GetEvents(messages, last_id, args['subject'], pins=False),
    }

  return {
    'result': 'ok',
    'events': models.Subscription.FindOrCreate(
        subject, client, instance, args['subject'], messages, last_id, instance.polling),
  }


def Unpin(google_user, client, client_address, instance_id, args):
  instance = models.Instance.FromID(instance_id)
  subject = args['subject']
  sender_message_id = args['sender_message_id']

  try:
    models.Subject.FindOrCreate(subject, client).Unpin(
        models.Client.profile.get_value_for_datastore(client),
        sender_message_id,
        instance.key())
  except models.AccessDenied:
    logging.warning('Pin access denied')
    return {
      'result': 'access_denied',
    }

  return {
    'result': 'ok',
  }


def Unsubscribe(google_user, client, client_address, instance_id, args):
  instance = models.Instance.FromID(instance_id)
  subject = models.Subject.FindOrCreate(args['subject'], client)
  models.Subscription.Remove(subject, instance, args['subject'])

  return {
    'result': 'ok',
  }


class APIWrapper(webapp2.RequestHandler):

  _COMMANDS = {
      'createChannel': CreateChannel,
      'pin': Pin,
      'poll': Poll,
      'sendMessage': SendMessage,
      'subscribe': Subscribe,
      'unpin': Unpin,
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
    profile_str = str(
        models.Client.profile.get_value_for_datastore(self.client).id())
    ret = {
        'status': 'ok',
        'profile': profile_str,
        'responses': [],
        'events': [],
    }
    for command in self.request_json['commands']:
      logging.info('Command: %s', command)
      callback = self._COMMANDS[command['command']]
      result = callback(
          self.verified_google_user,
          self.client,
          self.request.remote_addr,
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
