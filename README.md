# supercop

ed25519 curve operations using [orlp/ed25519](https://github.com/orlp/ed25519) patched and compiled into WebAssembly.

## TL;DR;

For when you don't want to dig through the whole API reference

```typescript
import { createSeed, KeyPair } from 'supercop';

// Create keypairs, usable for keyExchange, signing and verifying
const alice   = await KeyPair.create(createSeed());
const bob     = await KeyPair.create(createSeed());
const charlie = await KeyPair.from(JSON.parse(fs.readFileSync('path-to-file.json')));

// Save bob's key, will become charlie's key in the next run
fs.writeFileSync('path-to-file.json', JSON.stringify(bob));

// Public-only keypairs are possible, usable only for:
// - Verifying a signature
// - Remote side of key exchange
const alicePub = KeyPair.from({ publicKey: alice.publicKey });
const bobPub   = KeyPair.from({ publicKey: bob.publicKey   });

const message = "Hello World!";

// Alice signing the message with her key
const signature = await alice.sign(message);

// Bob verifying the message came from alice
const isValid = await alicePub.verify(signature, message);
console.log({ isValid }); // outputs true

// Generate shared keys on both ends
const aliceShared = await alice.keyExchange(bobPub);
const bobShared   = await bob.keyExchange(alicePub);

// Proof both keys are the same
console.log(Buffer.compare(aliceShared, bobShared) == 0); // outputs true
```

## About

This package provides ed25519/ref10 operations from orlp's implementation into JavaScript/TypeScript in an unopiniated way.

The patching applied is so we can compile it with without relying on emscriptem, but instead go purely for [clang](https://clang.llvm.org/).


## API reference / exports

### type PublicKey: Buffer

Represents a public key in a keypair, simply a 32-byte buffer

### type SecretKey: Buffer

Represents a secret key in a keypair, simply a 64-byte buffer

### type Seed: Buffer

Represents a seed to build a keypair from, simply a 32-byte buffer

### type Signature: Buffer

Represents a signature you can use to verify a message, simply a 64-byte buffer

### function isSeed(data: unknown): data is Seed

Returns whether or not a piece of data can be used as a seed

### function isPublicKey(data: unknown): data is PublicKey

Returns whether or not a piece of data can be used as a public key

### function isSignature(data: unknown): data is Signature

Returns whether or not a piece of data can be used as a signature

### function isSecretKey(data: unknown): data is SecretKey

Returns whether or not a piece of data can be used as a secret key

### function createSeed(): Buffer

Uses `Math.random` to generate a new key. Only use this as a last resort, as `crypto.randomBytes(32)` provides better randomization.

### function createKeyPair(seed: number[] | Seed): Promise&lt;KeyPair&gt;

Build a new KeyPair instance from the given seed.

### function keyPairFrom({ publicKey: number[] | PublicKey, secretKey?: number[] | SecretKey }): KeyPair

Constructs a new KeyPair instance from the key(s) provided you can use to operate with.

### function sign(message: string | Buffer, publicKey: number[] | PublicKey, secretKey: number[] | SecretKey): Promise&lt;Signature&gt;

Sign a message with the given keys, so it can be verified later

### function verify(signature: number[] | Signature, message: string | Buffer, publicKey: number[] | PublicKey): Promise&lt;boolean&gt;

Verify a message/signature combination using the given public key

### function keyExchange(theirPublicKey: number[] | PublicKey | undefined, ourSecretKey: number[] | SecretKey): Promise&lt;Buffer&gt;

Generate a shared secret between 2 key pairs to use as seed for a symmetric encryption algorithm

### class KeyPair

```typescript
class KeyPair {

    // Calls the sign function with the keys stored in the entity
    sign(message: string | Buffer): Promise<Buffer>;

    // Calls the verify function with the keys stored in the entity
    verify(signature: number[] | Signature, message: string | Buffer): Promise<boolean>;

    // Performs key exchange algorithm between the local key and the given key
    // Assumes the local key is 'our' key
    keyExchange(theirPublicKey?: number[] | PublicKey): Promise<Buffer>;

    // Converts the key into something storable to be reconstructed in a later run
    toJSON(): {
        publicKey: number[] | undefined;
        secretKey: number[] | undefined;
    };

    // Generate a (new) keypair from the given seed
    static create(seed: number[] | Seed): Promise<KeyPair>;

    // Reconstruct a keypair from the given data, compatible with the toJSON output format
    static from(data: {
        publicKey: number[] | PublicKey;
        secretKey?: number[] | SecretKey;
    }): KeyPair;
}
```
