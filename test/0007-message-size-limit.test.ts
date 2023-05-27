// This test was built based on a user-submitted bug: https://github.com/finwo/supercop/issues/4

const isBuffer = require('is-buffer');
const crypto   = require('crypto');
const test     = require('tape');
const lib      = require('../index');

test('Message size limit',async t => {
  t.plan(32);

  const seed    = crypto.randomBytes(32);
  const keypair = await lib.createKeyPair(seed);

  // Generates 8 loops, from 800..2000
  let i=0;
  for(let size = 800; size <= 2200; size += 200) {
    const message          = Buffer.alloc(size);
    const signature_kp  = await keypair.sign(message);
    const signature_lib = await lib.sign(message, keypair.publicKey, keypair.secretKey);

    t.ok(isBuffer(signature_kp)  , `kp.sign(${size}) returns buffer`);
    t.ok(isBuffer(signature_lib) , `lib.sign(${size}) returns buffer`);
    t.is(signature_kp.length , 64, `kp.sign(${size}) returns buffer of 64 bytes`);
    t.is(signature_lib.length, 64, `lib.sign(${size}) returns buffer of 64 bytes`);
  }
});
