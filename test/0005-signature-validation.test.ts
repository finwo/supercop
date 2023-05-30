import tap = require('tap');
import pbkdf2 = require('pbkdf2');
import KeyPair, { createSeed } from '../src/index';

(async () => {

  const seed   = pbkdf2.pbkdf2Sync('password', 'NaCl', 1, 32, 'sha512');
  const goodKP = await KeyPair.create(seed);
  const badKP  = await KeyPair.create(createSeed());

  const messageBuf = Buffer.from('message');
  const messageStr =             'message';
  const messageBad = Buffer.from(createSeed());

  const signatureBuf = await goodKP.sign(messageBuf);
  const signatureStr = await goodKP.sign(messageStr);

  tap.ok(Buffer.compare(signatureBuf, signatureStr) === 0, 'Buffer and string input generate the same signature');

  tap.ok(await goodKP.verify(signatureBuf, messageBuf), 'Correct signature matches with original message buffer');
  tap.ok(await goodKP.verify(signatureBuf, messageStr), 'Correct signature matches with original message string');
  tap.notOk(await goodKP.verify(signatureBuf, messageBad), 'Correct signature fails with bad message buffer');
  tap.notOk(await badKP.verify(signatureBuf, messageBuf), 'Correct signature fails with original message buffer on different key');
})();
