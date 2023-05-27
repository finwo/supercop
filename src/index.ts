import isBuffer = require('is-buffer');
import { binary   } from './supercop.wasm';

let Module: null | {
  memory  : WebAssembly.Memory;
  instance: WebAssembly.Instance;
  exports : {[index:string]:any};
} = null;

async function instantiateModule() {
  if (Module) return;

  const memory  = new WebAssembly.Memory({initial: 2});
  const imports = {env: {memory}};

  // if ('function' === typeof WebAssembly.Global) {
  //   imports.env.__stack_pointer = new WebAssembly.Global({value: 'i32', mutable: true});
  // }

  const program = await WebAssembly.instantiate(binary, imports);

  Module       = {
    memory  : memory,
    instance: program.instance,
    exports : program.instance.exports,
  };
}

function randomBytes(length: number) {
  return Buffer.from(new Array(length).fill(0).map(()=>Math.floor(Math.random()*256)));
}

export function createSeed() {
  return randomBytes(32);
}

type PublicKey = Buffer;
type SecretKey = Buffer;
type Seed      = Buffer;
type Signature = Buffer;

function xIsBuffer(data: unknown): data is Buffer {
  return isBuffer(data);
}

export function isSeed(data: unknown): data is Seed {
  if (!xIsBuffer(data)) return false;
  return data.length === 32;
}

export function isPublicKey(data: unknown): data is PublicKey {
  if (!xIsBuffer(data)) return false;
  return data.length === 32;
}

export function isSignature(data: unknown): data is Signature {
  if (!xIsBuffer(data)) return false;
  return data.length === 64;
}

export function isSecretKey(data: unknown): data is SecretKey {
  if (!xIsBuffer(data)) return false;
  return data.length === 64;
}

export class KeyPair {
  publicKey: PublicKey;
  secretKey: SecretKey;

  constructor() {
    // Intentionally empty
  }

  async sign(message: string) {
    // TODO: call main sign fn
  }

  async verify(signature: Signature, message: string) {
    // TODO: call main verify fn
  }

}

export function keyPairFrom( data: { publicKey: PublicKey, secretKey: SecretKey } ): false | KeyPair {
  if ('object' !== typeof data) return false;
  if (!data) return false;

  if (!isPublicKey(data.publicKey)) return false;
  if (!isSecretKey(data.secretKey)) return false;

  return Object.create(KeyPair, data);
}

export async function createKeyPair( seed: Seed | Array<number> ): Promise<false | KeyPair> {
  await instantiateModule();

  // Pre-fetch module components
  const fn  = (await Module).exports;
  const mem = (await Module).memory;

  // Ensure we have a valid seed
  if (Array.isArray(seed)) seed = Buffer.from(seed);
  if (!isSeed(seed)) throw new Error('Invalid seed');

  // Reserve wasm-side memory
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

  return keyPairFrom({
    publicKey: Buffer.from(publicKey),
    secretKey: Buffer.from(secretKey),
  });
}

export async function sign(message: string | Buffer, publicKey: PublicKey, secretKey: SecretKey): Promise<Signature> {
  await instantiateModule();

  // Pre-fetch module components
  const fn  = (await Module).exports;
  const mem = (await Module).memory;

  // Sanity checking
  if (!isPublicKey(publicKey)) throw new Error('Invalid public key');
  if (!isSecretKey(secretKey)) throw new Error('Invalid secret key');




  if ('string' === typeof message) message = Buffer.from(message);

  // checkArguments({message,publicKey,secretKey});

  const messageLen      = message.length;
  const messageArrPtr   = fn._malloc(messageLen);
  const messageArr      = new Uint8Array(mem.buffer, messageArrPtr, messageLen);
  const publicKeyArrPtr = fn._malloc(32);
  const publicKeyArr    = new Uint8Array(mem.buffer, publicKeyArrPtr, 32);
  const secretKeyArrPtr = fn._malloc(64);
  const secretKeyArr    = new Uint8Array(mem.buffer, secretKeyArrPtr, 64);
  const sigPtr          = fn._malloc(64);
  const sig             = new Uint8Array(mem.buffer, sigPtr, 64);

  messageArr.set(message);
  publicKeyArr.set(publicKey);
  secretKeyArr.set(secretKey);

  await fn.sign(sigPtr, messageArrPtr, messageLen, publicKeyArrPtr, secretKeyArrPtr);

  fn._free(messageArrPtr);
  fn._free(publicKeyArrPtr);
  fn._free(secretKeyArrPtr);
  fn._free(sigPtr);

  return Buffer.from(sig);
}

exports.verify = async function(signature, message, publicKey){
  await instantiateModule();
  const fn  = (await Module).exports;
  const mem = (await Module).memory;
  if ('string' === typeof message) message = Buffer.from(message);
  if (Array.isArray(signature)) signature = Buffer.from(signature);
  if (Array.isArray(publicKey)) publicKey = Buffer.from(publicKey);
  checkArguments({signature,message,publicKey});

  const messageLen      = message.length;
  const messageArrPtr   = fn._malloc(messageLen);
  const messageArr      = new Uint8Array(mem.buffer, messageArrPtr, messageLen);
  const signatureArrPtr = fn._malloc(64);
  const signatureArr    = new Uint8Array(mem.buffer, signatureArrPtr, 64);
  const publicKeyArrPtr = fn._malloc(32);
  const publicKeyArr    = new Uint8Array(mem.buffer, publicKeyArrPtr, 32);

  messageArr.set(message);
  signatureArr.set(signature);
  publicKeyArr.set(publicKey);

  const res =  fn.verify(signatureArrPtr, messageArrPtr, messageLen, publicKeyArrPtr) === 1;

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
