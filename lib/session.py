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
import functools

from google.appengine.ext import db

from cosmopolite.lib import models


@db.transactional(xg=True)
def CreateClientAndProfile(client_id, google_user):
  if google_user:
    # We're going to need a profile for this user regardless
    profile = models.Profile.FindOrCreate(google_user)
  else:
    profile = None

  client = models.Client.get_by_key_name(client_id)

  if not client:
    # First time seeing this client; create it
    if not profile:
      # Create an anonymous profile
      profile = models.Profile()
      profile.put()
    client = models.Client(key_name=client_id, profile=profile)
    client.put()
    return (client, None)

  if not profile:
    # No Google user, whatever profile we had is fine
    return (client, None)

  if (profile.key() !=
      models.Client.profile.get_value_for_datastore(client)):
    # Google user doesn't match. Create a new profile, ask our caller to
    # merge profiles outside the transaction
    old_profile = client.profile
    client.profile = profile
    client.put()
    return (client, old_profile)

  # Everything already exists and matches
  return (client, None)


def session_required(handler):
  """Find or create a session for this user.

  Find or create a Client and Profile for this user. Muck with the return value
  to wrap it in an object that contains session info for the client.

  Make sure to wrap this in google_user_xsrf_protection.
  """
  @functools.wraps(handler)
  def FindOrCreateSession(self):
    self.client, old_profile = CreateClientAndProfile(
        self.request_json['client_id'], self.verified_google_user)
    logging.info('Client: %s', self.client.key().name())
    logging.info('Profile: %s',
        models.Client.profile.get_value_for_datastore(self.client).id())
    if old_profile:
      self.client.profile.MergeFrom(old_profile)

    return handler(self)

  return FindOrCreateSession
