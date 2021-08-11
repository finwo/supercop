const isBuffer = require('is-buffer');
const crypto   = require('crypto');
const test     = require('tape');
const lib      = require('../index');

test('Signature generation',async t => {
  t.plan(2);

  const seed      = crypto.randomBytes(32);
  const keys      = await lib.createKeyPair(seed);
  const signature = await lib.sign(Buffer.from('hello there m8'), keys.publicKey, keys.secretKey);

  t.is(isBuffer(signature), true, 'Signature is a buffer');
  t.is(signature.length   , 64  , 'Signature\'s length is 64 bytes');
});

