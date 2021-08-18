const crypto = require('crypto');
const test   = require('tape');
const lib    = require('../index');

test('Verify',async t => {
  t.plan(4);

  const seed         = crypto.randomBytes(32);
  const keys         = await lib.createKeyPair(seed);
  const messageBuf   = Buffer.from('hello there m8');
  const messageStr   =             'hello there m8';
  const wrongMessage = await lib._randomBytes(messageBuf.length);

  const signatureBuf = await lib.sign(messageBuf, keys.publicKey, keys.secretKey);
  const signatureStr = await lib.sign(messageStr, keys.publicKey, keys.secretKey);

  t.is(Buffer.compare(signatureBuf, signatureStr), 0, 'String and buffer sourced signature match');

  const wrongSeed = crypto.randomBytes(32);
  const wrongKeys = await lib.createKeyPair(wrongSeed);

  t.is(await lib.verify(signatureBuf, messageBuf, keys.publicKey)     , true , 'Signature verified message');
  t.is(await lib.verify(signatureBuf, wrongMessage, keys.publicKey)   , false, 'Different messaged does not verify');
  t.is(await lib.verify(signatureBuf, messageBuf, wrongKeys.publicKey), false, 'Different public key does not verify');
});

