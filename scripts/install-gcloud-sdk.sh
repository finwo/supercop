#!/usr/bin/env bash

# Ensure bash in approot
[ "$BASH" ] || exec bash $0 "$@"
cd "$(dirname "$0")/.."

# Ensure curl is there
command -v curl &>/dev/null || \
  scripts/install-system-package.sh curl

# Install if missing
[ -d "${HOME}/google-cloud-sdk" ] || {
  curl https://sdk.cloud.google.com | bash /dev/stdin --disable-prompts >/dev/null
}

# Setup path if not loaded yet
command -v gcloud || {
  export PATH="${HOME}/google-cloud-sdk/bin:${PATH}"
}
