const Module   = require('./supercop.js');
const isBuffer = require('is-buffer');

function randomBytes(length) {
  return Buffer.from(new Array(length).fill(0).map(()=>Math.floor(Math.random()*256)));
}

exports.createSeed = function(){
  return randomBytes(32);
};

exports.createKeyPair = function(seed) {
  if(!Buffer.isBuffer(seed)){
    throw new Error('not buffers!');
  }
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
  if(!Buffer.isBuffer(message) || !Buffer.isBuffer(publicKey) || !Buffer.isBuffer(secretKey)){
    throw new Error('not buffers!');
  }
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

exports.verify = function(sig, message, publicKey){
  if(!Buffer.isBuffer(message) || !Buffer.isBuffer(sig) || !Buffer.isBuffer(publicKey)){
    throw new Error('not buffers!');
  }
  var messageLen = message.length;
  var messageArrPtr = Module._malloc(messageLen);
  var messageArr = new Uint8Array(Module.HEAPU8.buffer, messageArrPtr, messageLen);
  var sigArrPtr = Module._malloc(64);
  var sigArr = new Uint8Array(Module.HEAPU8.buffer, sigArrPtr, 64);
  var publicKeyArrPtr = Module._malloc(32);
  var publicKeyArr = new Uint8Array(Module.HEAPU8.buffer, publicKeyArrPtr, 32);
  messageArr.set(message);
  sigArr.set(sig);
  publicKeyArr.set(publicKey);
  var res =  Module._verify(sigArrPtr, messageArrPtr, messageLen, publicKeyArrPtr) === 1;
  Module._free(messageArrPtr);
  Module._free(sigArrPtr);
  Module._free(publicKeyArrPtr);
  return res;
};
