#!/usr/bin/env bash

# Ensure bash in approot
[ "$BASH" ] || exec bash $0 "$@"
cd "$(dirname "$0")/.."

# # Fetch the indicated versions
# git submodule update --init --recursive --force

# Checkout master everywhere
git submodule foreach --recursive git checkout master
git submodule foreach --recursive git pull
