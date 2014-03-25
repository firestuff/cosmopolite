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
import json
import random

from google.appengine.api import namespace_manager

from cosmopolite import config

from cosmopolite.lib import auth


def returns_json(handler):

  @functools.wraps(handler)
  def SerializeResult(self):
    json.dump(handler(self), self.response.out)

  return SerializeResult


def chaos_monkey(handler):

  @functools.wraps(handler)
  def IntroduceFailures(self):
    if random.random() < config.CHAOS_PROBABILITY:
      self.response.headers['Retry-After'] = '0'
      self.error(503)
      return
    return handler(self)

  return IntroduceFailures


def local_namespace(handler):

  @functools.wraps(handler)
  def SetNamespace(self):
    import logging
    namespace_manager.set_namespace(config.NAMESPACE)
    return handler(self)

  return SetNamespace
