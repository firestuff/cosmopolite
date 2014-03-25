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

import webapp2

from google.appengine.api import users

from cosmopolite.lib import security

import config


class Login(webapp2.RequestHandler):
  @security.weak_security_checks
  def get(self):
    self.redirect(users.create_login_url(
        dest_url=config.URL_PREFIX + '/static/login_complete.html'))


class Logout(webapp2.RequestHandler):
  @security.weak_security_checks
  def get(self):
    self.redirect(users.create_logout_url(
        dest_url=config.URL_PREFIX + '/static/logout_complete.html'))


app = webapp2.WSGIApplication([
  (config.URL_PREFIX + '/auth/login', Login),
  (config.URL_PREFIX + '/auth/logout', Logout),
])
