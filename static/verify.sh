#!/bin/sh

curl \
  --silent \
  --data compilation_level=ADVANCED_OPTIMIZATIONS \
  --data output_format=json \
  --data output_info=errors \
  --data output_info=warnings \
  --data language=ECMASCRIPT6 \
  --data warning_level=verbose \
  --data-urlencode "js_code@cosmopolite.js" \
  http://closure-compiler.appspot.com/compile
echo

gjslint --strict cosmopolite.js
gjslint --strict --nojsdoc test.js
