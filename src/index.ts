import isBuffer = require('is-buffer');
import { binary   } from './supercop.wasm';

const Module = (async () => {
  const memory  = new WebAssembly.Memory({initial: 2});
  const imports = {env: {memory}};

  // if ('function' === typeof WebAssembly.Global) {
  //   imports.env.__stack_pointer = new WebAssembly.Global({value: 'i32', mutable: true});
  // }

  const program = await WebAssembly.instantiate(binary, imports);

  return {
    memory  : memory,
    instance: program.instance,
    exports : program.instance.exports,
  } as {
    memory  : WebAssembly.Memory;
    instance: WebAssembly.Instance;
    exports : {[index:string]:any};
  };
})();


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
  publicKey?: PublicKey;
  secretKey?: SecretKey;

  constructor() {
    // Intentionally empty
  }

  // Passes signing on to the exported stand-alone method
  // Async, so the error = promise rejection
  async sign(message: string) {
    if (!isSecretKey(this.secretKey)) throw new Error('No secret key on this keypair, only verification is possible');
    if (!isPublicKey(this.publicKey)) throw new Error('Invalid public key');
    return sign(message, this.publicKey, this.secretKey);
  }

  // Passes verification on to the exported stand-alone method
  verify(signature: number[] | Signature, message: string) {
    if (!isPublicKey(this.publicKey)) throw new Error('Invalid public key');
    return verify(signature, message, this.publicKey);
  }

  keyExchange(theirPublicKey: number[] | PublicKey) {
    if (!isSecretKey(this.secretKey)) throw new Error('Invalid secret key');
    return keyExchange(theirPublicKey, this.secretKey);
  }

  static create(seed: number[] | Seed) {
    return createKeyPair(seed);
  }

  static from( data: { publicKey: number[] | PublicKey, secretKey?: number[] | SecretKey } ) {
    return keyPairFrom(data);
  }

}

export function keyPairFrom( data: { publicKey: number[] | PublicKey, secretKey?: number[] | SecretKey } ): false | KeyPair {
  if ('object' !== typeof data) return false;
  if (!data) return false;

  // Sanitization and sanity checking
  data = { ...data };
  if (Array.isArray(data.publicKey)) data.publicKey = Buffer.from(data.publicKey);
  if (Array.isArray(data.secretKey)) data.secretKey = Buffer.from(data.secretKey);
  if (!isPublicKey(data.publicKey)) return false;
  // Not checking the secretKey, allowed to be missing

  return Object.create(KeyPair, data);
}

export async function createKeyPair( seed: number[] | Seed ): Promise<false | KeyPair> {

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

export async function sign(
  message: string | Buffer,
  publicKey: number[] | PublicKey,
  secretKey: number[] | SecretKey
): Promise<Signature> {

  // Pre-fetch module components
  const fn  = (await Module).exports;
  const mem = (await Module).memory;

  // Sanitization and sanity checking
  if (Array.isArray(publicKey)) publicKey = Buffer.from(publicKey);
  if (Array.isArray(secretKey)) secretKey = Buffer.from(secretKey);
  if (!isPublicKey(publicKey)) throw new Error('Invalid public key');
  if (!isSecretKey(secretKey)) throw new Error('Invalid secret key');
  if ('string' === typeof message) message = Buffer.from(message);

  // Allocate memory on the wasm side to transfer variables
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

  // Free used memory on wasm side
  fn._free(messageArrPtr);
  fn._free(publicKeyArrPtr);
  fn._free(secretKeyArrPtr);
  fn._free(sigPtr);

  return Buffer.from(sig);
}

export async function verify(
  signature: number[] | Signature,
  message: string | Buffer,
  publicKey: number[] | PublicKey
): Promise<boolean> {

  const fn  = (await Module).exports;
  const mem = (await Module).memory;

  // Sanitization and sanity checking
  if (Array.isArray(signature)) signature = Buffer.from(signature);
  if (Array.isArray(publicKey)) publicKey = Buffer.from(publicKey);
  if (!isPublicKey(publicKey)) throw new Error('Invalid public key');
  if (!isSignature(signature)) throw new Error('Invalid signature');
  if ('string' === typeof message) message = Buffer.from(message);

  // Allocate memory on the wasm side to transfer variables
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

  const res = fn.verify(signatureArrPtr, messageArrPtr, messageLen, publicKeyArrPtr) === 1;

  // Free used memory on wasm side
  fn._free(messageArrPtr);
  fn._free(signatureArrPtr);
  fn._free(publicKeyArrPtr);

  return res;
}

export async function keyExchange(
  theirPublicKey: number[] | PublicKey,
  ourSecretKey: number[] | SecretKey
): Promise<Buffer> {

  const fn  = (await Module).exports;
  const mem = (await Module).memory;

  // Sanitization and sanity checking
  if (Array.isArray(theirPublicKey)) theirPublicKey = Buffer.from(theirPublicKey);
  if (Array.isArray(ourSecretKey)) ourSecretKey = Buffer.from(ourSecretKey);
  if (!isPublicKey(theirPublicKey)) throw new Error('Invalid public key');
  if (!isSecretKey(ourSecretKey)) throw new Error('Invalid secret key');

  // Allocate memory on the wasm side to transfer variables
  const sharedSecretArrPtr = fn._malloc(32);
  const sharedSecretArr    = new Uint8Array(mem.buffer, sharedSecretArrPtr, 32);
  const publicKeyArrPtr    = fn._malloc(32);
  const publicKeyArr       = new Uint8Array(mem.buffer, sharedSecretArrPtr, 32);
  const secretKeyArrPtr    = fn._malloc(32);
  const secretKeyArr       = new Uint8Array(mem.buffer, sharedSecretArrPtr, 64);

  publicKeyArr.set(theirPublicKey);
  secretKeyArr.set(ourSecretKey);

  fn.key_exchange(sharedSecretArrPtr, publicKeyArrPtr, secretKeyArrPtr);

  // Free used memory on wasm side
  fn._free(sharedSecretArrPtr);
  fn._free(publicKeyArrPtr);
  fn._free(secretKeyArrPtr);

  return Buffer.from(sharedSecretArr);
}
