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
import webapp2

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
    instance.active = True
    instance.put()


class OnChannelDisconnect(webapp2.RequestHandler):
  @staticmethod
  @db.transactional()
  def DeleteInstance(instance_id):
    instance = models.Instance.FromID(instance_id)
    ret = instance.key()
    instance.delete()
    return ret

  @utils.local_namespace
  def post(self):
    instance_id = self.request.get('from')
    instance_key = self.DeleteInstance(instance_id)

    subscriptions = models.Subscription.all().filter('instance =', instance_key)
    for subscription in subscriptions:
      subscription.delete()


app = webapp2.WSGIApplication([
  ('/_ah/channel/connected/', OnChannelConnect),
  ('/_ah/channel/disconnected/', OnChannelDisconnect),
])
