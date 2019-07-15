const Module   = require('webassembly').load_buffer(require('./supercop.wasm.js'));
const isBuffer = require('is-buffer');

async function randomBytes(length) {
  return Buffer.from(new Array(length).fill(0).map(()=>Math.floor(Math.random()*256)));
}

async function checkArguments( namedArguments, callback ) {
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

exports.createSeed = async function(){
  return randomBytes(32);
};

exports.createKeyPair = async function(seed) {
  const fn  = (await Module).exports;
  const mem = (await Module).memory;
  if (Array.isArray(seed)) seed = Buffer.from(seed);
  await checkArguments({seed});

  const seedPtr      = fn._malloc(32);
  const publicKeyPtr = fn._malloc(32);
  const secretKeyPtr = fn._malloc(64);

  const seedBuf   = new Uint8Array(mem.buffer, seedPtr     , 32);
  const publicKey = new Uint8Array(mem.buffer, publicKeyPtr, 32);
  const secretKey = new Uint8Array(mem.buffer, secretKeyPtr, 64);

  seedBuf.set(seed);

  fn.create_keypair(publicKeyPtr, secretKeyPtr, seedPtr);

  fn._free(seedPtr);
  fn._free(publicKeyPtr);
  fn._free(secretKeyPtr);

  const keypair = Object.create({
    sign: async function( message ) {
      return exports.sign( message, this.publicKey, this.secretKey );
    },
    verify: async function( signature, message ) {
      return exports.verify( signature, message, this.publicKey );
    },
  });

  keypair.publicKey = Buffer.from(publicKey);
  keypair.secretKey = Buffer.from(secretKey);

  return keypair;
};

exports.sign = async function(message, publicKey, secretKey){
  const fn  = (await Module).exports;
  const mem = (await Module).memory;
  if ('string' === typeof message) message = Buffer.from(message);
  await checkArguments({message,publicKey,secretKey});

  var messageLen      = message.length;
  var messageArrPtr   = fn._malloc(messageLen);
  var messageArr      = new Uint8Array(mem.buffer, messageArrPtr, messageLen);
  var publicKeyArrPtr = fn._malloc(32);
  var publicKeyArr    = new Uint8Array(mem.buffer, publicKeyArrPtr, 32);
  var secretKeyArrPtr = fn._malloc(64);
  var secretKeyArr    = new Uint8Array(mem.buffer, secretKeyArrPtr, 64);
  var sigPtr          = fn._malloc(64);
  var sig             = new Uint8Array(mem.buffer, sigPtr, 64);

  messageArr.set(message);
  publicKeyArr.set(publicKey);
  secretKeyArr.set(secretKey);

  await fn.sign(sigPtr, messageArrPtr, messageLen, publicKeyArrPtr, secretKeyArrPtr);

  fn._free(messageArrPtr);
  fn._free(publicKeyArrPtr);
  fn._free(secretKeyArrPtr);
  fn._free(sigPtr);

  return Buffer.from(sig);
};

exports.verify = async function(signature, message, publicKey){
  const fn  = (await Module).exports;
  const mem = (await Module).memory;
  if ('string' === typeof message) message = Buffer.from(message);
  if (Array.isArray(signature)) signature = Buffer.from(signature);
  if (Array.isArray(publicKey)) publicKey = Buffer.from(publicKey);
  await checkArguments({signature,message,publicKey});

  var messageLen      = message.length;
  var messageArrPtr   = fn._malloc(messageLen);
  var messageArr      = new Uint8Array(mem.buffer, messageArrPtr, messageLen);
  var signatureArrPtr = fn._malloc(64);
  var signatureArr    = new Uint8Array(mem.buffer, signatureArrPtr, 64);
  var publicKeyArrPtr = fn._malloc(32);
  var publicKeyArr    = new Uint8Array(mem.buffer, publicKeyArrPtr, 32);

  messageArr.set(message);
  signatureArr.set(signature);
  publicKeyArr.set(publicKey);

  var res =  fn.verify(signatureArrPtr, messageArrPtr, messageLen, publicKeyArrPtr) === 1;

  fn._free(messageArrPtr);
  fn._free(signatureArrPtr);
  fn._free(publicKeyArrPtr);

  return res;
};
