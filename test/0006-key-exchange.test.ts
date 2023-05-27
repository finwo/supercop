import tap = require('tap');
import pbkdf2 = require('pbkdf2');
import KeyPair, { createSeed } from '../src/index';

(async () => {

  const seedAlice   = pbkdf2.pbkdf2Sync('alice'  , 'NaCl', 1, 32, 'sha512');
  const seedBob     = pbkdf2.pbkdf2Sync('bob'    , 'NaCl', 1, 32, 'sha512');
  const seedCharlie = pbkdf2.pbkdf2Sync('charlie', 'NaCl', 1, 32, 'sha512');

  const kpAlice   = await KeyPair.create(seedAlice  );
  const kpBob     = await KeyPair.create(seedBob    );
  const kpCharlie = await KeyPair.create(seedCharlie);

  const secretAliceBob = (await kpAlice.keyExchange(kpBob  .publicKey)).toString('hex');
  const secretBobAlice = (await kpBob  .keyExchange(kpAlice.publicKey)).toString('hex');

  const secretAliceCharlie = (await kpAlice  .keyExchange(kpCharlie.publicKey)).toString('hex');
  const secretCharlieAlice = (await kpCharlie.keyExchange(kpAlice  .publicKey)).toString('hex');

  tap.ok(secretAliceBob     == secretBobAlice    , 'Alice <-> Bob secrets match');
  tap.ok(secretAliceCharlie == secretCharlieAlice, 'Alice <-> Charlie secrets match');
  tap.ok(secretAliceBob     != secretAliceCharlie, 'Secret pairs differ from eachother');
})();
