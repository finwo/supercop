#!/bin/sh

arch=wasm32
target=${arch}
CC=$(command -v clang clang-8; true)
LC=$(command -v llc llc-8; true)

# Reset/fetch submodules
git submodule update --force --init --recursive

# Apply patches
( cd lib/supercop && patch -p1 < ../../patch/supercop/00-single-file-compile.patch )

# Build libc
( cd lib/matter && make clean && make -e TARGET=${target} )

${CC} \
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

${LC} \
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
module.exports = '$(base64 -w 0 < supercop.wasm)';
EOJS
