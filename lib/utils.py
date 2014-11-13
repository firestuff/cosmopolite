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
import functools
import json
import logging
import random
import time

from google.appengine.api import namespace_manager

from cosmopolite import config

from cosmopolite.lib import auth


def expects_json(handler):

  @functools.wraps(handler)
  def ParseInput(self):
    self.request_json = json.load(self.request.body_file)
    return handler(self)

  return ParseInput


def returns_json(handler):

  @functools.wraps(handler)
  def SerializeResult(self):
    json.dump(handler(self), self.response.out, default=EncodeJSON)

  return SerializeResult


def chaos_monkey(handler):

  @functools.wraps(handler)
  def IntroduceFailures(self):
    if random.random() < config.CHAOS_PROBABILITY:
      logging.info('Chaos: returning pre-processing 503')
      self.response.headers['Retry-After'] = '0'
      self.error(503)
      return

    ret = handler(self)

    if random.random() < config.CHAOS_PROBABILITY:
      logging.info('Chaos: returning post-processing 503')
      self.response.headers['Retry-After'] = '0'
      self.error(503)
      return

    return ret

  return IntroduceFailures


def local_namespace(handler):

  @functools.wraps(handler)
  def SetNamespace(self):
    namespace_manager.set_namespace(config.NAMESPACE)
    return handler(self)

  return SetNamespace


def EncodeJSON(o):
  if isinstance(o, datetime.datetime):
    return time.mktime(o.timetuple())
  return json.JSONEncoder.default(o)
