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


def google_user_xsrf_protection(handler):
  """Validate google user cookie.

  We can't trust that the action being requested is being made by this user due
  to XSRF concerns (since google user is stored in a cookie). We have to make
  sure that this user can actually receive responses, so we ask them to pass a
  second token about their user that we can validate.
  """

  @functools.wraps(handler)
  def ValidateGoogleUser(self):
    self.verified_google_user = None

    google_user = users.get_current_user()
    if not google_user:
      return handler(self)

    google_user_id = auth.Parse(self.request_json.get('google_user_id', None))
    if (not google_user_id or 
        google_user_id != google_user.user_id()):
      return {
        'status': 'retry',
        'google_user_id': auth.Sign(google_user.user_id()),
      }

    self.verified_google_user = google_user
    return handler(self)

  return ValidateGoogleUser


def weak_security_checks(handler):

  @functools.wraps(handler)
  def CheckOriginHeader(self):
    origin = self.request.headers.get('Origin')
    if origin:
      host = self.request.headers.get('Host')
      possible_origins = {
        'http://%s' % host,
        'https://%s' % host,
      }
      if origin not in possible_origins:
        self.error(403)
        self.response.out.write('Origin/Host header mismatch')
        return
    return handler(self)

  return CheckOriginHeader
