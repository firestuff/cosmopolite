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
# Instance
#
# Subject
# ↳ Message
# ↳ Pin (⤴︎ Instance)
# ↳ Subscription (⤴︎ Instance)


class DuplicateMessage(Exception):
  pass


class AccessDenied(Exception):
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

  @classmethod
  def FromProfile(cls, profile):
    client = cls(parent=profile)
    client.put()
    return client

  @classmethod
  def FromGoogleUser(cls, google_user):
    profile = Profile.FromGoogleUser(google_user)
    return cls.FromProfile(profile)


class Instance(db.Model):
  active = db.BooleanProperty(required=True, default=False)

  @classmethod
  @db.transactional()
  def FromID(cls, instance_id):
    return cls.get_by_key_name(instance_id)

  @classmethod
  @db.transactional()
  def FindOrCreate(cls, instance_id):
    instance = cls.FromID(instance_id)
    if instance:
      return instance
    else:
      return cls(key_name=instance_id).put()


class Subject(db.Model):

  name = db.StringProperty(required=True)
  readable_only_by = db.ReferenceProperty(
      reference_class=Profile, collection_name='readable_subject_set')
  writable_only_by = db.ReferenceProperty(
      reference_class=Profile, collection_name='writable_subject_set')

  next_message_id = db.IntegerProperty(required=True, default=1)

  @classmethod
  def FindOrCreate(cls, subject):
    if 'readable_only_by' in subject:
      readable_only_by = Profile.get(subject['readable_only_by'])
    else:
      readable_only_by = None

    if 'writable_only_by' in subject:
      writable_only_by = Profile.get(subject['writable_only_by'])
    else:
      writable_only_by = None

    subjects = (
        cls.all()
        .filter('name =', subject['name'])
        .filter('readable_only_by =', readable_only_by)
        .filter('writable_only_by =', writable_only_by)
        .fetch(1))
    if subjects:
      return subjects[0]
    subject = cls(
        name=subject['name'],
        readable_only_by=readable_only_by,
        writable_only_by=writable_only_by)
    subject.put()
    return subject

  @db.transactional()
  def GetRecentMessages(self, num_messages):
    query = (
        Message.all()
        .ancestor(self)
        .order('-id_'))
    if num_messages <= 0:
      num_messages = None
    return reversed(query.fetch(limit=num_messages))

  @db.transactional()
  def GetMessagesSince(self, last_id):
    query = (
        Message.all()
        .ancestor(self)
        .filter('id_ >', last_id)
        .order('id_'))
    return list(query)

  @db.transactional()
  def GetPins(self):
    query = (
        Pin.all()
        .ancestor(self))
    return list(query)

  @db.transactional()
  def PutMessage(self, message, sender, sender_message_id):
    """Internal helper for SendMessage().

    Unless/until channel.send_message becomes transactional, we have to finish
    the datastore work (and any retries) before we start transmitting to
    channels.
    """
    # We have to reload the Subject inside the transaction to get transactional
    # ID generation
    subject = Subject.get(self.key())

    # sender_message_id should be universal across all subjects, but we check
    # it within just this subject to allow in-transaction verification.
    messages = (
        Message.all()
        .ancestor(subject)
        .filter('sender_message_id =', sender_message_id)
        .fetch(1))
    if messages:
      raise DuplicateMessage(sender_message_id)

    message_id = subject.next_message_id
    subject.next_message_id += 1
    subject.put()

    obj = Message(
        parent=subject,
        message=message,
        sender=sender,
        sender_message_id=sender_message_id,
        id_=message_id)
    obj.put()

    return (obj, list(Subscription.all().ancestor(subject)))

  def VerifyWritable(self, sender):
    writable_only_by = Subject.writable_only_by.get_value_for_datastore(self)
    if (writable_only_by and
        writable_only_by != sender):
      raise AccessDenied

  def SendMessage(self, message, sender, sender_message_id):
    self.VerifyWritable(sender)
    obj, subscriptions = self.PutMessage(message, sender, sender_message_id)
    event = obj.ToEvent()
    for subscription in subscriptions:
      subscription.SendMessage(event)

  @db.transactional(xg=True)
  def PutPin(self, message, sender, sender_message_id, instance):
    """Internal helper for Pin()."""
    # Reload the subject and instance to establish a barrier
    subject = Subject.get(self.key())
    instance = Instance.get(instance.key())

    # sender_message_id should be universal across all subjects, but we check
    # it within just this subject to allow in-transaction verification.
    pins = (
        Pin.all()
        .ancestor(subject)
        .filter('sender_message_id =', sender_message_id)
        .fetch(1))
    if pins:
      raise DuplicateMessage(sender_message_id)

    obj = Pin(
        parent=subject,
        message=message,
        sender=sender,
        sender_message_id=sender_message_id,
        instance=instance)
    obj.put()

    return (obj, list(Subscription.all().ancestor(subject)))

  def Pin(self, message, sender, sender_message_id, instance):
    self.VerifyWritable(sender)
    obj, subscriptions = self.PutPin(
        message, sender, sender_message_id, instance)
    event = obj.ToEvent()
    for subscription in subscriptions:
      subscription.SendMessage(event)

  @db.transactional(xg=True)
  def RemovePin(self, sender, sender_message_id, instance):
    # Reload the subject and instance to establish a barrier
    subject = Subject.get(self.key())
    instance = Instance.get(instance.key())

    pins = (
        Pin.all()
        .ancestor(subject)
        .filter('sender =', sender)
        .filter('sender_message_id =', sender_message_id)
        .filter('instance =', instance))

    events = []
    for pin in pins:
      events.append(pin.ToEvent(event_type='unpin'))
      pin.delete()

    return (events, list(Subscription.all().ancestor(subject)))

  def Unpin(self, sender, sender_message_id, instance):
    self.VerifyWritable(sender)
    events, subscriptions = self.RemovePin(sender, sender_message_id, instance)
    for event in events:
      for subscription in subscriptions:
        subscription.SendMessage(event)

  def ToDict(self):
    ret = {
      'name': self.name,
    }
    readable_only_by = Subject.readable_only_by.get_value_for_datastore(self)
    if readable_only_by:
      ret['readable_only_by'] = readable_only_by
    writable_only_by = Subject.writable_only_by.get_value_for_datastore(self)
    if writable_only_by:
      ret['writable_only_by'] = writable_only_by
    return ret


class Subscription(db.Model):
  # parent=Subject

  instance = db.ReferenceProperty(reference_class=Instance, required=True)

  @classmethod
  @db.transactional()
  def FindOrCreate(cls, subject, client, instance, messages=0, last_id=None):
    readable_only_by = (
        Subject.readable_only_by.get_value_for_datastore(subject))
    if (readable_only_by and
        readable_only_by != client.parent_key()):
      raise AccessDenied

    subscriptions = (
        cls.all(keys_only=True)
        .ancestor(subject)
        .filter('instance =', instance)
        .fetch(1))
    if not subscriptions:
      cls(parent=subject, instance=instance).put()
    events = [m.ToEvent() for m in subject.GetPins()]
    if messages:
      events.extend(m.ToEvent() for m in subject.GetRecentMessages(messages))
    if last_id is not None:
      events.extend(m.ToEvent() for m in subject.GetMessagesSince(last_id))
    return events

  @classmethod
  @db.transactional()
  def Remove(cls, subject, instance):
    subscriptions = (
        cls.all()
        .ancestor(subject)
        .filter('instance =', instance))
    for subscription in subscriptions:
      subscription.delete()

  def SendMessage(self, msg):
    instance_key = Subscription.instance.get_value_for_datastore(self)
    channel.send_message(
        str(instance_key.name()),
        json.dumps(msg, default=utils.EncodeJSON))


class Message(db.Model):
  # parent=Subject

  created = db.DateTimeProperty(required=True, auto_now_add=True)
  message = db.TextProperty(required=True)
  sender = db.ReferenceProperty(required=True, reference_class=Profile)
  sender_message_id = db.StringProperty(required=True)
  # id is reserved
  id_ = db.IntegerProperty(required=True)

  def ToEvent(self):
    return {
      'event_type':   'message',
      'id':           self.id_,
      'sender':       str(Message.sender.get_value_for_datastore(self)),
      'subject':      self.parent().ToDict(),
      'created':      self.created,
      'message':      self.message,
    }


class Pin(db.Model):
  # parent=Subject

  created = db.DateTimeProperty(required=True, auto_now_add=True)
  instance = db.ReferenceProperty(required=True, reference_class=Instance)
  sender = db.ReferenceProperty(required=True, reference_class=Profile)
  message = db.TextProperty(required=True)
  sender_message_id = db.StringProperty(required=True)

  def ToEvent(self, event_type='pin'):
    return {
      'event_type':  event_type,
      'id':          str(self.key()),
      'sender':      str(Pin.sender.get_value_for_datastore(self)),
      'subject':     self.parent().ToDict(),
      'created':     self.created,
      'message':     self.message,
    }

  def Delete(self):
    self.parent().Unpin(self.sender, self.sender_message_id, self.instance)
