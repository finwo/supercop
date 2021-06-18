ARCH=wasm32
TARGET=${ARCH}
CC=$(shell command -v clang clang-10 clang-8; true)
LC=$(shell command -v llc llc-10 llc-8; true)
LD=$(shell command -v wasm-ld wasm-ld-10; true)

default: supercop.wasm.js

lib/supercop:
	mkdir -p lib
	git clone https://github.com/orlp/ed25519 lib/supercop
	cd lib/supercop
	bash -c 'cd lib/supercop && patch -p1 < ../../patch/supercop/00-single-file-compile.patch'

lib/matter/libmatter.a:
	mkdir -p lib
	git clone https://github.com/finwo/matter lib/matter
	$(MAKE) -C lib/matter

supercop.ll: lib/matter/libmatter.a lib/supercop
	$(CC) \
		-nostdinc \
		--target=${TARGET} \
		-emit-llvm \
		-fvisibility=hidden \
		-fno-builtin \
		-Ilib/matter/include \
		-Ilib/matter/arch/${TARGET}/include \
		-c \
		-S \
		-Os \
		supercop.c || exit 1

supercop.o: supercop.ll
	$(LC) \
		-march=${arch} \
		-filetype=obj \
		-O3 \
		supercop.ll || exit 1

supercop.wasm: supercop.o lib/matter/libmatter.a
	$(LD) \
		--no-entry \
		--import-memory \
		--export-dynamic \
		--strip-all \
		-o supercop.wasm \
		-Llib/matter \
		-lmatter \
		supercop.o || exit 1

supercop.wasm.js: supercop.wasm
	echo -n "// Built on "          >  supercop.wasm.js
	LC_TIME=en_US date              >> supercop.wasm.js
	echo -n "module.exports = '"    >> supercop.wasm.js
	cat supercop.wasm | base64 -w 0 >> supercop.wasm.js
	echo "';"                       >> supercop.wasm.js

.PHONY: clean
clean:
	rm -f supercop.o
	rm -f supercop.ll
