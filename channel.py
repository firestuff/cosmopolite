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
import webapp2

from google.appengine.api import channel
from google.appengine.ext import db

from cosmopolite.lib import auth
from cosmopolite.lib import models
from cosmopolite.lib import utils


class OnChannelConnect(webapp2.RequestHandler):
  @utils.local_namespace
  @db.transactional()
  def post(self):
    instance_id = self.request.get('from')
    instance = models.Instance.FromID(instance_id)
    if not instance:
      logging.warning('Channel opened with invalid instance_id: %s', instance_id)
      message = {
        'event_type': 'close',
      }
      channel.send_message(
          instance_id, json.dumps(message, default=utils.EncodeJSON))
      return
    instance.active = True
    instance.put()


class OnChannelDisconnect(webapp2.RequestHandler):
  @utils.local_namespace
  def post(self):
    instance_id = self.request.get('from')
    instance_key = db.Key.from_path('Instance', instance_id)

    subscriptions = list(models.Subscription.all().filter('instance =', instance_key))
    if subscriptions:
      db.delete(subscriptions)

    pins = models.Pin.all().filter('instance =', instance_key)
    for pin in pins:
      pin.Delete()

    db.delete(instance_key)


app = webapp2.WSGIApplication([
  ('/_ah/channel/connected/', OnChannelConnect),
  ('/_ah/channel/disconnected/', OnChannelDisconnect),
])
