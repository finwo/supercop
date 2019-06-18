#!/bin/sh

emcc supercop.c lib/supercop/src/*.c -o supercop.js -O1 -s WASM=0
echo "if ('undefined' !== typeof module) module.exports = Module;" >> supercop.js
