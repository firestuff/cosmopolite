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
import hashlib
import logging
import struct

from google.appengine.api import channel
from google.appengine.api import users
from google.appengine.ext import db

import utils


# Profile
#
# Client (⤴︎ Profile)
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

  _cache = {}

  ADMIN_KEY = db.Key.from_path('Profile', 'admin')

  @classmethod
  @db.transactional()
  def FindOrCreate(cls, google_user):
    key_name = google_user.user_id()
    if key_name in cls._cache:
      return cls._cache[key_name]
    profile = cls.get_by_key_name(key_name)
    if not profile:
      profile = cls(key_name=key_name, google_user=google_user)
      profile.put()
    cls._cache[key_name] = profile
    return profile

  def MergeFrom(self, source_profile):
    # This is non-transactional and racy (new messages can be introduced by the
    # old client after we start). This is hard to solve because we're not in
    # a single hierarchy.
    for message in Message.all().filter('sender =', source_profile):
      message.sender = self;
      message.put()


class Client(db.Model):

  profile = db.ReferenceProperty(reference_class=Profile)
  first_seen = db.DateTimeProperty(required=True, auto_now_add=True)

  @classmethod
  def FromProfile(cls, client_id, profile):
    client = cls(key_name=client_id, profile=profile)
    client.put()
    return client


class Instance(db.Model):
  # key_name=instance_id
  active = db.BooleanProperty(required=True, default=False)

  @classmethod
  def FromID(cls, instance_id):
    logging.info('Instance: %s', instance_id)
    return cls.get_by_key_name(instance_id)

  @classmethod
  def FindOrCreate(cls, instance_id):
    logging.info('Instance: %s', instance_id)
    return cls.get_or_insert(instance_id)


class Subject(db.Model):

  name = db.StringProperty(required=True)
  readable_only_by = db.ReferenceProperty(
      reference_class=Profile, collection_name='readable_subject_set')
  writable_only_by = db.ReferenceProperty(
      reference_class=Profile, collection_name='writable_subject_set')

  next_message_id = db.IntegerProperty(required=True, default=1)

  _cache = {}

  @classmethod
  def _UpdateHashWithString(cls, hashobj, string):
    string = string.encode('utf8')
    hashobj.update(struct.pack('!i', len(string)))
    hashobj.update(string)

  @classmethod
  def _KeyName(cls, subject):
    hashobj = hashlib.sha256()
    cls._UpdateHashWithString(hashobj, subject['name'])
    cls._UpdateHashWithString(hashobj, subject.get('readable_only_by', ''))
    cls._UpdateHashWithString(hashobj, subject.get('writable_only_by', ''))
    return hashobj.hexdigest()

  @classmethod
  def FindOrCreate(cls, subject):
    if 'readable_only_by' in subject:
      if subject['readable_only_by'] == 'admin':
        readable_only_by = Profile.ADMIN_KEY
      else:
        readable_only_by = db.Key(subject['readable_only_by'])
    else:
      readable_only_by = None

    if 'writable_only_by' in subject:
      if subject['writable_only_by'] == 'admin':
        writable_only_by = Profile.ADMIN_KEY
      else:
        writable_only_by = db.Key(subject['writable_only_by'])
    else:
      writable_only_by = None

    key_name = cls._KeyName(subject)
    obj = cls._cache.get(key_name)
    if obj:
      return obj

    obj = cls.get_or_insert(
        key_name,
        name=subject['name'],
        readable_only_by=readable_only_by,
        writable_only_by=writable_only_by)

    cls._cache[key_name] = obj
    return obj

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
  def PutMessage(self, message, sender, sender_message_id, sender_address):
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
        sender_address=sender_address,
        id_=message_id)
    obj.put()

    return (obj, list(Subscription.all().ancestor(subject)))

  def VerifyWritable(self, sender):
    writable_only_by = Subject.writable_only_by.get_value_for_datastore(self)
    if (not users.is_current_user_admin() and
        writable_only_by and
        writable_only_by != sender):
      raise AccessDenied

  def VerifyReadable(self, reader):
    readable_only_by = Subject.readable_only_by.get_value_for_datastore(self)
    if (not users.is_current_user_admin() and
        readable_only_by and
        readable_only_by != reader):
      raise AccessDenied

  def SendMessage(self, message, sender, sender_message_id, sender_address):
    self.VerifyWritable(sender)
    obj, subscriptions = self.PutMessage(
        message, sender, sender_message_id, sender_address)
    event = obj.ToEvent()
    for subscription in subscriptions:
      subscription.SendMessage(event)

  @db.transactional()
  def PutPin(self, message, sender, sender_message_id,
             instance, sender_address):
    """Internal helper for Pin()."""
    # sender_message_id should be universal across all subjects, but we check
    # it within just this subject to allow in-transaction verification.
    pins = (
        Pin.all()
        .ancestor(self)
        .filter('sender_message_id =', sender_message_id)
        .filter('instance =', instance)
        .fetch(1))
    if pins:
      raise DuplicateMessage(sender_message_id)

    obj = Pin(
        parent=self,
        message=message,
        sender=sender,
        sender_message_id=sender_message_id,
        sender_address=sender_address,
        instance=instance)
    obj.put()

    return (obj, list(Subscription.all().ancestor(self)))

  def Pin(self, message, sender, sender_message_id, sender_address, instance):
    self.VerifyWritable(sender)
    obj, subscriptions = self.PutPin(
        message, sender, sender_message_id, instance, sender_address)
    event = obj.ToEvent()
    for subscription in subscriptions:
      subscription.SendMessage(event)

  @db.transactional()
  def RemovePin(self, sender, sender_message_id, instance_key):
    pins = (
        Pin.all()
        .ancestor(self)
        .filter('sender =', sender)
        .filter('sender_message_id =', sender_message_id)
        .filter('instance =', instance_key))

    events = []
    for pin in pins:
      events.append(pin.ToEvent(event_type='unpin'))
      pin.delete()

    return (events, list(Subscription.all().ancestor(self)))

  def Unpin(self, sender, sender_message_id, instance_key):
    self.VerifyWritable(sender)
    events, subscriptions = self.RemovePin(sender, sender_message_id, instance_key)
    for event in events:
      for subscription in subscriptions:
        subscription.SendMessage(event)

  def ToDict(self):
    ret = {
      'name': self.name,
    }
    readable_only_by = Subject.readable_only_by.get_value_for_datastore(self)
    if readable_only_by:
      if readable_only_by == Profile.ADMIN_KEY:
        ret['readable_only_by'] = 'admin'
      else:
        ret['readable_only_by'] = str(readable_only_by)
    writable_only_by = Subject.writable_only_by.get_value_for_datastore(self)
    if writable_only_by:
      if writable_only_by == Profile.ADMIN_KEY:
        ret['writable_only_by'] = 'admin'
      else:
        ret['writable_only_by'] = str(writable_only_by)
    return ret

  @db.transactional()
  def GetEvents(self, messages, last_id):
    events = [m.ToEvent() for m in self.GetPins()]
    if messages:
      events.extend(m.ToEvent() for m in self.GetRecentMessages(messages))
    if last_id is not None:
      events.extend(m.ToEvent() for m in self.GetMessagesSince(last_id))
    return events


class Subscription(db.Model):
  # parent=Subject

  instance = db.ReferenceProperty(reference_class=Instance, required=True)

  @classmethod
  @db.transactional()
  def FindOrCreate(cls, subject, client, instance, messages=0, last_id=None):
    subscriptions = (
        cls.all(keys_only=True)
        .ancestor(subject)
        .filter('instance =', instance)
        .fetch(1))
    if not subscriptions:
      cls(parent=subject, instance=instance).put()
    return subject.GetEvents(messages, last_id)

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
  sender_address = db.StringProperty(required=True)
  # id is reserved
  id_ = db.IntegerProperty(required=True)

  def ToEvent(self):
    return {
      'event_type':        'message',
      'id':                self.id_,
      'sender':            str(Message.sender.get_value_for_datastore(self)),
      'subject':           self.parent().ToDict(),
      'created':           self.created,
      'sender_message_id': self.sender_message_id,
      'message':           self.message,
    }


class Pin(db.Model):
  # parent=Subject

  created = db.DateTimeProperty(required=True, auto_now_add=True)
  instance = db.ReferenceProperty(required=True, reference_class=Instance)
  message = db.TextProperty(required=True)
  sender = db.ReferenceProperty(required=True, reference_class=Profile)
  sender_message_id = db.StringProperty(required=True)
  sender_address = db.StringProperty(required=True)

  def ToEvent(self, event_type='pin'):
    return {
      'event_type':        event_type,
      'id':                str(self.key()),
      'sender':            str(Pin.sender.get_value_for_datastore(self)),
      'subject':           self.parent().ToDict(),
      'created':           self.created,
      'sender_message_id': self.sender_message_id,
      'message':           self.message,
    }

  def Delete(self):
    self.parent().Unpin(
        self.sender, self.sender_message_id,
        Pin.instance.get_value_for_datastore(self))
