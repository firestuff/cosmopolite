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

import functools

from google.appengine.api import users

from cosmopolite.lib import auth
from cosmopolite.lib import models


def _CheckClientAndGoogleUser(client, google_user):
  if not google_user:
    # Nothing to check. If there's a user on the profile, it can stay there.
    return client

  client_profile_google_user = client.parent().google_user
  if client_profile_google_user:
    if client_profile_google_user == google_user:
      return client
    else:
      # Shared computer? Google account wins.
      return models.Client.FromGoogleUser(google_user)

  # User just signed in. Their anonymous profile gets permanently
  # associated with this Google account.
  profiles = (models.Profile.all()
              .filter('google_user =', google_user)
              .fetch(1))
  if profiles:
    # We can't convert the anonymous profile because there's already
    # a profile for this Google user. Create a new client_id pointing to that
    # profile.
    # TODO(flamingcow): Fetch-then-store uniqueness is a race.
    google_profile = profiles[0]
    google_profile.MergeFrom(client.parent_key())
    return models.Client.FromProfile(google_profile)

  # First time signin.
  client_profile = client.parent()
  client_profile.google_user = google_user
  client_profile.put()
  return client


def session_required(handler):
  """Find or create a session for this user.

  Find or create a Client and Profile for this user. Muck with the return value
  to wrap it in an object that contains session info for the client.

  Make sure to wrap this in google_user_xsrf_protection.
  """

  @functools.wraps(handler)
  def FindOrCreateSession(self):
    client_key = auth.ParseKey(self.request_json.get('client_id', None))

    # The hunt for a Profile begins.
    if client_key:
      self.client = _CheckClientAndGoogleUser(
          models.Client.get(client_key),
          self.verified_google_user)
    else:
      self.client = models.Client.FromGoogleUser(self.verified_google_user)

    ret = {
        'status': 'ok',
        'responses': handler(self),
    }
    if client_key != self.client.key():
      # Tell the client that this changed
      ret['client_id'] = auth.Sign(self.client.key())

    return ret

  return FindOrCreateSession
