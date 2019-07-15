#!/bin/sh

# Reset/fetch submodules
git submodule update --force --init --recursive

# Apply patches
( cd lib/supercop && patch -p1 < ../../patch/supercop/00-single-file-compile.patch )

# Compile
node_modules/.bin/wa compile --bare -o supercop.wasm supercop.c
