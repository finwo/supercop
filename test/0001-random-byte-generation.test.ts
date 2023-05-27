import tap = require('tap');
import { createSeed } from '../src/index';

tap.ok('function' === typeof createSeed, 'Default export is a function');

const generated = createSeed();
tap.ok(Buffer.isBuffer(generated), 'createSeed generates a buffer');
tap.ok(generated.length === 32   , 'createSeed generates a buffer of 32 bytes');
