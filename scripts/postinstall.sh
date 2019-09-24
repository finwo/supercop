#!/usr/bin/env bash

# Ensure bash in approot
[ "$BASH" ] || exec bash $0 "$@"
cd "$(dirname "$0")/.."

# Reset values in package.json
scripts/json.js --file package.json set contributors []

# Update contibutors list
git log --pretty="%ce %cn" | sort | uniq -c | while read line; do
  arr=($line)

  # Decompose
  commits=${arr[0]}
  email=${arr[1]}
  name="${arr[@]:2}"

  # Push contributor to package.json
  scripts/json.js --file package.json push contributors "$(cat <<EOF
{
  "name": "$name",
  "email": "$email",
  "contributions": $commits
}
EOF
)"
done

# Build client
[ -d lib/client ] && {
  ( cd lib/client && git checkout package.json && git reset --hard HEAD && git pull origin master && npm install && npm run build );
  cp lib/client/dist/* public;
} || echo -en ""
