import tap = require('tap');
import pbkdf2 = require('pbkdf2');
import KeyPair from '../src/index';

(async () => {

  const seed = pbkdf2.pbkdf2Sync('password', 'NaCl', 1, 32, 'sha512');
  const kp   = await KeyPair.create(seed);

  tap.ok(Buffer.isBuffer(kp.publicKey), 'Created keypair has buffer as publicKey');
  tap.ok(Buffer.isBuffer(kp.secretKey), 'Created keypair has buffer as secretKey');

  // Convince TSC the keys are buffers
  if (!kp.publicKey) throw new Error();
  if (!kp.secretKey) throw new Error();

  tap.ok(kp.publicKey.length == 32, 'Generated publicKey has length of 32 bytes');
  tap.ok(kp.secretKey.length == 64, 'Generated secretKey has length of 64 bytes');

  // Verify the same key is always generated from that one seed
  tap.ok(kp.publicKey.toString('hex') == 'e4dfe299f037f094e9951abb4552977705902b0c42a7153192e803449c70a729', 'Got expected publicKey from known salt');
})();
