const crypto = require('crypto');
const test   = require('tape');
const lib    = require('../index');

test('Key Exchange',async t => {
  t.plan(1);

  const AliceSeed   = crypto.randomBytes(32);
  const BobSeed     = crypto.randomBytes(32);
  // const CharlieSeed = crypto.randomBytes(32);

  const Alice   = await lib.createKeyPair(AliceSeed);
  const Bob     = await lib.createKeyPair(BobSeed);
  // const Charlie = await lib.createKeyPair(CharlieSeed);

  const AliceBobSecret = await lib.keyExchange(Alice.publicKey, Bob.secretKey);
  const BobAliceSecret = await lib.keyExchange(Bob.publicKey, Alice.secretKey);

  t.ok(AliceBobSecret.equals(BobAliceSecret), 'Alice and Bob generate the same shared secret');
});
