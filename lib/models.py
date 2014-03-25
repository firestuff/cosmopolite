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


# Profile
# ↳ Client
# ↳ StateEntry
#
# Subject
# ↳ Subscription (⤴︎ Client)


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

  @db.transactional(xg=True)
  def MergeFrom(self, source_profile):
    # Merge from another profile into this one, using last_set time as the
    # arbiter.
    my_states = {}
    for state_entry in (StateEntry.all()
                        .ancestor(self)
                        .run()):
      my_states[state_entry.entry_key] = state_entry

    for state_entry in (StateEntry.all()
                        .ancestor(source_profile)
                        .run()):
      my_state_entry = my_states.get(state_entry.entry_key, None)
      if my_state_entry:
        if state_entry.last_set > my_state_entry.last_set:
          # newer, merge in
          my_state_entry.entry_value = state_entry.entry_value
          my_state_entry.put()
      else:
        # entirely new, add
        StateEntry(parent=self,
            entry_key=state_entry.entry_key,
            entry_value=state_entry.entry_value
            ).put()


class Client(db.Model):
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


class StateEntry(db.Model):
  last_set = db.DateTimeProperty(required=True, auto_now=True)
  entry_key = db.StringProperty(required=True)
  entry_value = db.StringProperty(required=True)

  def SendToClient(self, client_id):
    channel.send_message(str(client_id), json.dumps({
        'message_type': 'state',
        'key': self.entry_key,
        'value': self.entry_value,
    }))


class Subject(db.Model):
  name = db.StringProperty(required=True)


class Subscription(db.Model):
  client = db.ReferenceProperty(reference_class=Client)
