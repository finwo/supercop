#!/bin/sh

arch=wasm32
target=${arch}


# # Reset/fetch submodules
# git submodule update --force --init --recursive

# Apply patches
( cd lib/supercop && patch -p1 < ../../patch/supercop/00-single-file-compile.patch )

# Build libc
( cd lib/matter && make clean && make -e TARGET=${target} )

clang \
  -nostdinc \
  --target=${target} \
  -emit-llvm \
  -fvisibility=hidden \
  -fno-builtin \
  -Ilib/matter/include \
  -Ilib/matter/arch/${target}/include \
  -c \
  -S \
  -Os \
  supercop.c || exit 1
llc \
  -march=${arch} \
  -filetype=obj \
  -O3 \
  supercop.ll || exit 1
wasm-ld \
  --no-entry \
  --import-memory \
  --export-dynamic \
  --strip-all \
  -o supercop.wasm \
  -Llib/matter \
  -lmatter \
  supercop.o || exit 1

# Make a .js version of the binaries
cat <<EOJS > supercop.wasm.js
module.exports = Buffer.from('$(base64 -w 0 < supercop.wasm)', 'base64');
EOJS
