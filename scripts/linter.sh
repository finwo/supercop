#!/usr/bin/env bash

# Ensure bash in approot
[ "$BASH" ] || exec bash $0 "$@"
cd "$(dirname "$0")/.."


# Install deps if needed
[ -f ".eslintrc.js"                          ] || cp scripts/.eslintrc.js .
[ -f "node_modules/.bin/eslint"              ] || npm install --save-dev eslint
[ -d "node_modules/eslint-plugin-json"       ] || npm install --save-dev eslint-plugin-json
[ -d "node_modules/eslint-plugin-varspacing" ] || npm install --save-dev eslint-plugin-varspacing

# Whether there as an error
error=0

# Find and lint all javascript files
xargs -n 1 -P $(( $(nproc) + 1 )) scripts/lint.sh "$@" < <( find -name '*.js' | \
  sort | \
  grep -v node_modules | \
  egrep -v "^\.\/api\/_site" | \
  egrep -v "^\.\/frontend\/docroot\/assets\/" | \
  egrep -v "\/dist\/" | \
  egrep -v "^\.\/lib\/js-interpreter\/" | \
  egrep -v "^\.\/public\/" | \
  egrep -v "^\.\/google-cloud-sdk\/" | \
  egrep -v '\/\.eslintrc\.js$' | \
  egrep -v "\.min\.js\$"
) || error=1

# Find and lint all json files
xargs -n 1 -P $(( $(nproc) + 1 )) scripts/lint.sh "$@" < <( find -name '*.json' | \
  sort | \
  grep -v node_modules | \
  egrep -v "^\.\/frontend\/docroot\/assets\/" | \
  egrep -v '\/\.eslintrc\.json$' | \
  egrep -v '\/\.nyc_output\/' | \
  egrep -v "^\.\/google-cloud-sdk\/" | \
  egrep -v '\/bower\.json$'
) || error=1

exit $error
