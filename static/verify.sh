#!/bin/sh

curl \
  --silent \
  --data compilation_level=ADVANCED_OPTIMIZATIONS \
  --data output_format=json \
  --data output_info=errors \
  --data output_info=warnings \
  --data language=ECMASCRIPT5 \
  --data warning_level=verbose \
  --data externs_url=https://closure-compiler.googlecode.com/git/contrib/externs/jquery-1.8.js \
  --data-urlencode "js_code@cosmopolite.js" \
  http://closure-compiler.appspot.com/compile
echo

gjslint --strict --disable=0121,0233 cosmopolite.js
