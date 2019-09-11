#define ED25519_NO_SEED

#define export __attribute__((visibility("default")))

#include "lib/c/memset.c"
#include "lib/c/malloc.c"

/* #include "lib/supercop/src/add_scalar.c" */
#include "lib/supercop/src/fe.c"
#include "lib/supercop/src/ge.c"
/* #include "lib/supercop/src/key_exchange.c" */
#include "lib/supercop/src/keypair.c"
#include "lib/supercop/src/sc.c"
/* #include "lib/supercop/src/seed.c" */
#include "lib/supercop/src/sha512.c"
#include "lib/supercop/src/sign.c"
#include "lib/supercop/src/verify.c"

export void create_keypair(unsigned char *public_key, unsigned char *private_key, const unsigned char *seed){
  ed25519_create_keypair(public_key, private_key, seed);
}

export void sign(unsigned char *signature, const unsigned char *message, size_t message_len, const unsigned char *public_key, const unsigned char *private_key){
  ed25519_sign(signature, message, message_len, public_key, private_key);
}

export int verify(const unsigned char *signature, const unsigned char *message, size_t message_len, const unsigned char *public_key){
  return ed25519_verify(signature, message, message_len, public_key);
}

export void * _malloc(int n) {
  return malloc(n);
}

export void _free(void * p) {
  free(p);
}
