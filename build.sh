#!/bin/sh

# Reset/fetch submodules
git submodule update --force --init --recursive

# Apply patches
( cd lib/supercop && patch -p1 < ../../patch/supercop/00-single-file-compile.patch )

# Compile
node_modules/.bin/wa compile -o supercop.wasm supercop.c "$@"

# Make a .js version of the binaries
cat <<EOJS > supercop.wasm.js
module.exports = Buffer.from('$(base64 -w 0 < supercop.wasm)', 'base64');
EOJS
