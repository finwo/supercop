// This test was built based on a user-submitted bug: https://github.com/finwo/supercop/issues/4

import tap = require('tap');
import KeyPair, { createSeed } from '../src/index';

(async () => {

  const kp = await KeyPair.create(createSeed());

  for(let size = 200; size <= 4096; size += 1) {
    const message = Buffer.alloc(size);
    await kp.sign(message);
  }

  tap.ok(true, 'Thread survived hammering supercop\'s memory');

})();
