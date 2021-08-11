// This test was built based on a user-submitted bug: https://github.com/finwo/supercop/issues/4

const isBuffer = require('is-buffer');
const crypto   = require('crypto');
const test     = require('tape');
const lib      = require('../index');

test('Message hammering',async t => {
  t.plan(1);

  const seed    = crypto.randomBytes(32);
  const keypair = await lib.createKeyPair(seed);

  for(let size = 100; size <= 4096; size++) {
    const message          = Buffer.alloc(size);

    // Intentionally discard signatures, we're just hammering the memory here
    await keypair.sign(message);
    await lib.sign(message, keypair.publicKey, keypair.secretKey);
  }

  t.ok(true, 'Thread survived hammering supercop\'s memory');


});
