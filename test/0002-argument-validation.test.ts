const test     = require('tape');
const lib      = require('../index');

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

