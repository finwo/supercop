// This test was built based on a user-submitted bug: https://github.com/finwo/supercop/issues/4

import tap = require('tap');
import KeyPair, { createSeed } from '../src/index';

(async () => {

  const kp = await KeyPair.create(createSeed());

  // Generates 8 loops, from 800..2000
  for(let size = 800; size <= 2200; size += 200) {
    const message       = Buffer.alloc(size);
    const signature_kp  = await kp.sign(message);
    tap.ok(signature_kp.length == 64, `kp.sign(${size}) returns buffer of 64 bytes`);
  }

})();
