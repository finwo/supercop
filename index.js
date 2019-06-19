const Module   = require('./supercop.js');
const isBuffer = require('is-buffer');

function randomBytes(length) {
  return Buffer.from(new Array(length).fill(0).map(()=>Math.floor(Math.random()*256)));
}

function checkArguments( namedArguments, callback ) {
  callback = callback || function( err ) {
    if (!err) return;
    if (err instanceof Error) throw err;
    throw new Error(err);
  };

  if ('object' !== typeof namedArguments) return callback('Expected object, ' + (typeof namedArguments) + ' given');
  if (!namedArguments) return callback('Expected object, null given');
  if ( 'seed' in namedArguments ) {
    if (!isBuffer(namedArguments.seed)   ) return callback('Seed is not a buffer');
    if (namedArguments.seed.length !== 32) return callback('Seed must be 32 bytes');
  }
  if ( 'signature' in namedArguments ) {
    if (!isBuffer(namedArguments.signature)) return callback('Signature is not a buffer');
    if (namedArguments.signature.length !== 64) return callback('Signature must be 64 bytes');
  }
  if ( 'message' in namedArguments ) {
    if (!isBuffer(namedArguments.message)) return callback('Message is not a buffer');
  }
  if ( 'publicKey' in namedArguments ) {
    if (!isBuffer(namedArguments.publicKey)   ) return callback('Public key is not a buffer');
    if (namedArguments.publicKey.length !== 32) return callback('Public key must be 32 bytes');
  }
  if ( 'secretKey' in namedArguments ) {
    if (!isBuffer(namedArguments.secretKey)   ) return callback('Secret key is not a buffer');
    if (namedArguments.secretKey.length !== 64) return callback('Secret key must be 64 bytes');
  }

  return callback();
}

// Export helpers
exports._checkArguments = checkArguments;
exports._randomBytes    = randomBytes;

exports.createSeed = function(){
  return randomBytes(32);
};

exports.createKeyPair = function(seed) {
  checkArguments({seed});
  var seedPtr      = Module._malloc(32);
  var seedBuf      = new Uint8Array(Module.HEAPU8.buffer, seedPtr, 32);
  var publicKeyPtr = Module._malloc(32);
  var publicKey    = new Uint8Array(Module.HEAPU8.buffer, publicKeyPtr, 32);
  var secretKeyPtr = Module._malloc(64);
  var secretKey    = new Uint8Array(Module.HEAPU8.buffer, secretKeyPtr, 64);
  seedBuf.set(seed);
  Module._create_keypair(publicKeyPtr, secretKeyPtr, seedPtr);
  Module._free(seedPtr);
  Module._free(publicKeyPtr);
  Module._free(secretKeyPtr);
  return {
    publicKey: new Buffer(publicKey),
    secretKey: new Buffer(secretKey),
  };
};

exports.sign = function(message, publicKey, secretKey){
  if ('string' === typeof message) message = Buffer.from(message);
  checkArguments({message,publicKey,secretKey});
  var messageLen = message.length;
  var messageArrPtr = Module._malloc(messageLen);
  var messageArr = new Uint8Array(Module.HEAPU8.buffer, messageArrPtr, messageLen);
  var publicKeyArrPtr = Module._malloc(32);
  var publicKeyArr = new Uint8Array(Module.HEAPU8.buffer, publicKeyArrPtr, 32);
  var secretKeyArrPtr = Module._malloc(64);
  var secretKeyArr = new Uint8Array(Module.HEAPU8.buffer, secretKeyArrPtr, 64);
  var sigPtr = Module._malloc(64);
  var sig = new Uint8Array(Module.HEAPU8.buffer, sigPtr, 64);
  messageArr.set(message);
  publicKeyArr.set(publicKey);
  secretKeyArr.set(secretKey);
  Module._sign(sigPtr, messageArrPtr, messageLen, publicKeyArrPtr, secretKeyArrPtr);
  Module._free(messageArrPtr);
  Module._free(publicKeyArrPtr);
  Module._free(secretKeyArrPtr);
  Module._free(sigPtr);
  return new Buffer(sig);
};

exports.verify = function(signature, message, publicKey){
  if ('string' === typeof message) message = Buffer.from(message);
  checkArguments({signature,message,publicKey});
  var messageLen = message.length;
  var messageArrPtr = Module._malloc(messageLen);
  var messageArr = new Uint8Array(Module.HEAPU8.buffer, messageArrPtr, messageLen);
  var signatureArrPtr = Module._malloc(64);
  var signatureArr = new Uint8Array(Module.HEAPU8.buffer, signatureArrPtr, 64);
  var publicKeyArrPtr = Module._malloc(32);
  var publicKeyArr = new Uint8Array(Module.HEAPU8.buffer, publicKeyArrPtr, 32);
  messageArr.set(message);
  signatureArr.set(signature);
  publicKeyArr.set(publicKey);
  var res =  Module._verify(signatureArrPtr, messageArrPtr, messageLen, publicKeyArrPtr) === 1;
  Module._free(messageArrPtr);
  Module._free(signatureArrPtr);
  Module._free(publicKeyArrPtr);
  return res;
};
