#!/bin/sh

curl \
  --silent \
  --data compilation_level=ADVANCED_OPTIMIZATIONS \
  --data output_format=json \
  --data output_info=errors \
  --data output_info=warnings \
  --data language=ECMASCRIPT5 \
  --data warning_level=verbose \
  --data externs_url=https://raw.githubusercontent.com/google/closure-compiler/master/contrib/externs/jquery-1.8.js \
  --data-urlencode "js_code@cosmopolite.js" \
  http://closure-compiler.appspot.com/compile
echo

gjslint --strict cosmopolite.js
gjslint --strict --nojsdoc test.js
