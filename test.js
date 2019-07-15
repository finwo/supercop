const isBuffer = require('is-buffer');
const test     = require('tape');
const lib      = require('./index');

test('Type checks', t => {
  t.plan(7);
  t.is((!!lib) && (typeof lib)   , 'object'  , 'supercop is an object'         );
  t.is(typeof lib._randomBytes   , 'function', 'export helper: _randomBytes'   );
  t.is(typeof lib._checkArguments, 'function', 'export helper: _checkArguments');
  t.is(typeof lib.createSeed     , 'function', 'export method: createSeed'     );
  t.is(typeof lib.createKeyPair  , 'function', 'export method: createKeyPair'  );
  t.is(typeof lib.sign           , 'function', 'export method: sign'           );
  t.is(typeof lib.verify         , 'function', 'export method: verify'         );
});

test('Random bytes generation',async t => {
  t.plan(4);

  const randomBytes32 = await lib._randomBytes(32);
  const randomBytes64 = await lib._randomBytes(64);

  t.is(isBuffer(randomBytes32), true, 'Random32 is a buffer');
  t.is(isBuffer(randomBytes64), true, 'Random64 is a buffer');
  t.is(randomBytes32.length   , 32  , 'Random32 is 32 bytes long');
  t.is(randomBytes64.length   , 64  , 'Random64 is 64 bytes long');
});

test('Argument validation',async t => {
  t.plan(14);

  // We'll not throw in this test
  const callback = function(err) {
    if (!err) return false;
    if (err instanceof Error) return err.message;
    return err;
  };

  // Variables to test with
  const undef          = undefined;
  const rightSeed      = await lib._randomBytes(32);
  const wrongSeed      = await lib._randomBytes(33);
  const rightPublicKey = await lib._randomBytes(32);
  const wrongPublicKey = await lib._randomBytes(33);
  const rightSecretKey = await lib._randomBytes(64);
  const wrongSecretKey = await lib._randomBytes(65);
  const randomMessage  = await lib._randomBytes(1024);

  t.is(await lib._checkArguments(null                         , callback), 'Expected object, null given'    , 'Failure on null argument');
  t.is(await lib._checkArguments('some string'                , callback), 'Expected object, string given'  , 'Failure on string argument');
  t.is(await lib._checkArguments(callback                     , callback), 'Expected object, function given', 'Failure on function argument');
  t.is(await lib._checkArguments({ seed     : undef          }, callback), 'Seed is not a buffer'           , 'Failure on undefined seed');
  t.is(await lib._checkArguments({ seed     : rightSeed      }, callback), false                            , 'Success on 32-byte seed');
  t.is(await lib._checkArguments({ seed     : wrongSeed      }, callback), 'Seed must be 32 bytes'          , 'Failure on 33-byte seed');
  t.is(await lib._checkArguments({ publicKey: undef          }, callback), 'Public key is not a buffer'     , 'Failure on undefined public key');
  t.is(await lib._checkArguments({ publicKey: rightPublicKey }, callback), false                            , 'Success on 32-byte public key');
  t.is(await lib._checkArguments({ publicKey: wrongPublicKey }, callback), 'Public key must be 32 bytes'    , 'Failure on 33-byte public key');
  t.is(await lib._checkArguments({ secretKey: undef          }, callback), 'Secret key is not a buffer'     , 'Failure on undefined secret key');
  t.is(await lib._checkArguments({ secretKey: rightSecretKey }, callback), false                            , 'Success on 64-byte secret key');
  t.is(await lib._checkArguments({ secretKey: wrongSecretKey }, callback), 'Secret key must be 64 bytes'    , 'Failure on 65-byte secret key');
  t.is(await lib._checkArguments({ message  : undef          }, callback), 'Message is not a buffer'        , 'Failure on undefined message');
  t.is(await lib._checkArguments({ message  : randomMessage  }, callback), false                            , 'Success on buffer message');
});

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

test('Signatures',async t => {
  t.plan(2);

  const seed      = await lib.createSeed();
  const keys      = await lib.createKeyPair(seed);
  const signature = await lib.sign(Buffer.from('hello there m8'), keys.publicKey, keys.secretKey);

  t.is(isBuffer(signature), true, 'Signature is a buffer');
  t.is(signature.length   , 64  , 'Signature\'s length is 64 bytes');
});

test('Verify',async t => {
  t.plan(4);

  const seed         = await lib.createSeed();
  const keys         = await lib.createKeyPair(seed);
  const messageBuf   = Buffer.from('hello there m8');
  const messageStr   =             'hello there m8';
  const wrongMessage = await lib._randomBytes(messageBuf.length);

  const signatureBuf = await lib.sign(messageBuf, keys.publicKey, keys.secretKey);
  const signatureStr = await lib.sign(messageStr, keys.publicKey, keys.secretKey);

  t.is(Buffer.compare(signatureBuf, signatureStr), 0, 'String and buffer sourced signature match');

  const wrongSeed = await lib.createSeed();
  const wrongKeys = await lib.createKeyPair(wrongSeed);

  t.is(await lib.verify(signatureBuf, messageBuf, keys.publicKey)     , true , 'Signature verified message');
  t.is(await lib.verify(signatureBuf, wrongMessage, keys.publicKey)   , false, 'Different messaged does not verify');
  t.is(await lib.verify(signatureBuf, messageBuf, wrongKeys.publicKey), false, 'Different public key does not verify');
});
