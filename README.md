# supercop

[orlp/ed25519](https://github.com/orlp/ed25519) patched and compiled using [dcodeio/webassembly](https://github.com/dcodeio/webassembly)

## Examples

### Signing and verifying data

```js
const lib     =       require('supercop');
const seed    =       lib.createSeed();
const keypair = await lib.createKeyPair(seed);
const msg     =       Buffer.from('hello there');
const sig     = await keypair.sign(msg);

console.log(await keypair.verify(sig, msg)); // true
```

### Storing keypairs

```js
const lib     =       require('supercop');
const fs      =       require('fs');
const seed    =       lib.createSeed();
const keypair = await lib.createKeyPair();

fs.writeFileSync('keys.json', JSON.stringify({
  publicKey: keypair.publicKey.toString('base64'),
  secretKey: keypair.secretKey.toString('base64'),
});
```

### Loading keypairs

```js
const lib = require('supercop');
const fs  = require('fs');

const base64keys = require('./keys.json');
const keypair = lib.keyPairFrom({
  publicKey: Buffer.from(base64keys.publicKey, 'base64'),
  secretKey: Buffer.from(base64keys.secretKey, 'base64'),
});
```

## API

### lib.createSeed()

Generates 32-byte seed using `Math.random`. Using a different random-generator
which is cryptographically secure is strongly advised.

### lib.keyPairFrom( data )

Generates a keypair containing the `.sign` and `.verify` functions

### lib.createKeyPair( seed )

Generates a keypair from the provided 32-byte seed with the following
properties:

- arguments:
  - `seed` - a 32-byte byffer
- returns:
  - `keypair.publicKey` - A 32-byte public key as a buffer
  - `keypair.secretKey` - A 64-byte secret key as a buffer
  - `keypair.sign`      - Function to sign a message using the keypair
  - `keypair.verify`    - Function to verify a signature using the keypair

### lib.sign( msg, publicKey, secretKey )

Sign a message using the given keypair.

- arguments:
  - `msg`       - A buffer representing the message
  - `publicKey` - A 32-byte public key as a buffer
  - `secretKey` - A 64-byte secret key as a buffer
- returns:
  - `signature` - A 64-byte buffer

### lib.verify( sig, msg, publicKey )

TODO

### keypair.sign( msg )

TODO

### keypair.verify( sig, msg )

TODO
