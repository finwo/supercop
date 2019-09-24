#!/usr/bin/env bash

# Ensure bash in approot
[ "$BASH" ] || exec bash $0 "$@"
cd "$(dirname "$0")/.."

# Load assert lib
HAS_ASSERT=
if [ -f "lib/assert/assert.sh" ]; then
  source 'lib/assert/assert.sh'
  HAS_ASSERT=1
fi

# Parse arguments
filename=
opts=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --fix)
      opts+=("--fix")
      ;;
    *)
      filename=$1
      ;;
  esac
  shift
done

node_modules/.bin/eslint --cache "${filename}" ${opts[@]}
if [ "$?" == 0 ]; then
  [ "$HAS_ASSERT" ] && \
    log_success "${filename}" || \
    echo -e "\e[42;30m PASS \e[0m ${filename}"
else
  [ "$HAS_ASSERT" ] && \
    log_failure "${filename}" || \
    echo -e "\e[41;30m FAIL \e[0m ${filename}"
  exit 1
fi
