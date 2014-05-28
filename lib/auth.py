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

import hashlib
import hmac
import random
import string

from google.appengine.ext import db


class BadSignature(Exception):
  pass


class AuthKey(db.Model):
  auth_key = db.ByteStringProperty(required=True)
  live = db.BooleanProperty(required=True, default=True)


_KEY_CHARS = string.ascii_letters + string.digits
_KEY_LENGTH = 64
_AUTH_KEY = []

def GetAuthKey():
  if _AUTH_KEY:
    return _AUTH_KEY[0]

  auth_keys = AuthKey.all().filter('live =', True).fetch(1)
  if auth_keys:
    auth_key = auth_keys[0].auth_key
  else:
    auth_key = ''.join(random.choice(_KEY_CHARS) for _ in xrange(_KEY_LENGTH))
    AuthKey(auth_key=auth_key).put()

  _AUTH_KEY.append(auth_key)
  return auth_key


def Sign(value):
  sig = hmac.new(GetAuthKey(), str(value), hashlib.sha512) 
  return '%s:%s' % (value, sig.hexdigest())


def Parse(token):
  if not token:
    return None
  value, sig_digest = token.split(':', 1)
  if token != Sign(value):
    raise BadSignature
  return value


def ParseKey(token):
  if not token:
    return None
  return db.Key(encoded=Parse(token))
