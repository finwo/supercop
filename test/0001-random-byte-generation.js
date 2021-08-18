const isBuffer = require('is-buffer');
const test     = require('tape');
const lib      = require('../index');

test('Random byte generation',async t => {
  t.plan(4);

  const randomBytes32 = await lib._randomBytes(32);
  const randomBytes64 = await lib._randomBytes(64);

  t.is(isBuffer(randomBytes32), true, 'Random32 is a buffer');
  t.is(isBuffer(randomBytes64), true, 'Random64 is a buffer');
  t.is(randomBytes32.length   , 32  , 'Random32 is 32 bytes long');
  t.is(randomBytes64.length   , 64  , 'Random64 is 64 bytes long');
});

