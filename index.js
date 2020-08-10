let   Module   = null;
const isBuffer = require('is-buffer');

async function instantiateModule() {
  if (Module) return;

  const memory  = new WebAssembly.Memory({initial: 2});
  const imports = {env:{memory}};

  if ('function' === WebAssembly.Global) {
    imports.env.__stack_pointer = new WebAssembly.Global({value: 'i32', mutable: true});
  }

  const bytes   = require('./supercop.wasm.js');
  const program = await WebAssembly.instantiate(bytes, imports);

  Module       = {
    memory  : memory,
    instance: program.instance,
    exports : program.instance.exports,
  };
}

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

exports.keyPairFrom = function( data ) {
  if ('object' !== typeof data) return false;
  if (!data) return false;

  const keypair = Object.create({
    sign: async function( message ) {
      return exports.sign( message, this.publicKey, this.secretKey );
    },
    verify: async function( signature, message ) {
      return exports.verify( signature, message, this.publicKey );
    },
  });

  // Fetch public key
  if (isBuffer(data.pk       )) keypair.publicKey = data.pk;
  if (isBuffer(data.pub      )) keypair.publicKey = data.pub;
  if (isBuffer(data.public   )) keypair.publicKey = data.public;
  if (isBuffer(data.publicKey)) keypair.publicKey = data.publicKey;
  if (isBuffer(data.publickey)) keypair.publicKey = data.publickey;

  // Fetch secret key
  if (isBuffer(data.sk        )) keypair.secretKey = data.sk;
  if (isBuffer(data.sec       )) keypair.secretKey = data.sec;
  if (isBuffer(data.secret    )) keypair.secretKey = data.secret;
  if (isBuffer(data.secretKey )) keypair.secretKey = data.secretKey;
  if (isBuffer(data.secretkey )) keypair.secretKey = data.secretkey;
  if (isBuffer(data.pri       )) keypair.secretKey = data.pri;
  if (isBuffer(data.priv      )) keypair.secretKey = data.priv;
  if (isBuffer(data.private   )) keypair.secretKey = data.private;
  if (isBuffer(data.privateKey)) keypair.secretKey = data.privateKey;
  if (isBuffer(data.privatekey)) keypair.secretKey = data.privatekey;

  return keypair;
};

exports.createKeyPair = async function(seed) {
  await instantiateModule();
  const fn  = (await Module).exports;
  const mem = (await Module).memory;
  if (Array.isArray(seed)) seed = Buffer.from(seed);
  checkArguments({seed});

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

  return exports.keyPairFrom({
    pk: Buffer.from(publicKey),
    sk: Buffer.from(secretKey),
  });
};

exports.sign = async function(message, publicKey, secretKey){
  await instantiateModule();
  const fn  = (await Module).exports;
  const mem = (await Module).memory;
  if ('string' === typeof message) message = Buffer.from(message);
  checkArguments({message,publicKey,secretKey});

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
  await instantiateModule();
  const fn  = (await Module).exports;
  const mem = (await Module).memory;
  if ('string' === typeof message) message = Buffer.from(message);
  if (Array.isArray(signature)) signature = Buffer.from(signature);
  if (Array.isArray(publicKey)) publicKey = Buffer.from(publicKey);
  checkArguments({signature,message,publicKey});

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

exports.keyExchange = async function(publicKey, secretKey) {
  await instantiateModule();
  const fn  = (await Module).exports;
  const mem = (await Module).memory;
  if (Array.isArray(publicKey)) publicKey = Buffer.from(publicKey);
  if (Array.isArray(secretKey)) secretKey = Buffer.from(secretKey);
  checkArguments({publicKey,secretKey});

  const sharedSecretArrPtr = fn._malloc(32);
  const sharedSecretArr    = new Uint8Array(mem.buffer, sharedSecretArrPtr, 32);
  const publicKeyArrPtr    = fn._malloc(32);
  const publicKeyArr       = new Uint8Array(mem.buffer, sharedSecretArrPtr, 32);
  const secretKeyArrPtr    = fn._malloc(32);
  const secretKeyArr       = new Uint8Array(mem.buffer, sharedSecretArrPtr, 64);

  fn.key_exchange(sharedSecretArrPtr, publicKeyArrPtr, secretKeyArrPtr);

  fn._free(sharedSecretArrPtr);
  fn._free(publicKeyArrPtr);
  fn._free(secretKeyArrPtr);

  return Buffer.from(sharedSecretArr);
};
