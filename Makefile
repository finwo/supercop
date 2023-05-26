ARCH=wasm32
TARGET=${ARCH}
CC=$(shell command -v clang clang-10 clang-8; true)
LC=$(shell command -v llc llc-10 llc-8; true)
LD=$(shell command -v wasm-ld wasm-ld-10; true)

LIBS:=
SRC:=

SRC+=src/supercop.c

override CFLAGS?=-Wall -O2 -D__WORDSIZE=32
override LDFLAGS?=

INCLUDES:=
INCLUDES+=-I src

include lib/.dep/config.mk

SRC:=$(filter-out $(shell realpath lib/orlp/ed25519/src/seed.c), $(SRC))
OBJ:=$(SRC:.c=.o)
LLO:=$(SRC:.c=.ll)

override CFLAGS+=$(INCLUDES)

default: supercop.wasm.js

.PHONY: clean
clean:
	rm -rf $(OBJ)
	rm -rf $(LLO)

%.o: %.c
	${CC} ${CFLAGS} \
		--target=${TARGET} \
		-emit-llvm \
		-fvisibility=hidden \
		-c \
		-S \
		-Os \
		-o $(@:.o=.ll) \
		$(@:.o=.c) || exit 1
	$(LC) \
		-march=${arch} \
		-filetype=obj \
		-O3 \
		-o $@ \
		$(@:.o=.ll) || exit 1

supercop.wasm: $(OBJ)
	echo $(SRC)
	${LD} ${LDFLAGS} \
		--no-entry \
		--import-memory \
		--export-dynamic \
		--strip-all \
		-o $@ \
		$(OBJ) || exit 1

supercop.wasm.js: supercop.wasm
	echo -n "// Built on "       >  supercop.wasm.js
	LC_TIME=en_US date           >> supercop.wasm.js
	echo -n "module.exports = '" >> supercop.wasm.js
	base64 -w 0 < supercop.wasm  >> supercop.wasm.js
	echo "';"                    >> supercop.wasm.js
