const isBuffer = require('is-buffer');
const test     = require('tape');
const lib      = require('../index');

test('Key generation',async t => {
  t.plan(6);

  const seed = await lib.createSeed();

  t.is(isBuffer(seed), true, 'Seed is a buffer'    );
  t.is(seed.length   , 32  , 'Seed\'s length is 32');

  const keys = await lib.createKeyPair(seed);

  t.is(isBuffer(keys.publicKey), true, 'Public key is a buffer'    );
  t.is(keys.publicKey.length   , 32  , 'Public key\'s length is 32');
  t.is(isBuffer(keys.secretKey), true, 'Secret key is a buffer'    );
  t.is(keys.secretKey.length   , 64  , 'Secret key\'s length is 64');
});

