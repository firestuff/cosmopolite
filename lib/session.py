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
    return

  client_profile_google_user = client.profile.google_user
  if client_profile_google_user:
    if client_profile_google_user == google_user:
      return
    else:
      client.profile = models.Profile.FromGoogleUser(google_user)
      client.put()
      return

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
    google_profile.MergeFrom(
        models.Client.profile.get_value_for_datastore(client))
    client.profile = google_profile
    client.put()
    return

  # First time signin.
  client_profile = client.profile
  client_profile.google_user = google_user
  client_profile.put()
  return


def session_required(handler):
  """Find or create a session for this user.

  Find or create a Client and Profile for this user. Muck with the return value
  to wrap it in an object that contains session info for the client.

  Make sure to wrap this in google_user_xsrf_protection.
  """

  @functools.wraps(handler)
  def FindOrCreateSession(self):
    client_id = self.request_json['client_id']

    self.client = models.Client.get_by_key_name(client_id)

    if self.client:
      _CheckClientAndGoogleUser(self.client, self.verified_google_user)
    else:
      self.client = models.Client.FromGoogleUser(
          client_id, self.verified_google_user)

    return handler(self)

  return FindOrCreateSession
