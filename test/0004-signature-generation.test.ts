import tap = require('tap');
import pbkdf2 = require('pbkdf2');
import KeyPair from '../src/index';

(async () => {

  const seed      = pbkdf2.pbkdf2Sync('password', 'NaCl', 1, 32, 'sha512');
  const kp        = await KeyPair.create(seed);
  const signature = await kp.sign('message');

  tap.ok(Buffer.isBuffer(signature), 'Generated signature is a buffer');
  tap.ok(signature.length == 64    , 'Generated signature\'s length is 64 bytes');

  // Verify the same signature is always generated from that one seed + message
  tap.ok(signature.toString('hex') == '9eac98c07b296598e90c665a3fb875387166f77752ed1735b8de2e32a7dc3679f918bc74acef1f6d7b5756f9fbf436c53f3010f2146076d4536edbb2f54b8403', 'Got expected signature from known key and message');
})();
