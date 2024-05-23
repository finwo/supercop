#define export __attribute__((visibility("default")))

#ifndef __has_builtin         // Optional of course.
  #define __has_builtin(x) 0  // Compatibility with non-clang compilers.
#endif

#include <stdlib.h>

#include "orlp/ed25519.h"

export void create_keypair(unsigned char *public_key, unsigned char *private_key, const unsigned char *seed){
  ed25519_create_keypair(public_key, private_key, seed);
}

export void sign(unsigned char *signature, const unsigned char *message, size_t message_len, const unsigned char *public_key, const unsigned char *private_key){
  ed25519_sign(signature, message, message_len, public_key, private_key);
}

export int verify(const unsigned char *signature, const unsigned char *message, size_t message_len, const unsigned char *public_key){
  return ed25519_verify(signature, message, message_len, public_key);
}

export void key_exchange(unsigned char *shared_secret, const unsigned char *public_key, const unsigned char *private_key) {
  ed25519_key_exchange(shared_secret, public_key, private_key);
}

export void *_malloc(size_t n) {
  return malloc(n);
}

export void _free(void *p) {
  free(p);
}
