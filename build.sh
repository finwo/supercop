#!/bin/sh

# Reset/fetch submodules
git submodule update --force --init --recursive

# Apply patches
( cd lib/supercop && patch -p1 < ../../patch/supercop/00-single-file-compile.patch )

# Compile
clang \
  --target=wasm32 \
  -emit-llvm \
  -fvisibility=hidden \
  -c \
  -S \
  -Ofast \
  supercop.c
llc \
  -march=wasm32 \
  -filetype=obj \
  -O3 \
  supercop.ll
wasm-ld \
  --no-entry \
  --import-memory \
  --export-dynamic \
  --strip-all \
  -o supercop.wasm \
  supercop.o

# Make a .js version of the binaries
cat <<EOJS > supercop.wasm.js
module.exports = Buffer.from('$(base64 -w 0 < supercop.wasm)', 'base64');
EOJS
