# -*- coding: utf-8 -*-
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

import json
import logging

from google.appengine.api import channel
from google.appengine.ext import db

import utils


# Profile
# ↳ Client
#
# Subject
# ↳ Message
# ↳ Subscription (⤴︎ Client)


class DuplicateMessage(Exception):
  pass


class Profile(db.Model):
  google_user = db.UserProperty()

  @classmethod
  def FromGoogleUser(cls, google_user):
    if not google_user:
      profile = Profile()
      profile.put()
      return profile

    profiles = Profile.all().filter('google_user =', google_user).fetch(1)
    if profiles:
      return profiles[0]
    else:
      # TODO(flamingcow): Fetch-then-store uniqueness is a race.
      profile = Profile(google_user=google_user)
      profile.put()
      return profile

  def MergeFrom(self, source_profile):
    # This is non-transactional and racy (new messages can be introduced by the
    # old client after we start). This is hard to solve because a) we're not in
    # a single hierarchy and b) we don't revoke the old client ID, so it can
    # still be used.
    for message in Message.all().filter('sender =', source_profile):
      message.sender = self;
      message.put()


class Client(db.Model):
  # parent=Profile

  first_seen = db.DateTimeProperty(required=True, auto_now_add=True)
  channel_active = db.BooleanProperty(required=True, default=False)

  @classmethod
  def FromProfile(cls, profile):
    client = cls(parent=profile)
    client.put()
    return client

  @classmethod
  def FromGoogleUser(cls, google_user):
    profile = Profile.FromGoogleUser(google_user)
    return cls.FromProfile(profile)

  def SendMessage(self, msg):
    self.SendByKey(self.key(), msg)

  @staticmethod
  def SendByKey(key, msg):
    channel.send_message(str(key), json.dumps(msg, default=utils.EncodeJSON))


class Subject(db.Model):

  name = db.StringProperty(required=True)

  @classmethod
  def FindOrCreate(cls, name):
    subjects = cls.all().filter('name =', name).fetch(1)
    if subjects:
      return subjects[0]
    subject = cls(name=name)
    subject.put()
    return subject

  @db.transactional()
  def GetRecentMessages(self, num_messages):
    query = (
        Message.all()
        .ancestor(self)
        .order('-created'))
    if num_messages <= 0:
      num_messages = None
    return reversed(query.fetch(limit=num_messages))

  @db.transactional()
  def GetKey(self, key):
    messages = (
        Message.all()
        .ancestor(self)
        .filter('key_ =', key)
        .order('-created')
        .fetch(1))
    if messages:
      return messages[0]
    return None

  @db.transactional()
  def PutMessage(self, message, sender, sender_message_id, key=None):
    """Internal helper for SendMessage().

    Unless/until channel.send_message becomes transactional, we have to finish
    the datastore work (and any retries) before we start transmitting to
    channels.
    """
    # sender_message_id should be universal across all subjects, but we check
    # it within just this subject to allow in-transaction verification.
    messages = (
        Message.all()
        .ancestor(self)
        .filter('sender_message_id =', sender_message_id)
        .fetch(1))
    if messages:
      raise DuplicateMessage(sender_message_id)

    obj = Message(
        parent=self,
        message=message,
        sender=sender,
        sender_message_id=sender_message_id,
        key_=key)
    obj.put()

    return (
        obj,
        [Subscription.client.get_value_for_datastore(subscription)
         for subscription in Subscription.all().ancestor(self)])

  def SendMessage(self, message, sender, sender_message_id, key=None):
    obj, subscriptions = self.PutMessage(message, sender, sender_message_id, key)
    event = obj.ToEvent()
    for subscription in subscriptions:
      Client.SendByKey(subscription, event)


class Subscription(db.Model):
  # parent=Subject

  client = db.ReferenceProperty(reference_class=Client)

  @classmethod
  @db.transactional()
  def FindOrCreate(cls, subject, client, messages):
    subscriptions = (
        cls.all(keys_only=True)
        .ancestor(subject)
        .filter('client =', client)
        .fetch(1))
    if not subscriptions:
      cls(parent=subject, client=client).put()
    if messages == 0:
      return []
    return [m.ToEvent() for m in subject.GetRecentMessages(messages)]

  @classmethod
  @db.transactional()
  def Remove(cls, subject, client):
    subscriptions = (
        cls.all()
        .ancestor(subject)
        .filter('client =', client))
    for subscription in subscriptions:
      subscription.delete()


class Message(db.Model):
  # parent=Subject

  created = db.DateTimeProperty(required=True, auto_now_add=True)
  message = db.TextProperty(required=True)
  sender = db.ReferenceProperty(required=True, reference_class=Profile)
  sender_message_id = db.StringProperty(required=True)
  # key and key_name are reserved
  key_ = db.StringProperty()

  def ToEvent(self):
    ret = {
      'event_type':   'message',
      'id':           self.key().id(),
      'sender':       str(Message.sender.get_value_for_datastore(self)),
      'subject':      self.parent().name,
      'created':      self.created,
      'message':      self.message,
    }
    if self.key_:
      ret['key'] = self.key_
    return ret
