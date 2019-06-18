#!/bin/sh

emcc supercop.c lib/supercop/src/*.c -o supercop.js -O1
echo "if ('undefined' !== typeof module) module.exports = Module;" >> supercop.js
