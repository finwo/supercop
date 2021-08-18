const test = require('tape');
const lib  = require('../index');

test('Export types', t => {
  t.plan(7);
  t.is((!!lib) && (typeof lib)   , 'object'  , 'supercop is an object'         );
  t.is(typeof lib._randomBytes   , 'function', 'export helper: _randomBytes'   );
  t.is(typeof lib._checkArguments, 'function', 'export helper: _checkArguments');
  t.is(typeof lib.createSeed     , 'function', 'export method: createSeed'     );
  t.is(typeof lib.createKeyPair  , 'function', 'export method: createKeyPair'  );
  t.is(typeof lib.sign           , 'function', 'export method: sign'           );
  t.is(typeof lib.verify         , 'function', 'export method: verify'         );
});
