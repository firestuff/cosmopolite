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

from google.appengine.api import channel
from google.appengine.ext import db

from cosmopolite.lib import auth
from cosmopolite.lib import models
from cosmopolite.lib import security
from cosmopolite.lib import session
from cosmopolite.lib import utils

import config


class SetValue(webapp2.RequestHandler):
  @utils.chaos_monkey
  @utils.returns_json
  @utils.local_namespace
  @security.google_user_xsrf_protection
  @security.weak_security_checks
  @session.session_required
  @db.transactional()
  def post(self):
    entry_key = self.request.get('key')
    entry_value = self.request.get('value')
    public = (self.request.get('public') == 'true')

    entries = (models.StateEntry.all()
               .ancestor(self.client.parent_key())
               .filter('entry_key =', entry_key)
               .fetch(1))
    if entries:
      entry = entries[0]
      entry.entry_value = entry_value
      entry.public = public
    else:
      entry = models.StateEntry(
          parent=self.client.parent_key(),
          entry_key=entry_key,
          entry_value=entry_value,
          public=public)

    entry.put()
    msg = entry.ToMessage()
    clients = (models.Client.all()
               .ancestor(self.client.parent_key()))
    for client in clients:
      client.SendMessage(msg)

    return {}


class CreateChannel(webapp2.RequestHandler):
  @utils.chaos_monkey
  @utils.returns_json
  @utils.local_namespace
  @security.google_user_xsrf_protection
  @security.weak_security_checks
  @session.session_required
  def post(self):
    token = channel.create_channel(
        client_id=str(self.client.key()),
        duration_minutes=config.CHANNEL_DURATION_SECONDS / 60)
    messages = [x.ToMessage()
                for x in self.client.parent().GetStateEntries()]
    if self.verified_google_user:
      messages.append({
          'message_type': 'login',
          'google_user':  self.verified_google_user.email(),
      })
    else:
      messages.append({
          'message_type': 'logout',
      })

    return {
      'token': token,
      'messages': messages,
    }


app = webapp2.WSGIApplication([
  (config.URL_PREFIX + '/api/createChannel', CreateChannel),
  (config.URL_PREFIX + '/api/setValue', SetValue),
])
