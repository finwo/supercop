import tap = require('tap');
import * as lib from '../src/index';
import KeyPair from '../src/index';

tap.ok(((!!lib) && (typeof lib)) === 'object', 'Supercop exports as an object');
tap.ok('function' === typeof KeyPair         , 'Default export is a class-ish');
tap.doesNotThrow(() => new KeyPair()         , 'Default export can be initialized as class');
tap.ok(KeyPair === lib.KeyPair               , 'Default export is KeyPair class');

// Verify stand-alone functions are exported
tap.ok('function' === typeof lib.createSeed   , 'createSeed fn is exported');
tap.ok('function' === typeof lib.keyPairFrom  , 'keyPairFrom fn is exported');
tap.ok('function' === typeof lib.createKeyPair, 'createKeyPair fn is exported');
tap.ok('function' === typeof lib.sign         , 'sign fn is exported');
tap.ok('function' === typeof lib.verify       , 'verify fn is exported');
tap.ok('function' === typeof lib.keyExchange  , 'verify fn is exported');

// Verify static functions on KeyPair class are there
tap.ok('function' === typeof KeyPair.create, 'KeyPair contains static create fn');
tap.ok('function' === typeof KeyPair.from  , 'KeyPair contains static from fn');

// Go async, needed for the supercop lib
(async () => {

  // Create keypair to test with
  const kp = await KeyPair.create(lib.createSeed());

  tap.ok(kp instanceof KeyPair, 'KeyPair.create generates a KeyPair instance');

  // Tricking TSC into believing kp == instanceof keypair
  if (!(kp instanceof KeyPair)) throw new Error();

  // Verify the methods are there
  tap.ok('function' === typeof kp.toJSON     , 'kp.toJSON method exists');
  tap.ok('function' === typeof kp.keyExchange, 'kp.keyExchange method exists');
  tap.ok('function' === typeof kp.sign       , 'kp.sign method exists');
  tap.ok('function' === typeof kp.verify     , 'kp.verify method exists');
})();
