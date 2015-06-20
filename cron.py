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

import datetime
import logging
import webapp2

from cosmopolite.lib import models
from cosmopolite.lib import utils

import config


class CleanupPollingInstances(webapp2.RequestHandler):

  @utils.local_namespace
  def get(self):
    cutoff = datetime.datetime.now() - datetime.timedelta(minutes=1)
    query = (
        models.Instance.all()
        .filter('polling =', True)
        .filter('last_poll <', cutoff))
    for instance in query:
      instance.Delete()


app = webapp2.WSGIApplication([
  (config.URL_PREFIX + '/cron/cleanup_polling_instances', CleanupPollingInstances),
])
