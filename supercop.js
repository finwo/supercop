// Copyright 2010 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// The Module object: Our interface to the outside world. We import
// and export values on it. There are various ways Module can be used:
// 1. Not defined. We create it here
// 2. A function parameter, function(Module) { ..generated code.. }
// 3. pre-run appended it, var Module = {}; ..generated code..
// 4. External script tag defines var Module.
// We need to check if Module already exists (e.g. case 3 above).
// Substitution will be replaced with actual code on later stage of the build,
// this way Closure Compiler will not mangle it (e.g. case 4. above).
// Note that if you want to run closure, and also to use Module
// after the generated code, you will need to define   var Module = {};
// before the code. Then that object will be used in the code, and you
// can continue to use Module afterwards as well.
var Module = typeof Module !== 'undefined' ? Module : {};

// --pre-jses are emitted after the Module integration code, so that they can
// refer to Module (if they choose; they can also define Module)
// {{PRE_JSES}}

// Sometimes an existing Module object exists with properties
// meant to overwrite the default module functionality. Here
// we collect those properties and reapply _after_ we configure
// the current environment's defaults to avoid having to be so
// defensive during initialization.
var moduleOverrides = {};
var key;
for (key in Module) {
  if (Module.hasOwnProperty(key)) {
    moduleOverrides[key] = Module[key];
  }
}

Module['arguments'] = [];
Module['thisProgram'] = './this.program';
Module['quit'] = function(status, toThrow) {
  throw toThrow;
};
Module['preRun'] = [];
Module['postRun'] = [];

// Determine the runtime environment we are in. You can customize this by
// setting the ENVIRONMENT setting at compile time (see settings.js).

var ENVIRONMENT_IS_WEB = false;
var ENVIRONMENT_IS_WORKER = false;
var ENVIRONMENT_IS_NODE = false;
var ENVIRONMENT_HAS_NODE = false;
var ENVIRONMENT_IS_SHELL = false;
ENVIRONMENT_IS_WEB = typeof window === 'object';
ENVIRONMENT_IS_WORKER = typeof importScripts === 'function';
// A web environment like Electron.js can have Node enabled, so we must
// distinguish between Node-enabled environments and Node environments per se.
// This will allow the former to do things like mount NODEFS.
ENVIRONMENT_HAS_NODE = typeof process === 'object' && typeof require === 'function';
ENVIRONMENT_IS_NODE = ENVIRONMENT_HAS_NODE && !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_WORKER;
ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;



// Three configurations we can be running in:
// 1) We could be the application main() thread running in the main JS UI thread. (ENVIRONMENT_IS_WORKER == false and ENVIRONMENT_IS_PTHREAD == false)
// 2) We could be the application main() thread proxied to worker. (with Emscripten -s PROXY_TO_WORKER=1) (ENVIRONMENT_IS_WORKER == true, ENVIRONMENT_IS_PTHREAD == false)
// 3) We could be an application pthread running in a worker. (ENVIRONMENT_IS_WORKER == true and ENVIRONMENT_IS_PTHREAD == true)




// `/` should be present at the end if `scriptDirectory` is not empty
var scriptDirectory = '';
function locateFile(path) {
  if (Module['locateFile']) {
    return Module['locateFile'](path, scriptDirectory);
  } else {
    return scriptDirectory + path;
  }
}

if (ENVIRONMENT_IS_NODE) {
  scriptDirectory = __dirname + '/';

  // Expose functionality in the same simple way that the shells work
  // Note that we pollute the global namespace here, otherwise we break in node
  var nodeFS;
  var nodePath;

  Module['read'] = function shell_read(filename, binary) {
    var ret;
    ret = tryParseAsDataURI(filename);
    if (!ret) {
      if (!nodeFS) nodeFS = require('fs');
      if (!nodePath) nodePath = require('path');
      filename = nodePath['normalize'](filename);
      ret = nodeFS['readFileSync'](filename);
    }
    return binary ? ret : ret.toString();
  };

  Module['readBinary'] = function readBinary(filename) {
    var ret = Module['read'](filename, true);
    if (!ret.buffer) {
      ret = new Uint8Array(ret);
    }
    assert(ret.buffer);
    return ret;
  };

  if (process['argv'].length > 1) {
    Module['thisProgram'] = process['argv'][1].replace(/\\/g, '/');
  }

  Module['arguments'] = process['argv'].slice(2);

  if (typeof module !== 'undefined') {
    module['exports'] = Module;
  }

  process['on']('uncaughtException', function(ex) {
    // suppress ExitStatus exceptions from showing an error
    if (!(ex instanceof ExitStatus)) {
      throw ex;
    }
  });
  // Currently node will swallow unhandled rejections, but this behavior is
  // deprecated, and in the future it will exit with error status.
  process['on']('unhandledRejection', abort);

  Module['quit'] = function(status) {
    process['exit'](status);
  };

  Module['inspect'] = function () { return '[Emscripten Module object]'; };
} else
if (ENVIRONMENT_IS_SHELL) {


  if (typeof read != 'undefined') {
    Module['read'] = function shell_read(f) {
      var data = tryParseAsDataURI(f);
      if (data) {
        return intArrayToString(data);
      }
      return read(f);
    };
  }

  Module['readBinary'] = function readBinary(f) {
    var data;
    data = tryParseAsDataURI(f);
    if (data) {
      return data;
    }
    if (typeof readbuffer === 'function') {
      return new Uint8Array(readbuffer(f));
    }
    data = read(f, 'binary');
    assert(typeof data === 'object');
    return data;
  };

  if (typeof scriptArgs != 'undefined') {
    Module['arguments'] = scriptArgs;
  } else if (typeof arguments != 'undefined') {
    Module['arguments'] = arguments;
  }

  if (typeof quit === 'function') {
    Module['quit'] = function(status) {
      quit(status);
    }
  }
} else
if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
  if (ENVIRONMENT_IS_WORKER) { // Check worker, not web, since window could be polyfilled
    scriptDirectory = self.location.href;
  } else if (document.currentScript) { // web
    scriptDirectory = document.currentScript.src;
  }
  // blob urls look like blob:http://site.com/etc/etc and we cannot infer anything from them.
  // otherwise, slice off the final part of the url to find the script directory.
  // if scriptDirectory does not contain a slash, lastIndexOf will return -1,
  // and scriptDirectory will correctly be replaced with an empty string.
  if (scriptDirectory.indexOf('blob:') !== 0) {
    scriptDirectory = scriptDirectory.substr(0, scriptDirectory.lastIndexOf('/')+1);
  } else {
    scriptDirectory = '';
  }


  Module['read'] = function shell_read(url) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, false);
      xhr.send(null);
      return xhr.responseText;
    } catch (err) {
      var data = tryParseAsDataURI(url);
      if (data) {
        return intArrayToString(data);
      }
      throw err;
    }
  };

  if (ENVIRONMENT_IS_WORKER) {
    Module['readBinary'] = function readBinary(url) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, false);
        xhr.responseType = 'arraybuffer';
        xhr.send(null);
        return new Uint8Array(xhr.response);
      } catch (err) {
        var data = tryParseAsDataURI(url);
        if (data) {
          return data;
        }
        throw err;
      }
    };
  }

  Module['readAsync'] = function readAsync(url, onload, onerror) {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'arraybuffer';
    xhr.onload = function xhr_onload() {
      if (xhr.status == 200 || (xhr.status == 0 && xhr.response)) { // file URLs can return 0
        onload(xhr.response);
        return;
      }
      var data = tryParseAsDataURI(url);
      if (data) {
        onload(data.buffer);
        return;
      }
      onerror();
    };
    xhr.onerror = onerror;
    xhr.send(null);
  };

  Module['setWindowTitle'] = function(title) { document.title = title };
} else
{
}

// Set up the out() and err() hooks, which are how we can print to stdout or
// stderr, respectively.
// If the user provided Module.print or printErr, use that. Otherwise,
// console.log is checked first, as 'print' on the web will open a print dialogue
// printErr is preferable to console.warn (works better in shells)
// bind(console) is necessary to fix IE/Edge closed dev tools panel behavior.
var out = Module['print'] || (typeof console !== 'undefined' ? console.log.bind(console) : (typeof print !== 'undefined' ? print : null));
var err = Module['printErr'] || (typeof printErr !== 'undefined' ? printErr : ((typeof console !== 'undefined' && console.warn.bind(console)) || out));

// Merge back in the overrides
for (key in moduleOverrides) {
  if (moduleOverrides.hasOwnProperty(key)) {
    Module[key] = moduleOverrides[key];
  }
}
// Free the object hierarchy contained in the overrides, this lets the GC
// reclaim data used e.g. in memoryInitializerRequest, which is a large typed array.
moduleOverrides = undefined;

// perform assertions in shell.js after we set up out() and err(), as otherwise if an assertion fails it cannot print the message



// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// {{PREAMBLE_ADDITIONS}}

var STACK_ALIGN = 16;


function dynamicAlloc(size) {
  var ret = HEAP32[DYNAMICTOP_PTR>>2];
  var end = (ret + size + 15) & -16;
  if (end > _emscripten_get_heap_size()) {
    abort();
  }
  HEAP32[DYNAMICTOP_PTR>>2] = end;
  return ret;
}

function alignMemory(size, factor) {
  if (!factor) factor = STACK_ALIGN; // stack alignment (16-byte) by default
  return Math.ceil(size / factor) * factor;
}

function getNativeTypeSize(type) {
  switch (type) {
    case 'i1': case 'i8': return 1;
    case 'i16': return 2;
    case 'i32': return 4;
    case 'i64': return 8;
    case 'float': return 4;
    case 'double': return 8;
    default: {
      if (type[type.length-1] === '*') {
        return 4; // A pointer
      } else if (type[0] === 'i') {
        var bits = parseInt(type.substr(1));
        assert(bits % 8 === 0, 'getNativeTypeSize invalid bits ' + bits + ', type ' + type);
        return bits / 8;
      } else {
        return 0;
      }
    }
  }
}

function warnOnce(text) {
  if (!warnOnce.shown) warnOnce.shown = {};
  if (!warnOnce.shown[text]) {
    warnOnce.shown[text] = 1;
    err(text);
  }
}

var asm2wasmImports = { // special asm2wasm imports
    "f64-rem": function(x, y) {
        return x % y;
    },
    "debugger": function() {
        debugger;
    }
};



var jsCallStartIndex = 1;
var functionPointers = new Array(0);


// 'sig' parameter is required for the llvm backend but only when func is not
// already a WebAssembly function.
function addFunction(func, sig) {


  var base = 0;
  for (var i = base; i < base + 0; i++) {
    if (!functionPointers[i]) {
      functionPointers[i] = func;
      return jsCallStartIndex + i;
    }
  }
  throw 'Finished up all reserved function pointers. Use a higher value for RESERVED_FUNCTION_POINTERS.';

}

function removeFunction(index) {

  functionPointers[index-jsCallStartIndex] = null;
}

var funcWrappers = {};

function getFuncWrapper(func, sig) {
  if (!func) return; // on null pointer, return undefined
  assert(sig);
  if (!funcWrappers[sig]) {
    funcWrappers[sig] = {};
  }
  var sigCache = funcWrappers[sig];
  if (!sigCache[func]) {
    // optimize away arguments usage in common cases
    if (sig.length === 1) {
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func);
      };
    } else if (sig.length === 2) {
      sigCache[func] = function dynCall_wrapper(arg) {
        return dynCall(sig, func, [arg]);
      };
    } else {
      // general case
      sigCache[func] = function dynCall_wrapper() {
        return dynCall(sig, func, Array.prototype.slice.call(arguments));
      };
    }
  }
  return sigCache[func];
}


function makeBigInt(low, high, unsigned) {
  return unsigned ? ((+((low>>>0)))+((+((high>>>0)))*4294967296.0)) : ((+((low>>>0)))+((+((high|0)))*4294967296.0));
}

function dynCall(sig, ptr, args) {
  if (args && args.length) {
    return Module['dynCall_' + sig].apply(null, [ptr].concat(args));
  } else {
    return Module['dynCall_' + sig].call(null, ptr);
  }
}

var tempRet0 = 0;

var setTempRet0 = function(value) {
  tempRet0 = value;
}

var getTempRet0 = function() {
  return tempRet0;
}


var Runtime = {
};

// The address globals begin at. Very low in memory, for code size and optimization opportunities.
// Above 0 is static memory, starting with globals.
// Then the stack.
// Then 'dynamic' memory for sbrk.
var GLOBAL_BASE = 8;




// === Preamble library stuff ===

// Documentation for the public APIs defined in this file must be updated in:
//    site/source/docs/api_reference/preamble.js.rst
// A prebuilt local version of the documentation is available at:
//    site/build/text/docs/api_reference/preamble.js.txt
// You can also build docs locally as HTML or other formats in site/
// An online HTML version (which may be of a different version of Emscripten)
//    is up at http://kripken.github.io/emscripten-site/docs/api_reference/preamble.js.html





// In MINIMAL_RUNTIME, setValue() and getValue() are only available when building with safe heap enabled, for heap safety checking.
// In traditional runtime, setValue() and getValue() are always available (although their use is highly discouraged due to perf penalties)

/** @type {function(number, number, string, boolean=)} */
function setValue(ptr, value, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': HEAP8[((ptr)>>0)]=value; break;
      case 'i8': HEAP8[((ptr)>>0)]=value; break;
      case 'i16': HEAP16[((ptr)>>1)]=value; break;
      case 'i32': HEAP32[((ptr)>>2)]=value; break;
      case 'i64': (tempI64 = [value>>>0,(tempDouble=value,(+(Math_abs(tempDouble))) >= 1.0 ? (tempDouble > 0.0 ? ((Math_min((+(Math_floor((tempDouble)/4294967296.0))), 4294967295.0))|0)>>>0 : (~~((+(Math_ceil((tempDouble - +(((~~(tempDouble)))>>>0))/4294967296.0)))))>>>0) : 0)],HEAP32[((ptr)>>2)]=tempI64[0],HEAP32[(((ptr)+(4))>>2)]=tempI64[1]); break;
      case 'float': HEAPF32[((ptr)>>2)]=value; break;
      case 'double': HEAPF64[((ptr)>>3)]=value; break;
      default: abort('invalid type for setValue: ' + type);
    }
}

/** @type {function(number, string, boolean=)} */
function getValue(ptr, type, noSafe) {
  type = type || 'i8';
  if (type.charAt(type.length-1) === '*') type = 'i32'; // pointers are 32-bit
    switch(type) {
      case 'i1': return HEAP8[((ptr)>>0)];
      case 'i8': return HEAP8[((ptr)>>0)];
      case 'i16': return HEAP16[((ptr)>>1)];
      case 'i32': return HEAP32[((ptr)>>2)];
      case 'i64': return HEAP32[((ptr)>>2)];
      case 'float': return HEAPF32[((ptr)>>2)];
      case 'double': return HEAPF64[((ptr)>>3)];
      default: abort('invalid type for getValue: ' + type);
    }
  return null;
}





// Wasm globals

var wasmMemory;

// Potentially used for direct table calls.
var wasmTable;


//========================================
// Runtime essentials
//========================================

// whether we are quitting the application. no code should run after this.
// set in exit() and abort()
var ABORT = false;

// set by exit() and abort().  Passed to 'onExit' handler.
// NOTE: This is also used as the process return code code in shell environments
// but only when noExitRuntime is false.
var EXITSTATUS = 0;

/** @type {function(*, string=)} */
function assert(condition, text) {
  if (!condition) {
    abort('Assertion failed: ' + text);
  }
}

// Returns the C function with a specified identifier (for C++, you need to do manual name mangling)
function getCFunc(ident) {
  var func = Module['_' + ident]; // closure exported function
  assert(func, 'Cannot call unknown function ' + ident + ', make sure it is exported');
  return func;
}

// C calling interface.
function ccall(ident, returnType, argTypes, args, opts) {
  // For fast lookup of conversion functions
  var toC = {
    'string': function(str) {
      var ret = 0;
      if (str !== null && str !== undefined && str !== 0) { // null string
        // at most 4 bytes per UTF-8 code point, +1 for the trailing '\0'
        var len = (str.length << 2) + 1;
        ret = stackAlloc(len);
        stringToUTF8(str, ret, len);
      }
      return ret;
    },
    'array': function(arr) {
      var ret = stackAlloc(arr.length);
      writeArrayToMemory(arr, ret);
      return ret;
    }
  };

  function convertReturnValue(ret) {
    if (returnType === 'string') return UTF8ToString(ret);
    if (returnType === 'boolean') return Boolean(ret);
    return ret;
  }

  var func = getCFunc(ident);
  var cArgs = [];
  var stack = 0;
  if (args) {
    for (var i = 0; i < args.length; i++) {
      var converter = toC[argTypes[i]];
      if (converter) {
        if (stack === 0) stack = stackSave();
        cArgs[i] = converter(args[i]);
      } else {
        cArgs[i] = args[i];
      }
    }
  }
  var ret = func.apply(null, cArgs);
  ret = convertReturnValue(ret);
  if (stack !== 0) stackRestore(stack);
  return ret;
}

function cwrap(ident, returnType, argTypes, opts) {
  argTypes = argTypes || [];
  // When the function takes numbers and returns a number, we can just return
  // the original function
  var numericArgs = argTypes.every(function(type){ return type === 'number'});
  var numericRet = returnType !== 'string';
  if (numericRet && numericArgs && !opts) {
    return getCFunc(ident);
  }
  return function() {
    return ccall(ident, returnType, argTypes, arguments, opts);
  }
}

var ALLOC_NORMAL = 0; // Tries to use _malloc()
var ALLOC_STACK = 1; // Lives for the duration of the current function call
var ALLOC_DYNAMIC = 2; // Cannot be freed except through sbrk
var ALLOC_NONE = 3; // Do not allocate

// allocate(): This is for internal use. You can use it yourself as well, but the interface
//             is a little tricky (see docs right below). The reason is that it is optimized
//             for multiple syntaxes to save space in generated code. So you should
//             normally not use allocate(), and instead allocate memory using _malloc(),
//             initialize it with setValue(), and so forth.
// @slab: An array of data, or a number. If a number, then the size of the block to allocate,
//        in *bytes* (note that this is sometimes confusing: the next parameter does not
//        affect this!)
// @types: Either an array of types, one for each byte (or 0 if no type at that position),
//         or a single type which is used for the entire block. This only matters if there
//         is initial data - if @slab is a number, then this does not matter at all and is
//         ignored.
// @allocator: How to allocate memory, see ALLOC_*
/** @type {function((TypedArray|Array<number>|number), string, number, number=)} */
function allocate(slab, types, allocator, ptr) {
  var zeroinit, size;
  if (typeof slab === 'number') {
    zeroinit = true;
    size = slab;
  } else {
    zeroinit = false;
    size = slab.length;
  }

  var singleType = typeof types === 'string' ? types : null;

  var ret;
  if (allocator == ALLOC_NONE) {
    ret = ptr;
  } else {
    ret = [_malloc,
    stackAlloc,
    dynamicAlloc][allocator](Math.max(size, singleType ? 1 : types.length));
  }

  if (zeroinit) {
    var stop;
    ptr = ret;
    assert((ret & 3) == 0);
    stop = ret + (size & ~3);
    for (; ptr < stop; ptr += 4) {
      HEAP32[((ptr)>>2)]=0;
    }
    stop = ret + size;
    while (ptr < stop) {
      HEAP8[((ptr++)>>0)]=0;
    }
    return ret;
  }

  if (singleType === 'i8') {
    if (slab.subarray || slab.slice) {
      HEAPU8.set(/** @type {!Uint8Array} */ (slab), ret);
    } else {
      HEAPU8.set(new Uint8Array(slab), ret);
    }
    return ret;
  }

  var i = 0, type, typeSize, previousType;
  while (i < size) {
    var curr = slab[i];

    type = singleType || types[i];
    if (type === 0) {
      i++;
      continue;
    }

    if (type == 'i64') type = 'i32'; // special case: we have one i32 here, and one i32 later

    setValue(ret+i, curr, type);

    // no need to look up size unless type changes, so cache it
    if (previousType !== type) {
      typeSize = getNativeTypeSize(type);
      previousType = type;
    }
    i += typeSize;
  }

  return ret;
}

// Allocate memory during any stage of startup - static memory early on, dynamic memory later, malloc when ready
function getMemory(size) {
  if (!runtimeInitialized) return dynamicAlloc(size);
  return _malloc(size);
}




/** @type {function(number, number=)} */
function Pointer_stringify(ptr, length) {
  abort("this function has been removed - you should use UTF8ToString(ptr, maxBytesToRead) instead!");
}

// Given a pointer 'ptr' to a null-terminated ASCII-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

function AsciiToString(ptr) {
  var str = '';
  while (1) {
    var ch = HEAPU8[((ptr++)>>0)];
    if (!ch) return str;
    str += String.fromCharCode(ch);
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in ASCII form. The copy will require at most str.length+1 bytes of space in the HEAP.

function stringToAscii(str, outPtr) {
  return writeAsciiToMemory(str, outPtr, false);
}


// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the given array that contains uint8 values, returns
// a copy of that string as a Javascript String object.

var UTF8Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf8') : undefined;

/**
 * @param {number} idx
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ArrayToString(u8Array, idx, maxBytesToRead) {
  var endIdx = idx + maxBytesToRead;
  var endPtr = idx;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  // (As a tiny code save trick, compare endPtr against endIdx using a negation, so that undefined means Infinity)
  while (u8Array[endPtr] && !(endPtr >= endIdx)) ++endPtr;

  if (endPtr - idx > 16 && u8Array.subarray && UTF8Decoder) {
    return UTF8Decoder.decode(u8Array.subarray(idx, endPtr));
  } else {
    var str = '';
    // If building with TextDecoder, we have already computed the string length above, so test loop end condition against that
    while (idx < endPtr) {
      // For UTF8 byte structure, see:
      // http://en.wikipedia.org/wiki/UTF-8#Description
      // https://www.ietf.org/rfc/rfc2279.txt
      // https://tools.ietf.org/html/rfc3629
      var u0 = u8Array[idx++];
      if (!(u0 & 0x80)) { str += String.fromCharCode(u0); continue; }
      var u1 = u8Array[idx++] & 63;
      if ((u0 & 0xE0) == 0xC0) { str += String.fromCharCode(((u0 & 31) << 6) | u1); continue; }
      var u2 = u8Array[idx++] & 63;
      if ((u0 & 0xF0) == 0xE0) {
        u0 = ((u0 & 15) << 12) | (u1 << 6) | u2;
      } else {
        u0 = ((u0 & 7) << 18) | (u1 << 12) | (u2 << 6) | (u8Array[idx++] & 63);
      }

      if (u0 < 0x10000) {
        str += String.fromCharCode(u0);
      } else {
        var ch = u0 - 0x10000;
        str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
      }
    }
  }
  return str;
}

// Given a pointer 'ptr' to a null-terminated UTF8-encoded string in the emscripten HEAP, returns a
// copy of that string as a Javascript String object.
// maxBytesToRead: an optional length that specifies the maximum number of bytes to read. You can omit
//                 this parameter to scan the string until the first \0 byte. If maxBytesToRead is
//                 passed, and the string at [ptr, ptr+maxBytesToReadr[ contains a null byte in the
//                 middle, then the string will cut short at that byte index (i.e. maxBytesToRead will
//                 not produce a string of exact length [ptr, ptr+maxBytesToRead[)
//                 N.B. mixing frequent uses of UTF8ToString() with and without maxBytesToRead may
//                 throw JS JIT optimizations off, so it is worth to consider consistently using one
//                 style or the other.
/**
 * @param {number} ptr
 * @param {number=} maxBytesToRead
 * @return {string}
 */
function UTF8ToString(ptr, maxBytesToRead) {
  return ptr ? UTF8ArrayToString(HEAPU8, ptr, maxBytesToRead) : '';
}

// Copies the given Javascript String object 'str' to the given byte array at address 'outIdx',
// encoded in UTF8 form and null-terminated. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outU8Array: the array to copy to. Each index in this array is assumed to be one 8-byte element.
//   outIdx: The starting offset in the array to begin the copying.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array.
//                    This count should include the null terminator,
//                    i.e. if maxBytesToWrite=1, only the null terminator will be written and nothing else.
//                    maxBytesToWrite=0 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
  if (!(maxBytesToWrite > 0)) // Parameter maxBytesToWrite is not optional. Negative values, 0, null, undefined and false each don't write out any bytes.
    return 0;

  var startIdx = outIdx;
  var endIdx = outIdx + maxBytesToWrite - 1; // -1 for string null terminator.
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    // For UTF8 byte structure, see http://en.wikipedia.org/wiki/UTF-8#Description and https://www.ietf.org/rfc/rfc2279.txt and https://tools.ietf.org/html/rfc3629
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) {
      var u1 = str.charCodeAt(++i);
      u = 0x10000 + ((u & 0x3FF) << 10) | (u1 & 0x3FF);
    }
    if (u <= 0x7F) {
      if (outIdx >= endIdx) break;
      outU8Array[outIdx++] = u;
    } else if (u <= 0x7FF) {
      if (outIdx + 1 >= endIdx) break;
      outU8Array[outIdx++] = 0xC0 | (u >> 6);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else if (u <= 0xFFFF) {
      if (outIdx + 2 >= endIdx) break;
      outU8Array[outIdx++] = 0xE0 | (u >> 12);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    } else {
      if (outIdx + 3 >= endIdx) break;
      outU8Array[outIdx++] = 0xF0 | (u >> 18);
      outU8Array[outIdx++] = 0x80 | ((u >> 12) & 63);
      outU8Array[outIdx++] = 0x80 | ((u >> 6) & 63);
      outU8Array[outIdx++] = 0x80 | (u & 63);
    }
  }
  // Null-terminate the pointer to the buffer.
  outU8Array[outIdx] = 0;
  return outIdx - startIdx;
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF8 form. The copy will require at most str.length*4+1 bytes of space in the HEAP.
// Use the function lengthBytesUTF8 to compute the exact number of bytes (excluding null terminator) that this function will write.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF8(str, outPtr, maxBytesToWrite) {
  return stringToUTF8Array(str, HEAPU8,outPtr, maxBytesToWrite);
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF8 byte array, EXCLUDING the null terminator byte.
function lengthBytesUTF8(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! So decode UTF16->UTF32->UTF8.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var u = str.charCodeAt(i); // possibly a lead surrogate
    if (u >= 0xD800 && u <= 0xDFFF) u = 0x10000 + ((u & 0x3FF) << 10) | (str.charCodeAt(++i) & 0x3FF);
    if (u <= 0x7F) ++len;
    else if (u <= 0x7FF) len += 2;
    else if (u <= 0xFFFF) len += 3;
    else len += 4;
  }
  return len;
}


// Given a pointer 'ptr' to a null-terminated UTF16LE-encoded string in the emscripten HEAP, returns
// a copy of that string as a Javascript String object.

var UTF16Decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder('utf-16le') : undefined;
function UTF16ToString(ptr) {
  var endPtr = ptr;
  // TextDecoder needs to know the byte length in advance, it doesn't stop on null terminator by itself.
  // Also, use the length info to avoid running tiny strings through TextDecoder, since .subarray() allocates garbage.
  var idx = endPtr >> 1;
  while (HEAP16[idx]) ++idx;
  endPtr = idx << 1;

  if (endPtr - ptr > 32 && UTF16Decoder) {
    return UTF16Decoder.decode(HEAPU8.subarray(ptr, endPtr));
  } else {
    var i = 0;

    var str = '';
    while (1) {
      var codeUnit = HEAP16[(((ptr)+(i*2))>>1)];
      if (codeUnit == 0) return str;
      ++i;
      // fromCharCode constructs a character from a UTF-16 code unit, so we can pass the UTF16 string right through.
      str += String.fromCharCode(codeUnit);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF16 form. The copy will require at most str.length*4+2 bytes of space in the HEAP.
// Use the function lengthBytesUTF16() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=2, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<2 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF16(str, outPtr, maxBytesToWrite) {
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 2) return 0;
  maxBytesToWrite -= 2; // Null terminator.
  var startPtr = outPtr;
  var numCharsToWrite = (maxBytesToWrite < str.length*2) ? (maxBytesToWrite / 2) : str.length;
  for (var i = 0; i < numCharsToWrite; ++i) {
    // charCodeAt returns a UTF-16 encoded code unit, so it can be directly written to the HEAP.
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    HEAP16[((outPtr)>>1)]=codeUnit;
    outPtr += 2;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP16[((outPtr)>>1)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF16(str) {
  return str.length*2;
}

function UTF32ToString(ptr) {
  var i = 0;

  var str = '';
  while (1) {
    var utf32 = HEAP32[(((ptr)+(i*4))>>2)];
    if (utf32 == 0)
      return str;
    ++i;
    // Gotcha: fromCharCode constructs a character from a UTF-16 encoded code (pair), not from a Unicode code point! So encode the code point to UTF-16 for constructing.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    if (utf32 >= 0x10000) {
      var ch = utf32 - 0x10000;
      str += String.fromCharCode(0xD800 | (ch >> 10), 0xDC00 | (ch & 0x3FF));
    } else {
      str += String.fromCharCode(utf32);
    }
  }
}

// Copies the given Javascript String object 'str' to the emscripten HEAP at address 'outPtr',
// null-terminated and encoded in UTF32 form. The copy will require at most str.length*4+4 bytes of space in the HEAP.
// Use the function lengthBytesUTF32() to compute the exact number of bytes (excluding null terminator) that this function will write.
// Parameters:
//   str: the Javascript string to copy.
//   outPtr: Byte address in Emscripten HEAP where to write the string to.
//   maxBytesToWrite: The maximum number of bytes this function can write to the array. This count should include the null
//                    terminator, i.e. if maxBytesToWrite=4, only the null terminator will be written and nothing else.
//                    maxBytesToWrite<4 does not write any bytes to the output, not even the null terminator.
// Returns the number of bytes written, EXCLUDING the null terminator.

function stringToUTF32(str, outPtr, maxBytesToWrite) {
  // Backwards compatibility: if max bytes is not specified, assume unsafe unbounded write is allowed.
  if (maxBytesToWrite === undefined) {
    maxBytesToWrite = 0x7FFFFFFF;
  }
  if (maxBytesToWrite < 4) return 0;
  var startPtr = outPtr;
  var endPtr = startPtr + maxBytesToWrite - 4;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i); // possibly a lead surrogate
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) {
      var trailSurrogate = str.charCodeAt(++i);
      codeUnit = 0x10000 + ((codeUnit & 0x3FF) << 10) | (trailSurrogate & 0x3FF);
    }
    HEAP32[((outPtr)>>2)]=codeUnit;
    outPtr += 4;
    if (outPtr + 4 > endPtr) break;
  }
  // Null-terminate the pointer to the HEAP.
  HEAP32[((outPtr)>>2)]=0;
  return outPtr - startPtr;
}

// Returns the number of bytes the given Javascript string takes if encoded as a UTF16 byte array, EXCLUDING the null terminator byte.

function lengthBytesUTF32(str) {
  var len = 0;
  for (var i = 0; i < str.length; ++i) {
    // Gotcha: charCodeAt returns a 16-bit word that is a UTF-16 encoded code unit, not a Unicode code point of the character! We must decode the string to UTF-32 to the heap.
    // See http://unicode.org/faq/utf_bom.html#utf16-3
    var codeUnit = str.charCodeAt(i);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDFFF) ++i; // possibly a lead surrogate, so skip over the tail surrogate.
    len += 4;
  }

  return len;
}

// Allocate heap space for a JS string, and write it there.
// It is the responsibility of the caller to free() that memory.
function allocateUTF8(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = _malloc(size);
  if (ret) stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

// Allocate stack space for a JS string, and write it there.
function allocateUTF8OnStack(str) {
  var size = lengthBytesUTF8(str) + 1;
  var ret = stackAlloc(size);
  stringToUTF8Array(str, HEAP8, ret, size);
  return ret;
}

// Deprecated: This function should not be called because it is unsafe and does not provide
// a maximum length limit of how many bytes it is allowed to write. Prefer calling the
// function stringToUTF8Array() instead, which takes in a maximum length that can be used
// to be secure from out of bounds writes.
/** @deprecated */
function writeStringToMemory(string, buffer, dontAddNull) {
  warnOnce('writeStringToMemory is deprecated and should not be called! Use stringToUTF8() instead!');

  var /** @type {number} */ lastChar, /** @type {number} */ end;
  if (dontAddNull) {
    // stringToUTF8Array always appends null. If we don't want to do that, remember the
    // character that existed at the location where the null will be placed, and restore
    // that after the write (below).
    end = buffer + lengthBytesUTF8(string);
    lastChar = HEAP8[end];
  }
  stringToUTF8(string, buffer, Infinity);
  if (dontAddNull) HEAP8[end] = lastChar; // Restore the value under the null character.
}

function writeArrayToMemory(array, buffer) {
  HEAP8.set(array, buffer);
}

function writeAsciiToMemory(str, buffer, dontAddNull) {
  for (var i = 0; i < str.length; ++i) {
    HEAP8[((buffer++)>>0)]=str.charCodeAt(i);
  }
  // Null-terminate the pointer to the HEAP.
  if (!dontAddNull) HEAP8[((buffer)>>0)]=0;
}





function demangle(func) {
  return func;
}

function demangleAll(text) {
  var regex =
    /__Z[\w\d_]+/g;
  return text.replace(regex,
    function(x) {
      var y = demangle(x);
      return x === y ? x : (y + ' [' + x + ']');
    });
}

function jsStackTrace() {
  var err = new Error();
  if (!err.stack) {
    // IE10+ special cases: It does have callstack info, but it is only populated if an Error object is thrown,
    // so try that as a special-case.
    try {
      throw new Error(0);
    } catch(e) {
      err = e;
    }
    if (!err.stack) {
      return '(no stack trace available)';
    }
  }
  return err.stack.toString();
}

function stackTrace() {
  var js = jsStackTrace();
  if (Module['extraStackTrace']) js += '\n' + Module['extraStackTrace']();
  return demangleAll(js);
}



// Memory management

var PAGE_SIZE = 16384;
var WASM_PAGE_SIZE = 65536;
var ASMJS_PAGE_SIZE = 16777216;

function alignUp(x, multiple) {
  if (x % multiple > 0) {
    x += multiple - (x % multiple);
  }
  return x;
}

var HEAP,
/** @type {ArrayBuffer} */
  buffer,
/** @type {Int8Array} */
  HEAP8,
/** @type {Uint8Array} */
  HEAPU8,
/** @type {Int16Array} */
  HEAP16,
/** @type {Uint16Array} */
  HEAPU16,
/** @type {Int32Array} */
  HEAP32,
/** @type {Uint32Array} */
  HEAPU32,
/** @type {Float32Array} */
  HEAPF32,
/** @type {Float64Array} */
  HEAPF64;

function updateGlobalBufferViews() {
  Module['HEAP8'] = HEAP8 = new Int8Array(buffer);
  Module['HEAP16'] = HEAP16 = new Int16Array(buffer);
  Module['HEAP32'] = HEAP32 = new Int32Array(buffer);
  Module['HEAPU8'] = HEAPU8 = new Uint8Array(buffer);
  Module['HEAPU16'] = HEAPU16 = new Uint16Array(buffer);
  Module['HEAPU32'] = HEAPU32 = new Uint32Array(buffer);
  Module['HEAPF32'] = HEAPF32 = new Float32Array(buffer);
  Module['HEAPF64'] = HEAPF64 = new Float64Array(buffer);
}


var STATIC_BASE = 8,
    STACK_BASE = 33216,
    STACKTOP = STACK_BASE,
    STACK_MAX = 5276096,
    DYNAMIC_BASE = 5276096,
    DYNAMICTOP_PTR = 33184;




var TOTAL_STACK = 5242880;

var INITIAL_TOTAL_MEMORY = Module['TOTAL_MEMORY'] || 16777216;
if (INITIAL_TOTAL_MEMORY < TOTAL_STACK) err('TOTAL_MEMORY should be larger than TOTAL_STACK, was ' + INITIAL_TOTAL_MEMORY + '! (TOTAL_STACK=' + TOTAL_STACK + ')');

// Initialize the runtime's memory







// Use a provided buffer, if there is one, or else allocate a new one
if (Module['buffer']) {
  buffer = Module['buffer'];
} else {
  // Use a WebAssembly memory where available
  {
    buffer = new ArrayBuffer(INITIAL_TOTAL_MEMORY);
  }
}
updateGlobalBufferViews();


HEAP32[DYNAMICTOP_PTR>>2] = DYNAMIC_BASE;






// Endianness check (note: assumes compiler arch was little-endian)

function callRuntimeCallbacks(callbacks) {
  while(callbacks.length > 0) {
    var callback = callbacks.shift();
    if (typeof callback == 'function') {
      callback();
      continue;
    }
    var func = callback.func;
    if (typeof func === 'number') {
      if (callback.arg === undefined) {
        Module['dynCall_v'](func);
      } else {
        Module['dynCall_vi'](func, callback.arg);
      }
    } else {
      func(callback.arg === undefined ? null : callback.arg);
    }
  }
}

var __ATPRERUN__  = []; // functions called before the runtime is initialized
var __ATINIT__    = []; // functions called during startup
var __ATMAIN__    = []; // functions called when main() is to be run
var __ATEXIT__    = []; // functions called during shutdown
var __ATPOSTRUN__ = []; // functions called after the main() is called

var runtimeInitialized = false;
var runtimeExited = false;


function preRun() {
  // compatibility - merge in anything from Module['preRun'] at this time
  if (Module['preRun']) {
    if (typeof Module['preRun'] == 'function') Module['preRun'] = [Module['preRun']];
    while (Module['preRun'].length) {
      addOnPreRun(Module['preRun'].shift());
    }
  }
  callRuntimeCallbacks(__ATPRERUN__);
}

function ensureInitRuntime() {
  if (runtimeInitialized) return;
  runtimeInitialized = true;
  
  callRuntimeCallbacks(__ATINIT__);
}

function preMain() {
  
  callRuntimeCallbacks(__ATMAIN__);
}

function exitRuntime() {
  runtimeExited = true;
}

function postRun() {
  // compatibility - merge in anything from Module['postRun'] at this time
  if (Module['postRun']) {
    if (typeof Module['postRun'] == 'function') Module['postRun'] = [Module['postRun']];
    while (Module['postRun'].length) {
      addOnPostRun(Module['postRun'].shift());
    }
  }
  callRuntimeCallbacks(__ATPOSTRUN__);
}

function addOnPreRun(cb) {
  __ATPRERUN__.unshift(cb);
}

function addOnInit(cb) {
  __ATINIT__.unshift(cb);
}

function addOnPreMain(cb) {
  __ATMAIN__.unshift(cb);
}

function addOnExit(cb) {
}

function addOnPostRun(cb) {
  __ATPOSTRUN__.unshift(cb);
}

function unSign(value, bits, ignore) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2*Math.abs(1 << (bits-1)) + value // Need some trickery, since if bits == 32, we are right at the limit of the bits JS uses in bitshifts
                    : Math.pow(2, bits)         + value;
}
function reSign(value, bits, ignore) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << (bits-1)) // abs is needed if bits == 32
                        : Math.pow(2, bits-1);
  if (value >= half && (bits <= 32 || value > half)) { // for huge values, we can hit the precision limit and always get true here. so don't do that
                                                       // but, in general there is no perfect solution here. With 64-bit ints, we get rounding and errors
                                                       // TODO: In i64 mode 1, resign the two parts separately and safely
    value = -2*half + value; // Cannot bitshift half, as it may be at the limit of the bits JS uses in bitshifts
  }
  return value;
}



var Math_abs = Math.abs;
var Math_cos = Math.cos;
var Math_sin = Math.sin;
var Math_tan = Math.tan;
var Math_acos = Math.acos;
var Math_asin = Math.asin;
var Math_atan = Math.atan;
var Math_atan2 = Math.atan2;
var Math_exp = Math.exp;
var Math_log = Math.log;
var Math_sqrt = Math.sqrt;
var Math_ceil = Math.ceil;
var Math_floor = Math.floor;
var Math_pow = Math.pow;
var Math_imul = Math.imul;
var Math_fround = Math.fround;
var Math_round = Math.round;
var Math_min = Math.min;
var Math_max = Math.max;
var Math_clz32 = Math.clz32;
var Math_trunc = Math.trunc;



// A counter of dependencies for calling run(). If we need to
// do asynchronous work before running, increment this and
// decrement it. Incrementing must happen in a place like
// Module.preRun (used by emcc to add file preloading).
// Note that you can add dependencies in preRun, even though
// it happens right before run - run will be postponed until
// the dependencies are met.
var runDependencies = 0;
var runDependencyWatcher = null;
var dependenciesFulfilled = null; // overridden to take different actions when all run dependencies are fulfilled

function getUniqueRunDependency(id) {
  return id;
}

function addRunDependency(id) {
  runDependencies++;
  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }
}

function removeRunDependency(id) {
  runDependencies--;
  if (Module['monitorRunDependencies']) {
    Module['monitorRunDependencies'](runDependencies);
  }
  if (runDependencies == 0) {
    if (runDependencyWatcher !== null) {
      clearInterval(runDependencyWatcher);
      runDependencyWatcher = null;
    }
    if (dependenciesFulfilled) {
      var callback = dependenciesFulfilled;
      dependenciesFulfilled = null;
      callback(); // can add another dependenciesFulfilled
    }
  }
}

Module["preloadedImages"] = {}; // maps url to image data
Module["preloadedAudios"] = {}; // maps url to audio data


var memoryInitializer = null;






// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

// Prefix of data URIs emitted by SINGLE_FILE and related options.
var dataURIPrefix = 'data:application/octet-stream;base64,';

// Indicates whether filename is a base64 data URI.
function isDataURI(filename) {
  return String.prototype.startsWith ?
      filename.startsWith(dataURIPrefix) :
      filename.indexOf(dataURIPrefix) === 0;
}





// === Body ===

var ASM_CONSTS = [];





// STATICTOP = STATIC_BASE + 33208;
/* global initializers */ /*__ATINIT__.push();*/


memoryInitializer = "data:application/octet-stream;base64,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";





/* no memory initializer */
var tempDoublePtr = 33200

function copyTempFloat(ptr) { // functions, because inlining this code increases code size too much
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
}

function copyTempDouble(ptr) {
  HEAP8[tempDoublePtr] = HEAP8[ptr];
  HEAP8[tempDoublePtr+1] = HEAP8[ptr+1];
  HEAP8[tempDoublePtr+2] = HEAP8[ptr+2];
  HEAP8[tempDoublePtr+3] = HEAP8[ptr+3];
  HEAP8[tempDoublePtr+4] = HEAP8[ptr+4];
  HEAP8[tempDoublePtr+5] = HEAP8[ptr+5];
  HEAP8[tempDoublePtr+6] = HEAP8[ptr+6];
  HEAP8[tempDoublePtr+7] = HEAP8[ptr+7];
}

// {{PRE_LIBRARY}}


  
    

   

   

   

  function _emscripten_get_heap_size() {
      return HEAP8.length;
    }

   

   

  
  function _emscripten_memcpy_big(dest, src, num) {
      HEAPU8.set(HEAPU8.subarray(src, src+num), dest);
    }
  
   

   

  
  function ___setErrNo(value) {
      if (Module['___errno_location']) HEAP32[((Module['___errno_location']())>>2)]=value;
      return value;
    }
  
  
  function abortOnCannotGrowMemory(requestedSize) {
      abort('OOM');
    }function _emscripten_resize_heap(requestedSize) {
      abortOnCannotGrowMemory(requestedSize);
    } 
var ASSERTIONS = false;

// Copyright 2017 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

/** @type {function(string, boolean=, number=)} */
function intArrayFromString(stringy, dontAddNull, length) {
  var len = length > 0 ? length : lengthBytesUTF8(stringy)+1;
  var u8array = new Array(len);
  var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
  if (dontAddNull) u8array.length = numBytesWritten;
  return u8array;
}

function intArrayToString(array) {
  var ret = [];
  for (var i = 0; i < array.length; i++) {
    var chr = array[i];
    if (chr > 0xFF) {
      if (ASSERTIONS) {
        assert(false, 'Character code ' + chr + ' (' + String.fromCharCode(chr) + ')  at offset ' + i + ' not in 0x00-0xFF.');
      }
      chr &= 0xFF;
    }
    ret.push(String.fromCharCode(chr));
  }
  return ret.join('');
}


// Copied from https://github.com/strophe/strophejs/blob/e06d027/src/polyfills.js#L149

// This code was written by Tyler Akins and has been placed in the
// public domain.  It would be nice if you left this header intact.
// Base64 code from Tyler Akins -- http://rumkin.com

/**
 * Decodes a base64 string.
 * @param {String} input The string to decode.
 */
var decodeBase64 = typeof atob === 'function' ? atob : function (input) {
  var keyStr = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';

  var output = '';
  var chr1, chr2, chr3;
  var enc1, enc2, enc3, enc4;
  var i = 0;
  // remove all characters that are not A-Z, a-z, 0-9, +, /, or =
  input = input.replace(/[^A-Za-z0-9\+\/\=]/g, '');
  do {
    enc1 = keyStr.indexOf(input.charAt(i++));
    enc2 = keyStr.indexOf(input.charAt(i++));
    enc3 = keyStr.indexOf(input.charAt(i++));
    enc4 = keyStr.indexOf(input.charAt(i++));

    chr1 = (enc1 << 2) | (enc2 >> 4);
    chr2 = ((enc2 & 15) << 4) | (enc3 >> 2);
    chr3 = ((enc3 & 3) << 6) | enc4;

    output = output + String.fromCharCode(chr1);

    if (enc3 !== 64) {
      output = output + String.fromCharCode(chr2);
    }
    if (enc4 !== 64) {
      output = output + String.fromCharCode(chr3);
    }
  } while (i < input.length);
  return output;
};

// Converts a string of base64 into a byte array.
// Throws error on invalid input.
function intArrayFromBase64(s) {
  if (typeof ENVIRONMENT_IS_NODE === 'boolean' && ENVIRONMENT_IS_NODE) {
    var buf;
    try {
      buf = Buffer.from(s, 'base64');
    } catch (_) {
      buf = new Buffer(s, 'base64');
    }
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  try {
    var decoded = decodeBase64(s);
    var bytes = new Uint8Array(decoded.length);
    for (var i = 0 ; i < decoded.length ; ++i) {
      bytes[i] = decoded.charCodeAt(i);
    }
    return bytes;
  } catch (_) {
    throw new Error('Converting base64 string to bytes failed.');
  }
}

// If filename is a base64 data URI, parses and returns data (Buffer on node,
// Uint8Array otherwise). If filename is not a base64 data URI, returns undefined.
function tryParseAsDataURI(filename) {
  if (!isDataURI(filename)) {
    return;
  }

  return intArrayFromBase64(filename.slice(dataURIPrefix.length));
}


// ASM_LIBRARY EXTERN PRIMITIVES: Math_imul,Int8Array,Int32Array


var asmGlobalArg = { "Math": Math, "Int8Array": Int8Array, "Int32Array": Int32Array, "Uint8Array": Uint8Array }

var asmLibraryArg = {
  "a": abort,
  "b": setTempRet0,
  "c": getTempRet0,
  "d": ___setErrNo,
  "e": _emscripten_get_heap_size,
  "f": _emscripten_memcpy_big,
  "g": _emscripten_resize_heap,
  "h": abortOnCannotGrowMemory,
  "i": tempDoublePtr,
  "j": DYNAMICTOP_PTR
}
// EMSCRIPTEN_START_ASM
var asm = (/** @suppress {uselessCode} */ function(global, env, buffer) {
'use asm';

  var HEAP8 = new global.Int8Array(buffer),
  HEAP32 = new global.Int32Array(buffer),
  HEAPU8 = new global.Uint8Array(buffer),
  tempDoublePtr=env.i|0,
  DYNAMICTOP_PTR=env.j|0,
  __THREW__ = 0,
  threwValue = 0,
  setjmpId = 0,
  tempInt = 0,
  tempBigInt = 0,
  tempBigIntS = 0,
  tempValue = 0,
  tempDouble = 0.0,
  Math_imul=global.Math.imul,
  abort=env.a,
  setTempRet0=env.b,
  getTempRet0=env.c,
  ___setErrNo=env.d,
  _emscripten_get_heap_size=env.e,
  _emscripten_memcpy_big=env.f,
  _emscripten_resize_heap=env.g,
  abortOnCannotGrowMemory=env.h,
  STACKTOP = 33216,
  STACK_MAX = 5276096,
  tempFloat = 0.0;

// EMSCRIPTEN_START_FUNCS

function stackAlloc(size) {
  size = size|0;
  var ret = 0;
  ret = STACKTOP;
  STACKTOP = (STACKTOP + size)|0;
  STACKTOP = (STACKTOP + 15)&-16;
  
  return ret|0;
}
function stackSave() {
  return STACKTOP|0;
}
function stackRestore(top) {
  top = top|0;
  STACKTOP = top;
}
function establishStackSpace(stackBase, stackMax) {
  stackBase = stackBase|0;
  stackMax = stackMax|0;
  STACKTOP = stackBase;
  STACK_MAX = stackMax;
}

function _create_keypair($public_key,$private_key,$seed) {
 $public_key = $public_key|0;
 $private_key = $private_key|0;
 $seed = $seed|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 _ed25519_create_keypair($public_key,$private_key,$seed);
 return;
}
function _sign($signature,$message,$message_len,$public_key,$private_key) {
 $signature = $signature|0;
 $message = $message|0;
 $message_len = $message_len|0;
 $public_key = $public_key|0;
 $private_key = $private_key|0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 _ed25519_sign($signature,$message,$message_len,$public_key,$private_key);
 return;
}
function _verify($signature,$message,$message_len,$public_key) {
 $signature = $signature|0;
 $message = $message|0;
 $message_len = $message_len|0;
 $public_key = $public_key|0;
 var $call = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $call = (_ed25519_verify($signature,$message,$message_len,$public_key)|0);
 return ($call|0);
}
function _fe_0($h) {
 $h = $h|0;
 var dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 dest=$h; stop=dest+40|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
 return;
}
function _fe_1($h) {
 $h = $h|0;
 var $arrayidx1 = 0, dest = 0, label = 0, sp = 0, stop = 0;
 sp = STACKTOP;
 HEAP32[$h>>2] = 1;
 $arrayidx1 = ((($h)) + 4|0);
 dest=$arrayidx1; stop=dest+36|0; do { HEAP32[dest>>2]=0|0; dest=dest+4|0; } while ((dest|0) < (stop|0));
 return;
}
function _fe_add($h,$f,$g) {
 $h = $h|0;
 $f = $f|0;
 $g = $g|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0;
 var $add = 0, $add20 = 0, $add21 = 0, $add22 = 0, $add23 = 0, $add24 = 0, $add25 = 0, $add26 = 0, $add27 = 0, $add28 = 0, $arrayidx1 = 0, $arrayidx11 = 0, $arrayidx12 = 0, $arrayidx13 = 0, $arrayidx14 = 0, $arrayidx15 = 0, $arrayidx16 = 0, $arrayidx17 = 0, $arrayidx18 = 0, $arrayidx19 = 0;
 var $arrayidx2 = 0, $arrayidx3 = 0, $arrayidx30 = 0, $arrayidx31 = 0, $arrayidx32 = 0, $arrayidx33 = 0, $arrayidx34 = 0, $arrayidx35 = 0, $arrayidx36 = 0, $arrayidx37 = 0, $arrayidx38 = 0, $arrayidx4 = 0, $arrayidx5 = 0, $arrayidx6 = 0, $arrayidx7 = 0, $arrayidx8 = 0, $arrayidx9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[$f>>2]|0;
 $arrayidx1 = ((($f)) + 4|0);
 $1 = HEAP32[$arrayidx1>>2]|0;
 $arrayidx2 = ((($f)) + 8|0);
 $2 = HEAP32[$arrayidx2>>2]|0;
 $arrayidx3 = ((($f)) + 12|0);
 $3 = HEAP32[$arrayidx3>>2]|0;
 $arrayidx4 = ((($f)) + 16|0);
 $4 = HEAP32[$arrayidx4>>2]|0;
 $arrayidx5 = ((($f)) + 20|0);
 $5 = HEAP32[$arrayidx5>>2]|0;
 $arrayidx6 = ((($f)) + 24|0);
 $6 = HEAP32[$arrayidx6>>2]|0;
 $arrayidx7 = ((($f)) + 28|0);
 $7 = HEAP32[$arrayidx7>>2]|0;
 $arrayidx8 = ((($f)) + 32|0);
 $8 = HEAP32[$arrayidx8>>2]|0;
 $arrayidx9 = ((($f)) + 36|0);
 $9 = HEAP32[$arrayidx9>>2]|0;
 $10 = HEAP32[$g>>2]|0;
 $arrayidx11 = ((($g)) + 4|0);
 $11 = HEAP32[$arrayidx11>>2]|0;
 $arrayidx12 = ((($g)) + 8|0);
 $12 = HEAP32[$arrayidx12>>2]|0;
 $arrayidx13 = ((($g)) + 12|0);
 $13 = HEAP32[$arrayidx13>>2]|0;
 $arrayidx14 = ((($g)) + 16|0);
 $14 = HEAP32[$arrayidx14>>2]|0;
 $arrayidx15 = ((($g)) + 20|0);
 $15 = HEAP32[$arrayidx15>>2]|0;
 $arrayidx16 = ((($g)) + 24|0);
 $16 = HEAP32[$arrayidx16>>2]|0;
 $arrayidx17 = ((($g)) + 28|0);
 $17 = HEAP32[$arrayidx17>>2]|0;
 $arrayidx18 = ((($g)) + 32|0);
 $18 = HEAP32[$arrayidx18>>2]|0;
 $arrayidx19 = ((($g)) + 36|0);
 $19 = HEAP32[$arrayidx19>>2]|0;
 $add = (($10) + ($0))|0;
 $add20 = (($11) + ($1))|0;
 $add21 = (($12) + ($2))|0;
 $add22 = (($13) + ($3))|0;
 $add23 = (($14) + ($4))|0;
 $add24 = (($15) + ($5))|0;
 $add25 = (($16) + ($6))|0;
 $add26 = (($17) + ($7))|0;
 $add27 = (($18) + ($8))|0;
 $add28 = (($19) + ($9))|0;
 HEAP32[$h>>2] = $add;
 $arrayidx30 = ((($h)) + 4|0);
 HEAP32[$arrayidx30>>2] = $add20;
 $arrayidx31 = ((($h)) + 8|0);
 HEAP32[$arrayidx31>>2] = $add21;
 $arrayidx32 = ((($h)) + 12|0);
 HEAP32[$arrayidx32>>2] = $add22;
 $arrayidx33 = ((($h)) + 16|0);
 HEAP32[$arrayidx33>>2] = $add23;
 $arrayidx34 = ((($h)) + 20|0);
 HEAP32[$arrayidx34>>2] = $add24;
 $arrayidx35 = ((($h)) + 24|0);
 HEAP32[$arrayidx35>>2] = $add25;
 $arrayidx36 = ((($h)) + 28|0);
 HEAP32[$arrayidx36>>2] = $add26;
 $arrayidx37 = ((($h)) + 32|0);
 HEAP32[$arrayidx37>>2] = $add27;
 $arrayidx38 = ((($h)) + 36|0);
 HEAP32[$arrayidx38>>2] = $add28;
 return;
}
function _fe_cmov($f,$g,$b) {
 $f = $f|0;
 $g = $g|0;
 $b = $b|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0;
 var $and = 0, $and29 = 0, $and30 = 0, $and31 = 0, $and32 = 0, $and33 = 0, $and34 = 0, $and35 = 0, $and36 = 0, $and37 = 0, $arrayidx1 = 0, $arrayidx11 = 0, $arrayidx12 = 0, $arrayidx13 = 0, $arrayidx14 = 0, $arrayidx15 = 0, $arrayidx16 = 0, $arrayidx17 = 0, $arrayidx18 = 0, $arrayidx19 = 0;
 var $arrayidx2 = 0, $arrayidx3 = 0, $arrayidx4 = 0, $arrayidx5 = 0, $arrayidx6 = 0, $arrayidx7 = 0, $arrayidx8 = 0, $arrayidx9 = 0, $sub = 0, $xor = 0, $xor20 = 0, $xor21 = 0, $xor22 = 0, $xor23 = 0, $xor24 = 0, $xor25 = 0, $xor26 = 0, $xor27 = 0, $xor28 = 0, $xor38 = 0;
 var $xor40 = 0, $xor42 = 0, $xor44 = 0, $xor46 = 0, $xor48 = 0, $xor50 = 0, $xor52 = 0, $xor54 = 0, $xor56 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[$f>>2]|0;
 $arrayidx1 = ((($f)) + 4|0);
 $1 = HEAP32[$arrayidx1>>2]|0;
 $arrayidx2 = ((($f)) + 8|0);
 $2 = HEAP32[$arrayidx2>>2]|0;
 $arrayidx3 = ((($f)) + 12|0);
 $3 = HEAP32[$arrayidx3>>2]|0;
 $arrayidx4 = ((($f)) + 16|0);
 $4 = HEAP32[$arrayidx4>>2]|0;
 $arrayidx5 = ((($f)) + 20|0);
 $5 = HEAP32[$arrayidx5>>2]|0;
 $arrayidx6 = ((($f)) + 24|0);
 $6 = HEAP32[$arrayidx6>>2]|0;
 $arrayidx7 = ((($f)) + 28|0);
 $7 = HEAP32[$arrayidx7>>2]|0;
 $arrayidx8 = ((($f)) + 32|0);
 $8 = HEAP32[$arrayidx8>>2]|0;
 $arrayidx9 = ((($f)) + 36|0);
 $9 = HEAP32[$arrayidx9>>2]|0;
 $10 = HEAP32[$g>>2]|0;
 $arrayidx11 = ((($g)) + 4|0);
 $11 = HEAP32[$arrayidx11>>2]|0;
 $arrayidx12 = ((($g)) + 8|0);
 $12 = HEAP32[$arrayidx12>>2]|0;
 $arrayidx13 = ((($g)) + 12|0);
 $13 = HEAP32[$arrayidx13>>2]|0;
 $arrayidx14 = ((($g)) + 16|0);
 $14 = HEAP32[$arrayidx14>>2]|0;
 $arrayidx15 = ((($g)) + 20|0);
 $15 = HEAP32[$arrayidx15>>2]|0;
 $arrayidx16 = ((($g)) + 24|0);
 $16 = HEAP32[$arrayidx16>>2]|0;
 $arrayidx17 = ((($g)) + 28|0);
 $17 = HEAP32[$arrayidx17>>2]|0;
 $arrayidx18 = ((($g)) + 32|0);
 $18 = HEAP32[$arrayidx18>>2]|0;
 $arrayidx19 = ((($g)) + 36|0);
 $19 = HEAP32[$arrayidx19>>2]|0;
 $xor = $10 ^ $0;
 $xor20 = $11 ^ $1;
 $xor21 = $12 ^ $2;
 $xor22 = $13 ^ $3;
 $xor23 = $14 ^ $4;
 $xor24 = $15 ^ $5;
 $xor25 = $16 ^ $6;
 $xor26 = $17 ^ $7;
 $xor27 = $18 ^ $8;
 $xor28 = $19 ^ $9;
 $sub = (0 - ($b))|0;
 $and = $xor & $sub;
 $and29 = $xor20 & $sub;
 $and30 = $xor21 & $sub;
 $and31 = $xor22 & $sub;
 $and32 = $xor23 & $sub;
 $and33 = $xor24 & $sub;
 $and34 = $xor25 & $sub;
 $and35 = $xor26 & $sub;
 $and36 = $xor27 & $sub;
 $and37 = $xor28 & $sub;
 $xor38 = $and ^ $0;
 HEAP32[$f>>2] = $xor38;
 $xor40 = $and29 ^ $1;
 HEAP32[$arrayidx1>>2] = $xor40;
 $xor42 = $and30 ^ $2;
 HEAP32[$arrayidx2>>2] = $xor42;
 $xor44 = $and31 ^ $3;
 HEAP32[$arrayidx3>>2] = $xor44;
 $xor46 = $and32 ^ $4;
 HEAP32[$arrayidx4>>2] = $xor46;
 $xor48 = $and33 ^ $5;
 HEAP32[$arrayidx5>>2] = $xor48;
 $xor50 = $and34 ^ $6;
 HEAP32[$arrayidx6>>2] = $xor50;
 $xor52 = $and35 ^ $7;
 HEAP32[$arrayidx7>>2] = $xor52;
 $xor54 = $and36 ^ $8;
 HEAP32[$arrayidx8>>2] = $xor54;
 $xor56 = $and37 ^ $9;
 HEAP32[$arrayidx9>>2] = $xor56;
 return;
}
function _fe_copy($h,$f) {
 $h = $h|0;
 $f = $f|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $arrayidx1 = 0, $arrayidx11 = 0, $arrayidx12 = 0, $arrayidx13 = 0, $arrayidx14 = 0, $arrayidx15 = 0, $arrayidx16 = 0, $arrayidx17 = 0, $arrayidx18 = 0, $arrayidx19 = 0;
 var $arrayidx2 = 0, $arrayidx3 = 0, $arrayidx4 = 0, $arrayidx5 = 0, $arrayidx6 = 0, $arrayidx7 = 0, $arrayidx8 = 0, $arrayidx9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[$f>>2]|0;
 $arrayidx1 = ((($f)) + 4|0);
 $1 = HEAP32[$arrayidx1>>2]|0;
 $arrayidx2 = ((($f)) + 8|0);
 $2 = HEAP32[$arrayidx2>>2]|0;
 $arrayidx3 = ((($f)) + 12|0);
 $3 = HEAP32[$arrayidx3>>2]|0;
 $arrayidx4 = ((($f)) + 16|0);
 $4 = HEAP32[$arrayidx4>>2]|0;
 $arrayidx5 = ((($f)) + 20|0);
 $5 = HEAP32[$arrayidx5>>2]|0;
 $arrayidx6 = ((($f)) + 24|0);
 $6 = HEAP32[$arrayidx6>>2]|0;
 $arrayidx7 = ((($f)) + 28|0);
 $7 = HEAP32[$arrayidx7>>2]|0;
 $arrayidx8 = ((($f)) + 32|0);
 $8 = HEAP32[$arrayidx8>>2]|0;
 $arrayidx9 = ((($f)) + 36|0);
 $9 = HEAP32[$arrayidx9>>2]|0;
 HEAP32[$h>>2] = $0;
 $arrayidx11 = ((($h)) + 4|0);
 HEAP32[$arrayidx11>>2] = $1;
 $arrayidx12 = ((($h)) + 8|0);
 HEAP32[$arrayidx12>>2] = $2;
 $arrayidx13 = ((($h)) + 12|0);
 HEAP32[$arrayidx13>>2] = $3;
 $arrayidx14 = ((($h)) + 16|0);
 HEAP32[$arrayidx14>>2] = $4;
 $arrayidx15 = ((($h)) + 20|0);
 HEAP32[$arrayidx15>>2] = $5;
 $arrayidx16 = ((($h)) + 24|0);
 HEAP32[$arrayidx16>>2] = $6;
 $arrayidx17 = ((($h)) + 28|0);
 HEAP32[$arrayidx17>>2] = $7;
 $arrayidx18 = ((($h)) + 32|0);
 HEAP32[$arrayidx18>>2] = $8;
 $arrayidx19 = ((($h)) + 36|0);
 HEAP32[$arrayidx19>>2] = $9;
 return;
}
function _fe_frombytes($h,$s) {
 $h = $h|0;
 $s = $s|0;
 var $0 = 0, $1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0;
 var $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0;
 var $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0;
 var $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0;
 var $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0;
 var $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0;
 var $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, $add$ptr = 0, $add$ptr11 = 0, $add$ptr13 = 0, $add$ptr16 = 0, $add$ptr19 = 0, $add$ptr2 = 0, $add$ptr22 = 0, $add$ptr5 = 0, $add$ptr8 = 0, $arrayidx73 = 0;
 var $arrayidx75 = 0, $arrayidx77 = 0, $arrayidx79 = 0, $arrayidx81 = 0, $arrayidx83 = 0, $arrayidx85 = 0, $arrayidx87 = 0, $arrayidx89 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (_load_4($s)|0);
 $1 = (getTempRet0() | 0);
 $add$ptr = ((($s)) + 4|0);
 $2 = (_load_3($add$ptr)|0);
 $3 = (getTempRet0() | 0);
 $4 = (_bitshift64Shl(($2|0),($3|0),6)|0);
 $5 = (getTempRet0() | 0);
 $add$ptr2 = ((($s)) + 7|0);
 $6 = (_load_3($add$ptr2)|0);
 $7 = (getTempRet0() | 0);
 $8 = (_bitshift64Shl(($6|0),($7|0),5)|0);
 $9 = (getTempRet0() | 0);
 $add$ptr5 = ((($s)) + 10|0);
 $10 = (_load_3($add$ptr5)|0);
 $11 = (getTempRet0() | 0);
 $12 = (_bitshift64Shl(($10|0),($11|0),3)|0);
 $13 = (getTempRet0() | 0);
 $add$ptr8 = ((($s)) + 13|0);
 $14 = (_load_3($add$ptr8)|0);
 $15 = (getTempRet0() | 0);
 $16 = (_bitshift64Shl(($14|0),($15|0),2)|0);
 $17 = (getTempRet0() | 0);
 $add$ptr11 = ((($s)) + 16|0);
 $18 = (_load_4($add$ptr11)|0);
 $19 = (getTempRet0() | 0);
 $add$ptr13 = ((($s)) + 20|0);
 $20 = (_load_3($add$ptr13)|0);
 $21 = (getTempRet0() | 0);
 $22 = (_bitshift64Shl(($20|0),($21|0),7)|0);
 $23 = (getTempRet0() | 0);
 $add$ptr16 = ((($s)) + 23|0);
 $24 = (_load_3($add$ptr16)|0);
 $25 = (getTempRet0() | 0);
 $26 = (_bitshift64Shl(($24|0),($25|0),5)|0);
 $27 = (getTempRet0() | 0);
 $add$ptr19 = ((($s)) + 26|0);
 $28 = (_load_3($add$ptr19)|0);
 $29 = (getTempRet0() | 0);
 $30 = (_bitshift64Shl(($28|0),($29|0),4)|0);
 $31 = (getTempRet0() | 0);
 $add$ptr22 = ((($s)) + 29|0);
 $32 = (_load_3($add$ptr22)|0);
 $33 = (getTempRet0() | 0);
 $34 = (_bitshift64Shl(($32|0),($33|0),2)|0);
 $35 = (getTempRet0() | 0);
 $36 = $34 & 33554428;
 $37 = (_i64Add(($36|0),0,16777216,0)|0);
 $38 = (getTempRet0() | 0);
 $39 = (_bitshift64Lshr(($37|0),($38|0),25)|0);
 $40 = (getTempRet0() | 0);
 $41 = (_i64Subtract(0,0,($39|0),($40|0))|0);
 $42 = (getTempRet0() | 0);
 $43 = $41 & 19;
 $44 = (_i64Add(($43|0),0,($0|0),($1|0))|0);
 $45 = (getTempRet0() | 0);
 $46 = $37 & 33554432;
 $47 = (_i64Subtract(($36|0),0,($46|0),0)|0);
 $48 = (getTempRet0() | 0);
 $49 = (_i64Add(($4|0),($5|0),16777216,0)|0);
 $50 = (getTempRet0() | 0);
 $51 = (_bitshift64Ashr(($49|0),($50|0),25)|0);
 $52 = (getTempRet0() | 0);
 $53 = (_i64Add(($51|0),($52|0),($8|0),($9|0))|0);
 $54 = (getTempRet0() | 0);
 $55 = $49 & -33554432;
 $56 = (_i64Subtract(($4|0),($5|0),($55|0),0)|0);
 $57 = (getTempRet0() | 0);
 $58 = (_i64Add(($12|0),($13|0),16777216,0)|0);
 $59 = (getTempRet0() | 0);
 $60 = (_bitshift64Ashr(($58|0),($59|0),25)|0);
 $61 = (getTempRet0() | 0);
 $62 = (_i64Add(($60|0),($61|0),($16|0),($17|0))|0);
 $63 = (getTempRet0() | 0);
 $64 = $58 & -33554432;
 $65 = (_i64Subtract(($12|0),($13|0),($64|0),0)|0);
 $66 = (getTempRet0() | 0);
 $67 = (_i64Add(($18|0),($19|0),16777216,0)|0);
 $68 = (getTempRet0() | 0);
 $69 = (_bitshift64Ashr(($67|0),($68|0),25)|0);
 $70 = (getTempRet0() | 0);
 $71 = (_i64Add(($22|0),($23|0),($69|0),($70|0))|0);
 $72 = (getTempRet0() | 0);
 $73 = $67 & -33554432;
 $74 = (_i64Subtract(($18|0),($19|0),($73|0),0)|0);
 $75 = (getTempRet0() | 0);
 $76 = (_i64Add(($26|0),($27|0),16777216,0)|0);
 $77 = (getTempRet0() | 0);
 $78 = (_bitshift64Ashr(($76|0),($77|0),25)|0);
 $79 = (getTempRet0() | 0);
 $80 = (_i64Add(($78|0),($79|0),($30|0),($31|0))|0);
 $81 = (getTempRet0() | 0);
 $82 = $76 & -33554432;
 $83 = (_i64Subtract(($26|0),($27|0),($82|0),0)|0);
 $84 = (getTempRet0() | 0);
 $85 = (_i64Add(($44|0),($45|0),33554432,0)|0);
 $86 = (getTempRet0() | 0);
 $87 = (_bitshift64Lshr(($85|0),($86|0),26)|0);
 $88 = (getTempRet0() | 0);
 $89 = (_i64Add(($56|0),($57|0),($87|0),($88|0))|0);
 $90 = (getTempRet0() | 0);
 $91 = $85 & -67108864;
 $92 = (_i64Subtract(($44|0),($45|0),($91|0),0)|0);
 $93 = (getTempRet0() | 0);
 $94 = (_i64Add(($53|0),($54|0),33554432,0)|0);
 $95 = (getTempRet0() | 0);
 $96 = (_bitshift64Lshr(($94|0),($95|0),26)|0);
 $97 = (getTempRet0() | 0);
 $98 = (_i64Add(($65|0),($66|0),($96|0),($97|0))|0);
 $99 = (getTempRet0() | 0);
 $100 = $94 & -67108864;
 $101 = (_i64Subtract(($53|0),($54|0),($100|0),0)|0);
 $102 = (getTempRet0() | 0);
 $103 = (_i64Add(($62|0),($63|0),33554432,0)|0);
 $104 = (getTempRet0() | 0);
 $105 = (_bitshift64Lshr(($103|0),($104|0),26)|0);
 $106 = (getTempRet0() | 0);
 $107 = (_i64Add(($74|0),($75|0),($105|0),($106|0))|0);
 $108 = (getTempRet0() | 0);
 $109 = $103 & -67108864;
 $110 = (_i64Subtract(($62|0),($63|0),($109|0),0)|0);
 $111 = (getTempRet0() | 0);
 $112 = (_i64Add(($71|0),($72|0),33554432,0)|0);
 $113 = (getTempRet0() | 0);
 $114 = (_bitshift64Lshr(($112|0),($113|0),26)|0);
 $115 = (getTempRet0() | 0);
 $116 = (_i64Add(($83|0),($84|0),($114|0),($115|0))|0);
 $117 = (getTempRet0() | 0);
 $118 = $112 & -67108864;
 $119 = (_i64Subtract(($71|0),($72|0),($118|0),0)|0);
 $120 = (getTempRet0() | 0);
 $121 = (_i64Add(($80|0),($81|0),33554432,0)|0);
 $122 = (getTempRet0() | 0);
 $123 = (_bitshift64Lshr(($121|0),($122|0),26)|0);
 $124 = (getTempRet0() | 0);
 $125 = (_i64Add(($47|0),($48|0),($123|0),($124|0))|0);
 $126 = (getTempRet0() | 0);
 $127 = $121 & -67108864;
 $128 = (_i64Subtract(($80|0),($81|0),($127|0),0)|0);
 $129 = (getTempRet0() | 0);
 HEAP32[$h>>2] = $92;
 $arrayidx73 = ((($h)) + 4|0);
 HEAP32[$arrayidx73>>2] = $89;
 $arrayidx75 = ((($h)) + 8|0);
 HEAP32[$arrayidx75>>2] = $101;
 $arrayidx77 = ((($h)) + 12|0);
 HEAP32[$arrayidx77>>2] = $98;
 $arrayidx79 = ((($h)) + 16|0);
 HEAP32[$arrayidx79>>2] = $110;
 $arrayidx81 = ((($h)) + 20|0);
 HEAP32[$arrayidx81>>2] = $107;
 $arrayidx83 = ((($h)) + 24|0);
 HEAP32[$arrayidx83>>2] = $119;
 $arrayidx85 = ((($h)) + 28|0);
 HEAP32[$arrayidx85>>2] = $116;
 $arrayidx87 = ((($h)) + 32|0);
 HEAP32[$arrayidx87>>2] = $128;
 $arrayidx89 = ((($h)) + 36|0);
 HEAP32[$arrayidx89>>2] = $125;
 return;
}
function _load_4($in) {
 $in = $in|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $arrayidx1 = 0;
 var $arrayidx3 = 0, $arrayidx7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP8[$in>>0]|0;
 $1 = $0&255;
 $arrayidx1 = ((($in)) + 1|0);
 $2 = HEAP8[$arrayidx1>>0]|0;
 $3 = $2&255;
 $4 = (_bitshift64Shl(($3|0),0,8)|0);
 $5 = (getTempRet0() | 0);
 $6 = $4 | $1;
 $arrayidx3 = ((($in)) + 2|0);
 $7 = HEAP8[$arrayidx3>>0]|0;
 $8 = $7&255;
 $9 = (_bitshift64Shl(($8|0),0,16)|0);
 $10 = (getTempRet0() | 0);
 $11 = $6 | $9;
 $12 = $5 | $10;
 $arrayidx7 = ((($in)) + 3|0);
 $13 = HEAP8[$arrayidx7>>0]|0;
 $14 = $13&255;
 $15 = (_bitshift64Shl(($14|0),0,24)|0);
 $16 = (getTempRet0() | 0);
 $17 = $11 | $15;
 $18 = $12 | $16;
 setTempRet0(($18) | 0);
 return ($17|0);
}
function _load_3($in) {
 $in = $in|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $arrayidx1 = 0, $arrayidx3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP8[$in>>0]|0;
 $1 = $0&255;
 $arrayidx1 = ((($in)) + 1|0);
 $2 = HEAP8[$arrayidx1>>0]|0;
 $3 = $2&255;
 $4 = (_bitshift64Shl(($3|0),0,8)|0);
 $5 = (getTempRet0() | 0);
 $6 = $4 | $1;
 $arrayidx3 = ((($in)) + 2|0);
 $7 = HEAP8[$arrayidx3>>0]|0;
 $8 = $7&255;
 $9 = (_bitshift64Shl(($8|0),0,16)|0);
 $10 = (getTempRet0() | 0);
 $11 = $6 | $9;
 $12 = $5 | $10;
 setTempRet0(($12) | 0);
 return ($11|0);
}
function _fe_invert($out,$z) {
 $out = $out|0;
 $z = $z|0;
 var $exitcond = 0, $exitcond33 = 0, $exitcond34 = 0, $i$727 = 0, $i$826 = 0, $i$925 = 0, $inc104 = 0, $inc117 = 0, $inc91 = 0, $t0 = 0, $t1 = 0, $t2 = 0, $t3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 192|0;
 $t0 = sp + 144|0;
 $t1 = sp + 96|0;
 $t2 = sp + 48|0;
 $t3 = sp;
 _fe_sq($t0,$z);
 _fe_sq($t1,$t0);
 _fe_sq($t1,$t1);
 _fe_mul($t1,$z,$t1);
 _fe_mul($t0,$t0,$t1);
 _fe_sq($t2,$t0);
 _fe_mul($t1,$t1,$t2);
 _fe_sq($t2,$t1);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_mul($t1,$t2,$t1);
 _fe_sq($t2,$t1);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_mul($t2,$t2,$t1);
 _fe_sq($t3,$t2);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_sq($t3,$t3);
 _fe_mul($t2,$t3,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_mul($t1,$t2,$t1);
 _fe_sq($t2,$t1);
 $i$727 = 1;
 while(1) {
  _fe_sq($t2,$t2);
  $inc91 = (($i$727) + 1)|0;
  $exitcond34 = ($inc91|0)==(50);
  if ($exitcond34) {
   break;
  } else {
   $i$727 = $inc91;
  }
 }
 _fe_mul($t2,$t2,$t1);
 _fe_sq($t3,$t2);
 $i$826 = 1;
 while(1) {
  _fe_sq($t3,$t3);
  $inc104 = (($i$826) + 1)|0;
  $exitcond33 = ($inc104|0)==(100);
  if ($exitcond33) {
   break;
  } else {
   $i$826 = $inc104;
  }
 }
 _fe_mul($t2,$t3,$t2);
 _fe_sq($t2,$t2);
 $i$925 = 1;
 while(1) {
  _fe_sq($t2,$t2);
  $inc117 = (($i$925) + 1)|0;
  $exitcond = ($inc117|0)==(50);
  if ($exitcond) {
   break;
  } else {
   $i$925 = $inc117;
  }
 }
 _fe_mul($t1,$t2,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_mul($out,$t1,$t0);
 STACKTOP = sp;return;
}
function _fe_sq($h,$f) {
 $h = $h|0;
 $f = $f|0;
 var $0 = 0, $1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0;
 var $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0;
 var $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0;
 var $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0;
 var $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0;
 var $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0;
 var $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0;
 var $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0;
 var $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0;
 var $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $278 = 0;
 var $279 = 0, $28 = 0, $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $285 = 0, $286 = 0, $287 = 0, $288 = 0, $289 = 0, $29 = 0, $290 = 0, $291 = 0, $292 = 0, $293 = 0, $294 = 0, $295 = 0, $296 = 0;
 var $297 = 0, $298 = 0, $299 = 0, $3 = 0, $30 = 0, $300 = 0, $301 = 0, $302 = 0, $303 = 0, $304 = 0, $305 = 0, $306 = 0, $307 = 0, $308 = 0, $309 = 0, $31 = 0, $310 = 0, $311 = 0, $312 = 0, $313 = 0;
 var $314 = 0, $315 = 0, $316 = 0, $317 = 0, $318 = 0, $319 = 0, $32 = 0, $320 = 0, $321 = 0, $322 = 0, $323 = 0, $324 = 0, $325 = 0, $326 = 0, $327 = 0, $328 = 0, $329 = 0, $33 = 0, $330 = 0, $331 = 0;
 var $332 = 0, $333 = 0, $334 = 0, $335 = 0, $336 = 0, $337 = 0, $338 = 0, $339 = 0, $34 = 0, $340 = 0, $341 = 0, $342 = 0, $343 = 0, $344 = 0, $345 = 0, $346 = 0, $347 = 0, $348 = 0, $349 = 0, $35 = 0;
 var $350 = 0, $351 = 0, $352 = 0, $353 = 0, $354 = 0, $355 = 0, $356 = 0, $357 = 0, $358 = 0, $359 = 0, $36 = 0, $360 = 0, $361 = 0, $362 = 0, $363 = 0, $364 = 0, $365 = 0, $37 = 0, $38 = 0, $39 = 0;
 var $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0;
 var $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0;
 var $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0;
 var $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, $arrayidx1 = 0, $arrayidx2 = 0, $arrayidx291 = 0, $arrayidx293 = 0, $arrayidx295 = 0, $arrayidx297 = 0, $arrayidx299 = 0, $arrayidx3 = 0, $arrayidx301 = 0, $arrayidx303 = 0, $arrayidx305 = 0, $arrayidx307 = 0, $arrayidx4 = 0, $arrayidx5 = 0;
 var $arrayidx6 = 0, $arrayidx7 = 0, $arrayidx8 = 0, $arrayidx9 = 0, $mul = 0, $mul10 = 0, $mul11 = 0, $mul12 = 0, $mul13 = 0, $mul14 = 0, $mul15 = 0, $mul16 = 0, $mul17 = 0, $mul18 = 0, $mul19 = 0, $mul20 = 0, $mul21 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[$f>>2]|0;
 $arrayidx1 = ((($f)) + 4|0);
 $1 = HEAP32[$arrayidx1>>2]|0;
 $arrayidx2 = ((($f)) + 8|0);
 $2 = HEAP32[$arrayidx2>>2]|0;
 $arrayidx3 = ((($f)) + 12|0);
 $3 = HEAP32[$arrayidx3>>2]|0;
 $arrayidx4 = ((($f)) + 16|0);
 $4 = HEAP32[$arrayidx4>>2]|0;
 $arrayidx5 = ((($f)) + 20|0);
 $5 = HEAP32[$arrayidx5>>2]|0;
 $arrayidx6 = ((($f)) + 24|0);
 $6 = HEAP32[$arrayidx6>>2]|0;
 $arrayidx7 = ((($f)) + 28|0);
 $7 = HEAP32[$arrayidx7>>2]|0;
 $arrayidx8 = ((($f)) + 32|0);
 $8 = HEAP32[$arrayidx8>>2]|0;
 $arrayidx9 = ((($f)) + 36|0);
 $9 = HEAP32[$arrayidx9>>2]|0;
 $mul = $0 << 1;
 $mul10 = $1 << 1;
 $mul11 = $2 << 1;
 $mul12 = $3 << 1;
 $mul13 = $4 << 1;
 $mul14 = $5 << 1;
 $mul15 = $6 << 1;
 $mul16 = $7 << 1;
 $mul17 = ($5*38)|0;
 $mul18 = ($6*19)|0;
 $mul19 = ($7*38)|0;
 $mul20 = ($8*19)|0;
 $mul21 = ($9*38)|0;
 $10 = ($0|0)<(0);
 $11 = $10 << 31 >> 31;
 $12 = (___muldi3(($0|0),($11|0),($0|0),($11|0))|0);
 $13 = (getTempRet0() | 0);
 $14 = ($mul|0)<(0);
 $15 = $14 << 31 >> 31;
 $16 = ($1|0)<(0);
 $17 = $16 << 31 >> 31;
 $18 = (___muldi3(($mul|0),($15|0),($1|0),($17|0))|0);
 $19 = (getTempRet0() | 0);
 $20 = ($2|0)<(0);
 $21 = $20 << 31 >> 31;
 $22 = (___muldi3(($2|0),($21|0),($mul|0),($15|0))|0);
 $23 = (getTempRet0() | 0);
 $24 = ($3|0)<(0);
 $25 = $24 << 31 >> 31;
 $26 = (___muldi3(($3|0),($25|0),($mul|0),($15|0))|0);
 $27 = (getTempRet0() | 0);
 $28 = ($4|0)<(0);
 $29 = $28 << 31 >> 31;
 $30 = (___muldi3(($4|0),($29|0),($mul|0),($15|0))|0);
 $31 = (getTempRet0() | 0);
 $32 = ($5|0)<(0);
 $33 = $32 << 31 >> 31;
 $34 = (___muldi3(($5|0),($33|0),($mul|0),($15|0))|0);
 $35 = (getTempRet0() | 0);
 $36 = ($6|0)<(0);
 $37 = $36 << 31 >> 31;
 $38 = (___muldi3(($6|0),($37|0),($mul|0),($15|0))|0);
 $39 = (getTempRet0() | 0);
 $40 = ($7|0)<(0);
 $41 = $40 << 31 >> 31;
 $42 = (___muldi3(($7|0),($41|0),($mul|0),($15|0))|0);
 $43 = (getTempRet0() | 0);
 $44 = ($8|0)<(0);
 $45 = $44 << 31 >> 31;
 $46 = (___muldi3(($8|0),($45|0),($mul|0),($15|0))|0);
 $47 = (getTempRet0() | 0);
 $48 = ($9|0)<(0);
 $49 = $48 << 31 >> 31;
 $50 = (___muldi3(($9|0),($49|0),($mul|0),($15|0))|0);
 $51 = (getTempRet0() | 0);
 $52 = ($mul10|0)<(0);
 $53 = $52 << 31 >> 31;
 $54 = (___muldi3(($mul10|0),($53|0),($1|0),($17|0))|0);
 $55 = (getTempRet0() | 0);
 $56 = (___muldi3(($mul10|0),($53|0),($2|0),($21|0))|0);
 $57 = (getTempRet0() | 0);
 $58 = ($mul12|0)<(0);
 $59 = $58 << 31 >> 31;
 $60 = (___muldi3(($mul12|0),($59|0),($mul10|0),($53|0))|0);
 $61 = (getTempRet0() | 0);
 $62 = (___muldi3(($4|0),($29|0),($mul10|0),($53|0))|0);
 $63 = (getTempRet0() | 0);
 $64 = ($mul14|0)<(0);
 $65 = $64 << 31 >> 31;
 $66 = (___muldi3(($mul14|0),($65|0),($mul10|0),($53|0))|0);
 $67 = (getTempRet0() | 0);
 $68 = (___muldi3(($6|0),($37|0),($mul10|0),($53|0))|0);
 $69 = (getTempRet0() | 0);
 $70 = ($mul16|0)<(0);
 $71 = $70 << 31 >> 31;
 $72 = (___muldi3(($mul16|0),($71|0),($mul10|0),($53|0))|0);
 $73 = (getTempRet0() | 0);
 $74 = (___muldi3(($8|0),($45|0),($mul10|0),($53|0))|0);
 $75 = (getTempRet0() | 0);
 $76 = ($mul21|0)<(0);
 $77 = $76 << 31 >> 31;
 $78 = (___muldi3(($mul21|0),($77|0),($mul10|0),($53|0))|0);
 $79 = (getTempRet0() | 0);
 $80 = (___muldi3(($2|0),($21|0),($2|0),($21|0))|0);
 $81 = (getTempRet0() | 0);
 $82 = ($mul11|0)<(0);
 $83 = $82 << 31 >> 31;
 $84 = (___muldi3(($mul11|0),($83|0),($3|0),($25|0))|0);
 $85 = (getTempRet0() | 0);
 $86 = (___muldi3(($4|0),($29|0),($mul11|0),($83|0))|0);
 $87 = (getTempRet0() | 0);
 $88 = (___muldi3(($5|0),($33|0),($mul11|0),($83|0))|0);
 $89 = (getTempRet0() | 0);
 $90 = (___muldi3(($6|0),($37|0),($mul11|0),($83|0))|0);
 $91 = (getTempRet0() | 0);
 $92 = (___muldi3(($7|0),($41|0),($mul11|0),($83|0))|0);
 $93 = (getTempRet0() | 0);
 $94 = ($mul20|0)<(0);
 $95 = $94 << 31 >> 31;
 $96 = (___muldi3(($mul20|0),($95|0),($mul11|0),($83|0))|0);
 $97 = (getTempRet0() | 0);
 $98 = (___muldi3(($mul21|0),($77|0),($2|0),($21|0))|0);
 $99 = (getTempRet0() | 0);
 $100 = (___muldi3(($mul12|0),($59|0),($3|0),($25|0))|0);
 $101 = (getTempRet0() | 0);
 $102 = (___muldi3(($mul12|0),($59|0),($4|0),($29|0))|0);
 $103 = (getTempRet0() | 0);
 $104 = (___muldi3(($mul14|0),($65|0),($mul12|0),($59|0))|0);
 $105 = (getTempRet0() | 0);
 $106 = (___muldi3(($6|0),($37|0),($mul12|0),($59|0))|0);
 $107 = (getTempRet0() | 0);
 $108 = ($mul19|0)<(0);
 $109 = $108 << 31 >> 31;
 $110 = (___muldi3(($mul19|0),($109|0),($mul12|0),($59|0))|0);
 $111 = (getTempRet0() | 0);
 $112 = (___muldi3(($mul20|0),($95|0),($mul12|0),($59|0))|0);
 $113 = (getTempRet0() | 0);
 $114 = (___muldi3(($mul21|0),($77|0),($mul12|0),($59|0))|0);
 $115 = (getTempRet0() | 0);
 $116 = (___muldi3(($4|0),($29|0),($4|0),($29|0))|0);
 $117 = (getTempRet0() | 0);
 $118 = ($mul13|0)<(0);
 $119 = $118 << 31 >> 31;
 $120 = (___muldi3(($mul13|0),($119|0),($5|0),($33|0))|0);
 $121 = (getTempRet0() | 0);
 $122 = ($mul18|0)<(0);
 $123 = $122 << 31 >> 31;
 $124 = (___muldi3(($mul18|0),($123|0),($mul13|0),($119|0))|0);
 $125 = (getTempRet0() | 0);
 $126 = (___muldi3(($mul19|0),($109|0),($4|0),($29|0))|0);
 $127 = (getTempRet0() | 0);
 $128 = (___muldi3(($mul20|0),($95|0),($mul13|0),($119|0))|0);
 $129 = (getTempRet0() | 0);
 $130 = (___muldi3(($mul21|0),($77|0),($4|0),($29|0))|0);
 $131 = (getTempRet0() | 0);
 $132 = ($mul17|0)<(0);
 $133 = $132 << 31 >> 31;
 $134 = (___muldi3(($mul17|0),($133|0),($5|0),($33|0))|0);
 $135 = (getTempRet0() | 0);
 $136 = (___muldi3(($mul18|0),($123|0),($mul14|0),($65|0))|0);
 $137 = (getTempRet0() | 0);
 $138 = (___muldi3(($mul19|0),($109|0),($mul14|0),($65|0))|0);
 $139 = (getTempRet0() | 0);
 $140 = (___muldi3(($mul20|0),($95|0),($mul14|0),($65|0))|0);
 $141 = (getTempRet0() | 0);
 $142 = (___muldi3(($mul21|0),($77|0),($mul14|0),($65|0))|0);
 $143 = (getTempRet0() | 0);
 $144 = (___muldi3(($mul18|0),($123|0),($6|0),($37|0))|0);
 $145 = (getTempRet0() | 0);
 $146 = (___muldi3(($mul19|0),($109|0),($6|0),($37|0))|0);
 $147 = (getTempRet0() | 0);
 $148 = ($mul15|0)<(0);
 $149 = $148 << 31 >> 31;
 $150 = (___muldi3(($mul20|0),($95|0),($mul15|0),($149|0))|0);
 $151 = (getTempRet0() | 0);
 $152 = (___muldi3(($mul21|0),($77|0),($6|0),($37|0))|0);
 $153 = (getTempRet0() | 0);
 $154 = (___muldi3(($mul19|0),($109|0),($7|0),($41|0))|0);
 $155 = (getTempRet0() | 0);
 $156 = (___muldi3(($mul20|0),($95|0),($mul16|0),($71|0))|0);
 $157 = (getTempRet0() | 0);
 $158 = (___muldi3(($mul21|0),($77|0),($mul16|0),($71|0))|0);
 $159 = (getTempRet0() | 0);
 $160 = (___muldi3(($mul20|0),($95|0),($8|0),($45|0))|0);
 $161 = (getTempRet0() | 0);
 $162 = (___muldi3(($mul21|0),($77|0),($8|0),($45|0))|0);
 $163 = (getTempRet0() | 0);
 $164 = (___muldi3(($mul21|0),($77|0),($9|0),($49|0))|0);
 $165 = (getTempRet0() | 0);
 $166 = (_i64Add(($134|0),($135|0),($12|0),($13|0))|0);
 $167 = (getTempRet0() | 0);
 $168 = (_i64Add(($166|0),($167|0),($124|0),($125|0))|0);
 $169 = (getTempRet0() | 0);
 $170 = (_i64Add(($168|0),($169|0),($110|0),($111|0))|0);
 $171 = (getTempRet0() | 0);
 $172 = (_i64Add(($170|0),($171|0),($96|0),($97|0))|0);
 $173 = (getTempRet0() | 0);
 $174 = (_i64Add(($172|0),($173|0),($78|0),($79|0))|0);
 $175 = (getTempRet0() | 0);
 $176 = (_i64Add(($22|0),($23|0),($54|0),($55|0))|0);
 $177 = (getTempRet0() | 0);
 $178 = (_i64Add(($26|0),($27|0),($56|0),($57|0))|0);
 $179 = (getTempRet0() | 0);
 $180 = (_i64Add(($60|0),($61|0),($80|0),($81|0))|0);
 $181 = (getTempRet0() | 0);
 $182 = (_i64Add(($180|0),($181|0),($30|0),($31|0))|0);
 $183 = (getTempRet0() | 0);
 $184 = (_i64Add(($182|0),($183|0),($154|0),($155|0))|0);
 $185 = (getTempRet0() | 0);
 $186 = (_i64Add(($184|0),($185|0),($150|0),($151|0))|0);
 $187 = (getTempRet0() | 0);
 $188 = (_i64Add(($186|0),($187|0),($142|0),($143|0))|0);
 $189 = (getTempRet0() | 0);
 $190 = (_i64Add(($174|0),($175|0),33554432,0)|0);
 $191 = (getTempRet0() | 0);
 $192 = (_bitshift64Ashr(($190|0),($191|0),26)|0);
 $193 = (getTempRet0() | 0);
 $194 = (_i64Add(($136|0),($137|0),($18|0),($19|0))|0);
 $195 = (getTempRet0() | 0);
 $196 = (_i64Add(($194|0),($195|0),($126|0),($127|0))|0);
 $197 = (getTempRet0() | 0);
 $198 = (_i64Add(($196|0),($197|0),($112|0),($113|0))|0);
 $199 = (getTempRet0() | 0);
 $200 = (_i64Add(($198|0),($199|0),($98|0),($99|0))|0);
 $201 = (getTempRet0() | 0);
 $202 = (_i64Add(($200|0),($201|0),($192|0),($193|0))|0);
 $203 = (getTempRet0() | 0);
 $204 = $190 & -67108864;
 $205 = (_i64Subtract(($174|0),($175|0),($204|0),($191|0))|0);
 $206 = (getTempRet0() | 0);
 $207 = (_i64Add(($188|0),($189|0),33554432,0)|0);
 $208 = (getTempRet0() | 0);
 $209 = (_bitshift64Ashr(($207|0),($208|0),26)|0);
 $210 = (getTempRet0() | 0);
 $211 = (_i64Add(($62|0),($63|0),($84|0),($85|0))|0);
 $212 = (getTempRet0() | 0);
 $213 = (_i64Add(($211|0),($212|0),($34|0),($35|0))|0);
 $214 = (getTempRet0() | 0);
 $215 = (_i64Add(($213|0),($214|0),($156|0),($157|0))|0);
 $216 = (getTempRet0() | 0);
 $217 = (_i64Add(($215|0),($216|0),($152|0),($153|0))|0);
 $218 = (getTempRet0() | 0);
 $219 = (_i64Add(($217|0),($218|0),($209|0),($210|0))|0);
 $220 = (getTempRet0() | 0);
 $221 = $207 & -67108864;
 $222 = (_i64Subtract(($188|0),($189|0),($221|0),($208|0))|0);
 $223 = (getTempRet0() | 0);
 $224 = (_i64Add(($202|0),($203|0),16777216,0)|0);
 $225 = (getTempRet0() | 0);
 $226 = (_bitshift64Ashr(($224|0),($225|0),25)|0);
 $227 = (getTempRet0() | 0);
 $228 = (_i64Add(($176|0),($177|0),($144|0),($145|0))|0);
 $229 = (getTempRet0() | 0);
 $230 = (_i64Add(($228|0),($229|0),($138|0),($139|0))|0);
 $231 = (getTempRet0() | 0);
 $232 = (_i64Add(($230|0),($231|0),($128|0),($129|0))|0);
 $233 = (getTempRet0() | 0);
 $234 = (_i64Add(($232|0),($233|0),($114|0),($115|0))|0);
 $235 = (getTempRet0() | 0);
 $236 = (_i64Add(($234|0),($235|0),($226|0),($227|0))|0);
 $237 = (getTempRet0() | 0);
 $238 = $224 & -33554432;
 $239 = (_i64Subtract(($202|0),($203|0),($238|0),0)|0);
 $240 = (getTempRet0() | 0);
 $241 = (_i64Add(($219|0),($220|0),16777216,0)|0);
 $242 = (getTempRet0() | 0);
 $243 = (_bitshift64Ashr(($241|0),($242|0),25)|0);
 $244 = (getTempRet0() | 0);
 $245 = (_i64Add(($100|0),($101|0),($86|0),($87|0))|0);
 $246 = (getTempRet0() | 0);
 $247 = (_i64Add(($245|0),($246|0),($66|0),($67|0))|0);
 $248 = (getTempRet0() | 0);
 $249 = (_i64Add(($247|0),($248|0),($38|0),($39|0))|0);
 $250 = (getTempRet0() | 0);
 $251 = (_i64Add(($249|0),($250|0),($160|0),($161|0))|0);
 $252 = (getTempRet0() | 0);
 $253 = (_i64Add(($251|0),($252|0),($158|0),($159|0))|0);
 $254 = (getTempRet0() | 0);
 $255 = (_i64Add(($253|0),($254|0),($243|0),($244|0))|0);
 $256 = (getTempRet0() | 0);
 $257 = $241 & -33554432;
 $258 = (_i64Subtract(($219|0),($220|0),($257|0),0)|0);
 $259 = (getTempRet0() | 0);
 $260 = (_i64Add(($236|0),($237|0),33554432,0)|0);
 $261 = (getTempRet0() | 0);
 $262 = (_bitshift64Ashr(($260|0),($261|0),26)|0);
 $263 = (getTempRet0() | 0);
 $264 = (_i64Add(($178|0),($179|0),($146|0),($147|0))|0);
 $265 = (getTempRet0() | 0);
 $266 = (_i64Add(($264|0),($265|0),($140|0),($141|0))|0);
 $267 = (getTempRet0() | 0);
 $268 = (_i64Add(($266|0),($267|0),($130|0),($131|0))|0);
 $269 = (getTempRet0() | 0);
 $270 = (_i64Add(($268|0),($269|0),($262|0),($263|0))|0);
 $271 = (getTempRet0() | 0);
 $272 = $260 & -67108864;
 $273 = (_i64Subtract(($236|0),($237|0),($272|0),0)|0);
 $274 = (getTempRet0() | 0);
 $275 = (_i64Add(($255|0),($256|0),33554432,0)|0);
 $276 = (getTempRet0() | 0);
 $277 = (_bitshift64Ashr(($275|0),($276|0),26)|0);
 $278 = (getTempRet0() | 0);
 $279 = (_i64Add(($88|0),($89|0),($102|0),($103|0))|0);
 $280 = (getTempRet0() | 0);
 $281 = (_i64Add(($279|0),($280|0),($68|0),($69|0))|0);
 $282 = (getTempRet0() | 0);
 $283 = (_i64Add(($281|0),($282|0),($42|0),($43|0))|0);
 $284 = (getTempRet0() | 0);
 $285 = (_i64Add(($283|0),($284|0),($162|0),($163|0))|0);
 $286 = (getTempRet0() | 0);
 $287 = (_i64Add(($285|0),($286|0),($277|0),($278|0))|0);
 $288 = (getTempRet0() | 0);
 $289 = $275 & -67108864;
 $290 = (_i64Subtract(($255|0),($256|0),($289|0),0)|0);
 $291 = (getTempRet0() | 0);
 $292 = (_i64Add(($270|0),($271|0),16777216,0)|0);
 $293 = (getTempRet0() | 0);
 $294 = (_bitshift64Ashr(($292|0),($293|0),25)|0);
 $295 = (getTempRet0() | 0);
 $296 = (_i64Add(($294|0),($295|0),($222|0),($223|0))|0);
 $297 = (getTempRet0() | 0);
 $298 = $292 & -33554432;
 $299 = (_i64Subtract(($270|0),($271|0),($298|0),0)|0);
 $300 = (getTempRet0() | 0);
 $301 = (_i64Add(($287|0),($288|0),16777216,0)|0);
 $302 = (getTempRet0() | 0);
 $303 = (_bitshift64Ashr(($301|0),($302|0),25)|0);
 $304 = (getTempRet0() | 0);
 $305 = (_i64Add(($90|0),($91|0),($116|0),($117|0))|0);
 $306 = (getTempRet0() | 0);
 $307 = (_i64Add(($305|0),($306|0),($104|0),($105|0))|0);
 $308 = (getTempRet0() | 0);
 $309 = (_i64Add(($307|0),($308|0),($72|0),($73|0))|0);
 $310 = (getTempRet0() | 0);
 $311 = (_i64Add(($309|0),($310|0),($46|0),($47|0))|0);
 $312 = (getTempRet0() | 0);
 $313 = (_i64Add(($311|0),($312|0),($164|0),($165|0))|0);
 $314 = (getTempRet0() | 0);
 $315 = (_i64Add(($313|0),($314|0),($303|0),($304|0))|0);
 $316 = (getTempRet0() | 0);
 $317 = $301 & -33554432;
 $318 = (_i64Subtract(($287|0),($288|0),($317|0),0)|0);
 $319 = (getTempRet0() | 0);
 $320 = (_i64Add(($296|0),($297|0),33554432,0)|0);
 $321 = (getTempRet0() | 0);
 $322 = (_bitshift64Lshr(($320|0),($321|0),26)|0);
 $323 = (getTempRet0() | 0);
 $324 = (_i64Add(($258|0),($259|0),($322|0),($323|0))|0);
 $325 = (getTempRet0() | 0);
 $326 = $320 & -67108864;
 $327 = (_i64Subtract(($296|0),($297|0),($326|0),0)|0);
 $328 = (getTempRet0() | 0);
 $329 = (_i64Add(($315|0),($316|0),33554432,0)|0);
 $330 = (getTempRet0() | 0);
 $331 = (_bitshift64Ashr(($329|0),($330|0),26)|0);
 $332 = (getTempRet0() | 0);
 $333 = (_i64Add(($106|0),($107|0),($120|0),($121|0))|0);
 $334 = (getTempRet0() | 0);
 $335 = (_i64Add(($333|0),($334|0),($92|0),($93|0))|0);
 $336 = (getTempRet0() | 0);
 $337 = (_i64Add(($335|0),($336|0),($74|0),($75|0))|0);
 $338 = (getTempRet0() | 0);
 $339 = (_i64Add(($337|0),($338|0),($50|0),($51|0))|0);
 $340 = (getTempRet0() | 0);
 $341 = (_i64Add(($339|0),($340|0),($331|0),($332|0))|0);
 $342 = (getTempRet0() | 0);
 $343 = $329 & -67108864;
 $344 = (_i64Subtract(($315|0),($316|0),($343|0),0)|0);
 $345 = (getTempRet0() | 0);
 $346 = (_i64Add(($341|0),($342|0),16777216,0)|0);
 $347 = (getTempRet0() | 0);
 $348 = (_bitshift64Ashr(($346|0),($347|0),25)|0);
 $349 = (getTempRet0() | 0);
 $350 = (___muldi3(($348|0),($349|0),19,0)|0);
 $351 = (getTempRet0() | 0);
 $352 = (_i64Add(($350|0),($351|0),($205|0),($206|0))|0);
 $353 = (getTempRet0() | 0);
 $354 = $346 & -33554432;
 $355 = (_i64Subtract(($341|0),($342|0),($354|0),0)|0);
 $356 = (getTempRet0() | 0);
 $357 = (_i64Add(($352|0),($353|0),33554432,0)|0);
 $358 = (getTempRet0() | 0);
 $359 = (_bitshift64Lshr(($357|0),($358|0),26)|0);
 $360 = (getTempRet0() | 0);
 $361 = (_i64Add(($239|0),($240|0),($359|0),($360|0))|0);
 $362 = (getTempRet0() | 0);
 $363 = $357 & -67108864;
 $364 = (_i64Subtract(($352|0),($353|0),($363|0),0)|0);
 $365 = (getTempRet0() | 0);
 HEAP32[$h>>2] = $364;
 $arrayidx291 = ((($h)) + 4|0);
 HEAP32[$arrayidx291>>2] = $361;
 $arrayidx293 = ((($h)) + 8|0);
 HEAP32[$arrayidx293>>2] = $273;
 $arrayidx295 = ((($h)) + 12|0);
 HEAP32[$arrayidx295>>2] = $299;
 $arrayidx297 = ((($h)) + 16|0);
 HEAP32[$arrayidx297>>2] = $327;
 $arrayidx299 = ((($h)) + 20|0);
 HEAP32[$arrayidx299>>2] = $324;
 $arrayidx301 = ((($h)) + 24|0);
 HEAP32[$arrayidx301>>2] = $290;
 $arrayidx303 = ((($h)) + 28|0);
 HEAP32[$arrayidx303>>2] = $318;
 $arrayidx305 = ((($h)) + 32|0);
 HEAP32[$arrayidx305>>2] = $344;
 $arrayidx307 = ((($h)) + 36|0);
 HEAP32[$arrayidx307>>2] = $355;
 return;
}
function _fe_mul($h,$f,$g) {
 $h = $h|0;
 $f = $f|0;
 $g = $g|0;
 var $0 = 0, $1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0;
 var $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0;
 var $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0;
 var $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0;
 var $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0;
 var $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0;
 var $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0;
 var $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0;
 var $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0;
 var $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $278 = 0;
 var $279 = 0, $28 = 0, $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $285 = 0, $286 = 0, $287 = 0, $288 = 0, $289 = 0, $29 = 0, $290 = 0, $291 = 0, $292 = 0, $293 = 0, $294 = 0, $295 = 0, $296 = 0;
 var $297 = 0, $298 = 0, $299 = 0, $3 = 0, $30 = 0, $300 = 0, $301 = 0, $302 = 0, $303 = 0, $304 = 0, $305 = 0, $306 = 0, $307 = 0, $308 = 0, $309 = 0, $31 = 0, $310 = 0, $311 = 0, $312 = 0, $313 = 0;
 var $314 = 0, $315 = 0, $316 = 0, $317 = 0, $318 = 0, $319 = 0, $32 = 0, $320 = 0, $321 = 0, $322 = 0, $323 = 0, $324 = 0, $325 = 0, $326 = 0, $327 = 0, $328 = 0, $329 = 0, $33 = 0, $330 = 0, $331 = 0;
 var $332 = 0, $333 = 0, $334 = 0, $335 = 0, $336 = 0, $337 = 0, $338 = 0, $339 = 0, $34 = 0, $340 = 0, $341 = 0, $342 = 0, $343 = 0, $344 = 0, $345 = 0, $346 = 0, $347 = 0, $348 = 0, $349 = 0, $35 = 0;
 var $350 = 0, $351 = 0, $352 = 0, $353 = 0, $354 = 0, $355 = 0, $356 = 0, $357 = 0, $358 = 0, $359 = 0, $36 = 0, $360 = 0, $361 = 0, $362 = 0, $363 = 0, $364 = 0, $365 = 0, $366 = 0, $367 = 0, $368 = 0;
 var $369 = 0, $37 = 0, $370 = 0, $371 = 0, $372 = 0, $373 = 0, $374 = 0, $375 = 0, $376 = 0, $377 = 0, $378 = 0, $379 = 0, $38 = 0, $380 = 0, $381 = 0, $382 = 0, $383 = 0, $384 = 0, $385 = 0, $386 = 0;
 var $387 = 0, $388 = 0, $389 = 0, $39 = 0, $390 = 0, $391 = 0, $392 = 0, $393 = 0, $394 = 0, $395 = 0, $396 = 0, $397 = 0, $398 = 0, $399 = 0, $4 = 0, $40 = 0, $400 = 0, $401 = 0, $402 = 0, $403 = 0;
 var $404 = 0, $405 = 0, $406 = 0, $407 = 0, $408 = 0, $409 = 0, $41 = 0, $410 = 0, $411 = 0, $412 = 0, $413 = 0, $414 = 0, $415 = 0, $416 = 0, $417 = 0, $418 = 0, $419 = 0, $42 = 0, $420 = 0, $421 = 0;
 var $422 = 0, $423 = 0, $424 = 0, $425 = 0, $426 = 0, $427 = 0, $428 = 0, $429 = 0, $43 = 0, $430 = 0, $431 = 0, $432 = 0, $433 = 0, $434 = 0, $435 = 0, $436 = 0, $437 = 0, $438 = 0, $439 = 0, $44 = 0;
 var $440 = 0, $441 = 0, $442 = 0, $443 = 0, $444 = 0, $445 = 0, $446 = 0, $447 = 0, $448 = 0, $449 = 0, $45 = 0, $450 = 0, $451 = 0, $452 = 0, $453 = 0, $454 = 0, $455 = 0, $456 = 0, $457 = 0, $458 = 0;
 var $459 = 0, $46 = 0, $460 = 0, $461 = 0, $462 = 0, $463 = 0, $464 = 0, $465 = 0, $466 = 0, $467 = 0, $468 = 0, $469 = 0, $47 = 0, $470 = 0, $471 = 0, $472 = 0, $473 = 0, $474 = 0, $475 = 0, $476 = 0;
 var $477 = 0, $478 = 0, $479 = 0, $48 = 0, $480 = 0, $481 = 0, $482 = 0, $483 = 0, $484 = 0, $485 = 0, $486 = 0, $487 = 0, $488 = 0, $489 = 0, $49 = 0, $490 = 0, $491 = 0, $492 = 0, $493 = 0, $494 = 0;
 var $495 = 0, $496 = 0, $497 = 0, $498 = 0, $499 = 0, $5 = 0, $50 = 0, $500 = 0, $501 = 0, $502 = 0, $503 = 0, $504 = 0, $505 = 0, $506 = 0, $507 = 0, $508 = 0, $509 = 0, $51 = 0, $510 = 0, $511 = 0;
 var $512 = 0, $513 = 0, $514 = 0, $515 = 0, $516 = 0, $517 = 0, $518 = 0, $519 = 0, $52 = 0, $520 = 0, $521 = 0, $522 = 0, $523 = 0, $524 = 0, $525 = 0, $526 = 0, $527 = 0, $528 = 0, $529 = 0, $53 = 0;
 var $530 = 0, $531 = 0, $532 = 0, $533 = 0, $534 = 0, $535 = 0, $536 = 0, $537 = 0, $538 = 0, $539 = 0, $54 = 0, $540 = 0, $541 = 0, $542 = 0, $543 = 0, $544 = 0, $545 = 0, $546 = 0, $547 = 0, $548 = 0;
 var $549 = 0, $55 = 0, $550 = 0, $551 = 0, $552 = 0, $553 = 0, $554 = 0, $555 = 0, $556 = 0, $557 = 0, $558 = 0, $559 = 0, $56 = 0, $560 = 0, $561 = 0, $562 = 0, $563 = 0, $564 = 0, $565 = 0, $566 = 0;
 var $567 = 0, $568 = 0, $569 = 0, $57 = 0, $570 = 0, $571 = 0, $572 = 0, $573 = 0, $574 = 0, $575 = 0, $576 = 0, $577 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0;
 var $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0;
 var $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, $arrayidx1 = 0, $arrayidx11 = 0;
 var $arrayidx12 = 0, $arrayidx13 = 0, $arrayidx14 = 0, $arrayidx15 = 0, $arrayidx16 = 0, $arrayidx17 = 0, $arrayidx18 = 0, $arrayidx19 = 0, $arrayidx2 = 0, $arrayidx3 = 0, $arrayidx4 = 0, $arrayidx482 = 0, $arrayidx484 = 0, $arrayidx486 = 0, $arrayidx488 = 0, $arrayidx490 = 0, $arrayidx492 = 0, $arrayidx494 = 0, $arrayidx496 = 0, $arrayidx498 = 0;
 var $arrayidx5 = 0, $arrayidx6 = 0, $arrayidx7 = 0, $arrayidx8 = 0, $arrayidx9 = 0, $mul = 0, $mul20 = 0, $mul21 = 0, $mul22 = 0, $mul23 = 0, $mul24 = 0, $mul25 = 0, $mul26 = 0, $mul27 = 0, $mul28 = 0, $mul29 = 0, $mul30 = 0, $mul31 = 0, $mul32 = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[$f>>2]|0;
 $arrayidx1 = ((($f)) + 4|0);
 $1 = HEAP32[$arrayidx1>>2]|0;
 $arrayidx2 = ((($f)) + 8|0);
 $2 = HEAP32[$arrayidx2>>2]|0;
 $arrayidx3 = ((($f)) + 12|0);
 $3 = HEAP32[$arrayidx3>>2]|0;
 $arrayidx4 = ((($f)) + 16|0);
 $4 = HEAP32[$arrayidx4>>2]|0;
 $arrayidx5 = ((($f)) + 20|0);
 $5 = HEAP32[$arrayidx5>>2]|0;
 $arrayidx6 = ((($f)) + 24|0);
 $6 = HEAP32[$arrayidx6>>2]|0;
 $arrayidx7 = ((($f)) + 28|0);
 $7 = HEAP32[$arrayidx7>>2]|0;
 $arrayidx8 = ((($f)) + 32|0);
 $8 = HEAP32[$arrayidx8>>2]|0;
 $arrayidx9 = ((($f)) + 36|0);
 $9 = HEAP32[$arrayidx9>>2]|0;
 $10 = HEAP32[$g>>2]|0;
 $arrayidx11 = ((($g)) + 4|0);
 $11 = HEAP32[$arrayidx11>>2]|0;
 $arrayidx12 = ((($g)) + 8|0);
 $12 = HEAP32[$arrayidx12>>2]|0;
 $arrayidx13 = ((($g)) + 12|0);
 $13 = HEAP32[$arrayidx13>>2]|0;
 $arrayidx14 = ((($g)) + 16|0);
 $14 = HEAP32[$arrayidx14>>2]|0;
 $arrayidx15 = ((($g)) + 20|0);
 $15 = HEAP32[$arrayidx15>>2]|0;
 $arrayidx16 = ((($g)) + 24|0);
 $16 = HEAP32[$arrayidx16>>2]|0;
 $arrayidx17 = ((($g)) + 28|0);
 $17 = HEAP32[$arrayidx17>>2]|0;
 $arrayidx18 = ((($g)) + 32|0);
 $18 = HEAP32[$arrayidx18>>2]|0;
 $arrayidx19 = ((($g)) + 36|0);
 $19 = HEAP32[$arrayidx19>>2]|0;
 $mul = ($11*19)|0;
 $mul20 = ($12*19)|0;
 $mul21 = ($13*19)|0;
 $mul22 = ($14*19)|0;
 $mul23 = ($15*19)|0;
 $mul24 = ($16*19)|0;
 $mul25 = ($17*19)|0;
 $mul26 = ($18*19)|0;
 $mul27 = ($19*19)|0;
 $mul28 = $1 << 1;
 $mul29 = $3 << 1;
 $mul30 = $5 << 1;
 $mul31 = $7 << 1;
 $mul32 = $9 << 1;
 $20 = ($0|0)<(0);
 $21 = $20 << 31 >> 31;
 $22 = ($10|0)<(0);
 $23 = $22 << 31 >> 31;
 $24 = (___muldi3(($10|0),($23|0),($0|0),($21|0))|0);
 $25 = (getTempRet0() | 0);
 $26 = ($11|0)<(0);
 $27 = $26 << 31 >> 31;
 $28 = (___muldi3(($11|0),($27|0),($0|0),($21|0))|0);
 $29 = (getTempRet0() | 0);
 $30 = ($12|0)<(0);
 $31 = $30 << 31 >> 31;
 $32 = (___muldi3(($12|0),($31|0),($0|0),($21|0))|0);
 $33 = (getTempRet0() | 0);
 $34 = ($13|0)<(0);
 $35 = $34 << 31 >> 31;
 $36 = (___muldi3(($13|0),($35|0),($0|0),($21|0))|0);
 $37 = (getTempRet0() | 0);
 $38 = ($14|0)<(0);
 $39 = $38 << 31 >> 31;
 $40 = (___muldi3(($14|0),($39|0),($0|0),($21|0))|0);
 $41 = (getTempRet0() | 0);
 $42 = ($15|0)<(0);
 $43 = $42 << 31 >> 31;
 $44 = (___muldi3(($15|0),($43|0),($0|0),($21|0))|0);
 $45 = (getTempRet0() | 0);
 $46 = ($16|0)<(0);
 $47 = $46 << 31 >> 31;
 $48 = (___muldi3(($16|0),($47|0),($0|0),($21|0))|0);
 $49 = (getTempRet0() | 0);
 $50 = ($17|0)<(0);
 $51 = $50 << 31 >> 31;
 $52 = (___muldi3(($17|0),($51|0),($0|0),($21|0))|0);
 $53 = (getTempRet0() | 0);
 $54 = ($18|0)<(0);
 $55 = $54 << 31 >> 31;
 $56 = (___muldi3(($18|0),($55|0),($0|0),($21|0))|0);
 $57 = (getTempRet0() | 0);
 $58 = ($19|0)<(0);
 $59 = $58 << 31 >> 31;
 $60 = (___muldi3(($19|0),($59|0),($0|0),($21|0))|0);
 $61 = (getTempRet0() | 0);
 $62 = ($1|0)<(0);
 $63 = $62 << 31 >> 31;
 $64 = (___muldi3(($10|0),($23|0),($1|0),($63|0))|0);
 $65 = (getTempRet0() | 0);
 $66 = ($mul28|0)<(0);
 $67 = $66 << 31 >> 31;
 $68 = (___muldi3(($11|0),($27|0),($mul28|0),($67|0))|0);
 $69 = (getTempRet0() | 0);
 $70 = (___muldi3(($12|0),($31|0),($1|0),($63|0))|0);
 $71 = (getTempRet0() | 0);
 $72 = (___muldi3(($13|0),($35|0),($mul28|0),($67|0))|0);
 $73 = (getTempRet0() | 0);
 $74 = (___muldi3(($14|0),($39|0),($1|0),($63|0))|0);
 $75 = (getTempRet0() | 0);
 $76 = (___muldi3(($15|0),($43|0),($mul28|0),($67|0))|0);
 $77 = (getTempRet0() | 0);
 $78 = (___muldi3(($16|0),($47|0),($1|0),($63|0))|0);
 $79 = (getTempRet0() | 0);
 $80 = (___muldi3(($17|0),($51|0),($mul28|0),($67|0))|0);
 $81 = (getTempRet0() | 0);
 $82 = (___muldi3(($18|0),($55|0),($1|0),($63|0))|0);
 $83 = (getTempRet0() | 0);
 $84 = ($mul27|0)<(0);
 $85 = $84 << 31 >> 31;
 $86 = (___muldi3(($mul27|0),($85|0),($mul28|0),($67|0))|0);
 $87 = (getTempRet0() | 0);
 $88 = ($2|0)<(0);
 $89 = $88 << 31 >> 31;
 $90 = (___muldi3(($10|0),($23|0),($2|0),($89|0))|0);
 $91 = (getTempRet0() | 0);
 $92 = (___muldi3(($11|0),($27|0),($2|0),($89|0))|0);
 $93 = (getTempRet0() | 0);
 $94 = (___muldi3(($12|0),($31|0),($2|0),($89|0))|0);
 $95 = (getTempRet0() | 0);
 $96 = (___muldi3(($13|0),($35|0),($2|0),($89|0))|0);
 $97 = (getTempRet0() | 0);
 $98 = (___muldi3(($14|0),($39|0),($2|0),($89|0))|0);
 $99 = (getTempRet0() | 0);
 $100 = (___muldi3(($15|0),($43|0),($2|0),($89|0))|0);
 $101 = (getTempRet0() | 0);
 $102 = (___muldi3(($16|0),($47|0),($2|0),($89|0))|0);
 $103 = (getTempRet0() | 0);
 $104 = (___muldi3(($17|0),($51|0),($2|0),($89|0))|0);
 $105 = (getTempRet0() | 0);
 $106 = ($mul26|0)<(0);
 $107 = $106 << 31 >> 31;
 $108 = (___muldi3(($mul26|0),($107|0),($2|0),($89|0))|0);
 $109 = (getTempRet0() | 0);
 $110 = (___muldi3(($mul27|0),($85|0),($2|0),($89|0))|0);
 $111 = (getTempRet0() | 0);
 $112 = ($3|0)<(0);
 $113 = $112 << 31 >> 31;
 $114 = (___muldi3(($10|0),($23|0),($3|0),($113|0))|0);
 $115 = (getTempRet0() | 0);
 $116 = ($mul29|0)<(0);
 $117 = $116 << 31 >> 31;
 $118 = (___muldi3(($11|0),($27|0),($mul29|0),($117|0))|0);
 $119 = (getTempRet0() | 0);
 $120 = (___muldi3(($12|0),($31|0),($3|0),($113|0))|0);
 $121 = (getTempRet0() | 0);
 $122 = (___muldi3(($13|0),($35|0),($mul29|0),($117|0))|0);
 $123 = (getTempRet0() | 0);
 $124 = (___muldi3(($14|0),($39|0),($3|0),($113|0))|0);
 $125 = (getTempRet0() | 0);
 $126 = (___muldi3(($15|0),($43|0),($mul29|0),($117|0))|0);
 $127 = (getTempRet0() | 0);
 $128 = (___muldi3(($16|0),($47|0),($3|0),($113|0))|0);
 $129 = (getTempRet0() | 0);
 $130 = ($mul25|0)<(0);
 $131 = $130 << 31 >> 31;
 $132 = (___muldi3(($mul25|0),($131|0),($mul29|0),($117|0))|0);
 $133 = (getTempRet0() | 0);
 $134 = (___muldi3(($mul26|0),($107|0),($3|0),($113|0))|0);
 $135 = (getTempRet0() | 0);
 $136 = (___muldi3(($mul27|0),($85|0),($mul29|0),($117|0))|0);
 $137 = (getTempRet0() | 0);
 $138 = ($4|0)<(0);
 $139 = $138 << 31 >> 31;
 $140 = (___muldi3(($10|0),($23|0),($4|0),($139|0))|0);
 $141 = (getTempRet0() | 0);
 $142 = (___muldi3(($11|0),($27|0),($4|0),($139|0))|0);
 $143 = (getTempRet0() | 0);
 $144 = (___muldi3(($12|0),($31|0),($4|0),($139|0))|0);
 $145 = (getTempRet0() | 0);
 $146 = (___muldi3(($13|0),($35|0),($4|0),($139|0))|0);
 $147 = (getTempRet0() | 0);
 $148 = (___muldi3(($14|0),($39|0),($4|0),($139|0))|0);
 $149 = (getTempRet0() | 0);
 $150 = (___muldi3(($15|0),($43|0),($4|0),($139|0))|0);
 $151 = (getTempRet0() | 0);
 $152 = ($mul24|0)<(0);
 $153 = $152 << 31 >> 31;
 $154 = (___muldi3(($mul24|0),($153|0),($4|0),($139|0))|0);
 $155 = (getTempRet0() | 0);
 $156 = (___muldi3(($mul25|0),($131|0),($4|0),($139|0))|0);
 $157 = (getTempRet0() | 0);
 $158 = (___muldi3(($mul26|0),($107|0),($4|0),($139|0))|0);
 $159 = (getTempRet0() | 0);
 $160 = (___muldi3(($mul27|0),($85|0),($4|0),($139|0))|0);
 $161 = (getTempRet0() | 0);
 $162 = ($5|0)<(0);
 $163 = $162 << 31 >> 31;
 $164 = (___muldi3(($10|0),($23|0),($5|0),($163|0))|0);
 $165 = (getTempRet0() | 0);
 $166 = ($mul30|0)<(0);
 $167 = $166 << 31 >> 31;
 $168 = (___muldi3(($11|0),($27|0),($mul30|0),($167|0))|0);
 $169 = (getTempRet0() | 0);
 $170 = (___muldi3(($12|0),($31|0),($5|0),($163|0))|0);
 $171 = (getTempRet0() | 0);
 $172 = (___muldi3(($13|0),($35|0),($mul30|0),($167|0))|0);
 $173 = (getTempRet0() | 0);
 $174 = (___muldi3(($14|0),($39|0),($5|0),($163|0))|0);
 $175 = (getTempRet0() | 0);
 $176 = ($mul23|0)<(0);
 $177 = $176 << 31 >> 31;
 $178 = (___muldi3(($mul23|0),($177|0),($mul30|0),($167|0))|0);
 $179 = (getTempRet0() | 0);
 $180 = (___muldi3(($mul24|0),($153|0),($5|0),($163|0))|0);
 $181 = (getTempRet0() | 0);
 $182 = (___muldi3(($mul25|0),($131|0),($mul30|0),($167|0))|0);
 $183 = (getTempRet0() | 0);
 $184 = (___muldi3(($mul26|0),($107|0),($5|0),($163|0))|0);
 $185 = (getTempRet0() | 0);
 $186 = (___muldi3(($mul27|0),($85|0),($mul30|0),($167|0))|0);
 $187 = (getTempRet0() | 0);
 $188 = ($6|0)<(0);
 $189 = $188 << 31 >> 31;
 $190 = (___muldi3(($10|0),($23|0),($6|0),($189|0))|0);
 $191 = (getTempRet0() | 0);
 $192 = (___muldi3(($11|0),($27|0),($6|0),($189|0))|0);
 $193 = (getTempRet0() | 0);
 $194 = (___muldi3(($12|0),($31|0),($6|0),($189|0))|0);
 $195 = (getTempRet0() | 0);
 $196 = (___muldi3(($13|0),($35|0),($6|0),($189|0))|0);
 $197 = (getTempRet0() | 0);
 $198 = ($mul22|0)<(0);
 $199 = $198 << 31 >> 31;
 $200 = (___muldi3(($mul22|0),($199|0),($6|0),($189|0))|0);
 $201 = (getTempRet0() | 0);
 $202 = (___muldi3(($mul23|0),($177|0),($6|0),($189|0))|0);
 $203 = (getTempRet0() | 0);
 $204 = (___muldi3(($mul24|0),($153|0),($6|0),($189|0))|0);
 $205 = (getTempRet0() | 0);
 $206 = (___muldi3(($mul25|0),($131|0),($6|0),($189|0))|0);
 $207 = (getTempRet0() | 0);
 $208 = (___muldi3(($mul26|0),($107|0),($6|0),($189|0))|0);
 $209 = (getTempRet0() | 0);
 $210 = (___muldi3(($mul27|0),($85|0),($6|0),($189|0))|0);
 $211 = (getTempRet0() | 0);
 $212 = ($7|0)<(0);
 $213 = $212 << 31 >> 31;
 $214 = (___muldi3(($10|0),($23|0),($7|0),($213|0))|0);
 $215 = (getTempRet0() | 0);
 $216 = ($mul31|0)<(0);
 $217 = $216 << 31 >> 31;
 $218 = (___muldi3(($11|0),($27|0),($mul31|0),($217|0))|0);
 $219 = (getTempRet0() | 0);
 $220 = (___muldi3(($12|0),($31|0),($7|0),($213|0))|0);
 $221 = (getTempRet0() | 0);
 $222 = ($mul21|0)<(0);
 $223 = $222 << 31 >> 31;
 $224 = (___muldi3(($mul21|0),($223|0),($mul31|0),($217|0))|0);
 $225 = (getTempRet0() | 0);
 $226 = (___muldi3(($mul22|0),($199|0),($7|0),($213|0))|0);
 $227 = (getTempRet0() | 0);
 $228 = (___muldi3(($mul23|0),($177|0),($mul31|0),($217|0))|0);
 $229 = (getTempRet0() | 0);
 $230 = (___muldi3(($mul24|0),($153|0),($7|0),($213|0))|0);
 $231 = (getTempRet0() | 0);
 $232 = (___muldi3(($mul25|0),($131|0),($mul31|0),($217|0))|0);
 $233 = (getTempRet0() | 0);
 $234 = (___muldi3(($mul26|0),($107|0),($7|0),($213|0))|0);
 $235 = (getTempRet0() | 0);
 $236 = (___muldi3(($mul27|0),($85|0),($mul31|0),($217|0))|0);
 $237 = (getTempRet0() | 0);
 $238 = ($8|0)<(0);
 $239 = $238 << 31 >> 31;
 $240 = (___muldi3(($10|0),($23|0),($8|0),($239|0))|0);
 $241 = (getTempRet0() | 0);
 $242 = (___muldi3(($11|0),($27|0),($8|0),($239|0))|0);
 $243 = (getTempRet0() | 0);
 $244 = ($mul20|0)<(0);
 $245 = $244 << 31 >> 31;
 $246 = (___muldi3(($mul20|0),($245|0),($8|0),($239|0))|0);
 $247 = (getTempRet0() | 0);
 $248 = (___muldi3(($mul21|0),($223|0),($8|0),($239|0))|0);
 $249 = (getTempRet0() | 0);
 $250 = (___muldi3(($mul22|0),($199|0),($8|0),($239|0))|0);
 $251 = (getTempRet0() | 0);
 $252 = (___muldi3(($mul23|0),($177|0),($8|0),($239|0))|0);
 $253 = (getTempRet0() | 0);
 $254 = (___muldi3(($mul24|0),($153|0),($8|0),($239|0))|0);
 $255 = (getTempRet0() | 0);
 $256 = (___muldi3(($mul25|0),($131|0),($8|0),($239|0))|0);
 $257 = (getTempRet0() | 0);
 $258 = (___muldi3(($mul26|0),($107|0),($8|0),($239|0))|0);
 $259 = (getTempRet0() | 0);
 $260 = (___muldi3(($mul27|0),($85|0),($8|0),($239|0))|0);
 $261 = (getTempRet0() | 0);
 $262 = ($9|0)<(0);
 $263 = $262 << 31 >> 31;
 $264 = (___muldi3(($10|0),($23|0),($9|0),($263|0))|0);
 $265 = (getTempRet0() | 0);
 $266 = ($mul32|0)<(0);
 $267 = $266 << 31 >> 31;
 $268 = ($mul|0)<(0);
 $269 = $268 << 31 >> 31;
 $270 = (___muldi3(($mul|0),($269|0),($mul32|0),($267|0))|0);
 $271 = (getTempRet0() | 0);
 $272 = (___muldi3(($mul20|0),($245|0),($9|0),($263|0))|0);
 $273 = (getTempRet0() | 0);
 $274 = (___muldi3(($mul21|0),($223|0),($mul32|0),($267|0))|0);
 $275 = (getTempRet0() | 0);
 $276 = (___muldi3(($mul22|0),($199|0),($9|0),($263|0))|0);
 $277 = (getTempRet0() | 0);
 $278 = (___muldi3(($mul23|0),($177|0),($mul32|0),($267|0))|0);
 $279 = (getTempRet0() | 0);
 $280 = (___muldi3(($mul24|0),($153|0),($9|0),($263|0))|0);
 $281 = (getTempRet0() | 0);
 $282 = (___muldi3(($mul25|0),($131|0),($mul32|0),($267|0))|0);
 $283 = (getTempRet0() | 0);
 $284 = (___muldi3(($mul26|0),($107|0),($9|0),($263|0))|0);
 $285 = (getTempRet0() | 0);
 $286 = (___muldi3(($mul27|0),($85|0),($mul32|0),($267|0))|0);
 $287 = (getTempRet0() | 0);
 $288 = (_i64Add(($270|0),($271|0),($24|0),($25|0))|0);
 $289 = (getTempRet0() | 0);
 $290 = (_i64Add(($288|0),($289|0),($246|0),($247|0))|0);
 $291 = (getTempRet0() | 0);
 $292 = (_i64Add(($290|0),($291|0),($224|0),($225|0))|0);
 $293 = (getTempRet0() | 0);
 $294 = (_i64Add(($292|0),($293|0),($200|0),($201|0))|0);
 $295 = (getTempRet0() | 0);
 $296 = (_i64Add(($294|0),($295|0),($178|0),($179|0))|0);
 $297 = (getTempRet0() | 0);
 $298 = (_i64Add(($296|0),($297|0),($154|0),($155|0))|0);
 $299 = (getTempRet0() | 0);
 $300 = (_i64Add(($298|0),($299|0),($132|0),($133|0))|0);
 $301 = (getTempRet0() | 0);
 $302 = (_i64Add(($300|0),($301|0),($108|0),($109|0))|0);
 $303 = (getTempRet0() | 0);
 $304 = (_i64Add(($302|0),($303|0),($86|0),($87|0))|0);
 $305 = (getTempRet0() | 0);
 $306 = (_i64Add(($28|0),($29|0),($64|0),($65|0))|0);
 $307 = (getTempRet0() | 0);
 $308 = (_i64Add(($118|0),($119|0),($140|0),($141|0))|0);
 $309 = (getTempRet0() | 0);
 $310 = (_i64Add(($308|0),($309|0),($94|0),($95|0))|0);
 $311 = (getTempRet0() | 0);
 $312 = (_i64Add(($310|0),($311|0),($72|0),($73|0))|0);
 $313 = (getTempRet0() | 0);
 $314 = (_i64Add(($312|0),($313|0),($40|0),($41|0))|0);
 $315 = (getTempRet0() | 0);
 $316 = (_i64Add(($314|0),($315|0),($278|0),($279|0))|0);
 $317 = (getTempRet0() | 0);
 $318 = (_i64Add(($316|0),($317|0),($254|0),($255|0))|0);
 $319 = (getTempRet0() | 0);
 $320 = (_i64Add(($318|0),($319|0),($232|0),($233|0))|0);
 $321 = (getTempRet0() | 0);
 $322 = (_i64Add(($320|0),($321|0),($208|0),($209|0))|0);
 $323 = (getTempRet0() | 0);
 $324 = (_i64Add(($322|0),($323|0),($186|0),($187|0))|0);
 $325 = (getTempRet0() | 0);
 $326 = (_i64Add(($304|0),($305|0),33554432,0)|0);
 $327 = (getTempRet0() | 0);
 $328 = (_bitshift64Ashr(($326|0),($327|0),26)|0);
 $329 = (getTempRet0() | 0);
 $330 = (_i64Add(($306|0),($307|0),($272|0),($273|0))|0);
 $331 = (getTempRet0() | 0);
 $332 = (_i64Add(($330|0),($331|0),($248|0),($249|0))|0);
 $333 = (getTempRet0() | 0);
 $334 = (_i64Add(($332|0),($333|0),($226|0),($227|0))|0);
 $335 = (getTempRet0() | 0);
 $336 = (_i64Add(($334|0),($335|0),($202|0),($203|0))|0);
 $337 = (getTempRet0() | 0);
 $338 = (_i64Add(($336|0),($337|0),($180|0),($181|0))|0);
 $339 = (getTempRet0() | 0);
 $340 = (_i64Add(($338|0),($339|0),($156|0),($157|0))|0);
 $341 = (getTempRet0() | 0);
 $342 = (_i64Add(($340|0),($341|0),($134|0),($135|0))|0);
 $343 = (getTempRet0() | 0);
 $344 = (_i64Add(($342|0),($343|0),($110|0),($111|0))|0);
 $345 = (getTempRet0() | 0);
 $346 = (_i64Add(($344|0),($345|0),($328|0),($329|0))|0);
 $347 = (getTempRet0() | 0);
 $348 = $326 & -67108864;
 $349 = (_i64Subtract(($304|0),($305|0),($348|0),($327|0))|0);
 $350 = (getTempRet0() | 0);
 $351 = (_i64Add(($324|0),($325|0),33554432,0)|0);
 $352 = (getTempRet0() | 0);
 $353 = (_bitshift64Ashr(($351|0),($352|0),26)|0);
 $354 = (getTempRet0() | 0);
 $355 = (_i64Add(($142|0),($143|0),($164|0),($165|0))|0);
 $356 = (getTempRet0() | 0);
 $357 = (_i64Add(($355|0),($356|0),($120|0),($121|0))|0);
 $358 = (getTempRet0() | 0);
 $359 = (_i64Add(($357|0),($358|0),($96|0),($97|0))|0);
 $360 = (getTempRet0() | 0);
 $361 = (_i64Add(($359|0),($360|0),($74|0),($75|0))|0);
 $362 = (getTempRet0() | 0);
 $363 = (_i64Add(($361|0),($362|0),($44|0),($45|0))|0);
 $364 = (getTempRet0() | 0);
 $365 = (_i64Add(($363|0),($364|0),($280|0),($281|0))|0);
 $366 = (getTempRet0() | 0);
 $367 = (_i64Add(($365|0),($366|0),($256|0),($257|0))|0);
 $368 = (getTempRet0() | 0);
 $369 = (_i64Add(($367|0),($368|0),($234|0),($235|0))|0);
 $370 = (getTempRet0() | 0);
 $371 = (_i64Add(($369|0),($370|0),($210|0),($211|0))|0);
 $372 = (getTempRet0() | 0);
 $373 = (_i64Add(($371|0),($372|0),($353|0),($354|0))|0);
 $374 = (getTempRet0() | 0);
 $375 = $351 & -67108864;
 $376 = (_i64Subtract(($324|0),($325|0),($375|0),($352|0))|0);
 $377 = (getTempRet0() | 0);
 $378 = (_i64Add(($346|0),($347|0),16777216,0)|0);
 $379 = (getTempRet0() | 0);
 $380 = (_bitshift64Ashr(($378|0),($379|0),25)|0);
 $381 = (getTempRet0() | 0);
 $382 = (_i64Add(($68|0),($69|0),($90|0),($91|0))|0);
 $383 = (getTempRet0() | 0);
 $384 = (_i64Add(($382|0),($383|0),($32|0),($33|0))|0);
 $385 = (getTempRet0() | 0);
 $386 = (_i64Add(($384|0),($385|0),($274|0),($275|0))|0);
 $387 = (getTempRet0() | 0);
 $388 = (_i64Add(($386|0),($387|0),($250|0),($251|0))|0);
 $389 = (getTempRet0() | 0);
 $390 = (_i64Add(($388|0),($389|0),($228|0),($229|0))|0);
 $391 = (getTempRet0() | 0);
 $392 = (_i64Add(($390|0),($391|0),($204|0),($205|0))|0);
 $393 = (getTempRet0() | 0);
 $394 = (_i64Add(($392|0),($393|0),($182|0),($183|0))|0);
 $395 = (getTempRet0() | 0);
 $396 = (_i64Add(($394|0),($395|0),($158|0),($159|0))|0);
 $397 = (getTempRet0() | 0);
 $398 = (_i64Add(($396|0),($397|0),($136|0),($137|0))|0);
 $399 = (getTempRet0() | 0);
 $400 = (_i64Add(($398|0),($399|0),($380|0),($381|0))|0);
 $401 = (getTempRet0() | 0);
 $402 = $378 & -33554432;
 $403 = (_i64Subtract(($346|0),($347|0),($402|0),0)|0);
 $404 = (getTempRet0() | 0);
 $405 = (_i64Add(($373|0),($374|0),16777216,0)|0);
 $406 = (getTempRet0() | 0);
 $407 = (_bitshift64Ashr(($405|0),($406|0),25)|0);
 $408 = (getTempRet0() | 0);
 $409 = (_i64Add(($168|0),($169|0),($190|0),($191|0))|0);
 $410 = (getTempRet0() | 0);
 $411 = (_i64Add(($409|0),($410|0),($144|0),($145|0))|0);
 $412 = (getTempRet0() | 0);
 $413 = (_i64Add(($411|0),($412|0),($122|0),($123|0))|0);
 $414 = (getTempRet0() | 0);
 $415 = (_i64Add(($413|0),($414|0),($98|0),($99|0))|0);
 $416 = (getTempRet0() | 0);
 $417 = (_i64Add(($415|0),($416|0),($76|0),($77|0))|0);
 $418 = (getTempRet0() | 0);
 $419 = (_i64Add(($417|0),($418|0),($48|0),($49|0))|0);
 $420 = (getTempRet0() | 0);
 $421 = (_i64Add(($419|0),($420|0),($282|0),($283|0))|0);
 $422 = (getTempRet0() | 0);
 $423 = (_i64Add(($421|0),($422|0),($258|0),($259|0))|0);
 $424 = (getTempRet0() | 0);
 $425 = (_i64Add(($423|0),($424|0),($236|0),($237|0))|0);
 $426 = (getTempRet0() | 0);
 $427 = (_i64Add(($425|0),($426|0),($407|0),($408|0))|0);
 $428 = (getTempRet0() | 0);
 $429 = $405 & -33554432;
 $430 = (_i64Subtract(($373|0),($374|0),($429|0),0)|0);
 $431 = (getTempRet0() | 0);
 $432 = (_i64Add(($400|0),($401|0),33554432,0)|0);
 $433 = (getTempRet0() | 0);
 $434 = (_bitshift64Ashr(($432|0),($433|0),26)|0);
 $435 = (getTempRet0() | 0);
 $436 = (_i64Add(($92|0),($93|0),($114|0),($115|0))|0);
 $437 = (getTempRet0() | 0);
 $438 = (_i64Add(($436|0),($437|0),($70|0),($71|0))|0);
 $439 = (getTempRet0() | 0);
 $440 = (_i64Add(($438|0),($439|0),($36|0),($37|0))|0);
 $441 = (getTempRet0() | 0);
 $442 = (_i64Add(($440|0),($441|0),($276|0),($277|0))|0);
 $443 = (getTempRet0() | 0);
 $444 = (_i64Add(($442|0),($443|0),($252|0),($253|0))|0);
 $445 = (getTempRet0() | 0);
 $446 = (_i64Add(($444|0),($445|0),($230|0),($231|0))|0);
 $447 = (getTempRet0() | 0);
 $448 = (_i64Add(($446|0),($447|0),($206|0),($207|0))|0);
 $449 = (getTempRet0() | 0);
 $450 = (_i64Add(($448|0),($449|0),($184|0),($185|0))|0);
 $451 = (getTempRet0() | 0);
 $452 = (_i64Add(($450|0),($451|0),($160|0),($161|0))|0);
 $453 = (getTempRet0() | 0);
 $454 = (_i64Add(($452|0),($453|0),($434|0),($435|0))|0);
 $455 = (getTempRet0() | 0);
 $456 = $432 & -67108864;
 $457 = (_i64Subtract(($400|0),($401|0),($456|0),0)|0);
 $458 = (getTempRet0() | 0);
 $459 = (_i64Add(($427|0),($428|0),33554432,0)|0);
 $460 = (getTempRet0() | 0);
 $461 = (_bitshift64Ashr(($459|0),($460|0),26)|0);
 $462 = (getTempRet0() | 0);
 $463 = (_i64Add(($192|0),($193|0),($214|0),($215|0))|0);
 $464 = (getTempRet0() | 0);
 $465 = (_i64Add(($463|0),($464|0),($170|0),($171|0))|0);
 $466 = (getTempRet0() | 0);
 $467 = (_i64Add(($465|0),($466|0),($146|0),($147|0))|0);
 $468 = (getTempRet0() | 0);
 $469 = (_i64Add(($467|0),($468|0),($124|0),($125|0))|0);
 $470 = (getTempRet0() | 0);
 $471 = (_i64Add(($469|0),($470|0),($100|0),($101|0))|0);
 $472 = (getTempRet0() | 0);
 $473 = (_i64Add(($471|0),($472|0),($78|0),($79|0))|0);
 $474 = (getTempRet0() | 0);
 $475 = (_i64Add(($473|0),($474|0),($52|0),($53|0))|0);
 $476 = (getTempRet0() | 0);
 $477 = (_i64Add(($475|0),($476|0),($284|0),($285|0))|0);
 $478 = (getTempRet0() | 0);
 $479 = (_i64Add(($477|0),($478|0),($260|0),($261|0))|0);
 $480 = (getTempRet0() | 0);
 $481 = (_i64Add(($479|0),($480|0),($461|0),($462|0))|0);
 $482 = (getTempRet0() | 0);
 $483 = $459 & -67108864;
 $484 = (_i64Subtract(($427|0),($428|0),($483|0),0)|0);
 $485 = (getTempRet0() | 0);
 $486 = (_i64Add(($454|0),($455|0),16777216,0)|0);
 $487 = (getTempRet0() | 0);
 $488 = (_bitshift64Ashr(($486|0),($487|0),25)|0);
 $489 = (getTempRet0() | 0);
 $490 = (_i64Add(($488|0),($489|0),($376|0),($377|0))|0);
 $491 = (getTempRet0() | 0);
 $492 = $486 & -33554432;
 $493 = (_i64Subtract(($454|0),($455|0),($492|0),0)|0);
 $494 = (getTempRet0() | 0);
 $495 = (_i64Add(($481|0),($482|0),16777216,0)|0);
 $496 = (getTempRet0() | 0);
 $497 = (_bitshift64Ashr(($495|0),($496|0),25)|0);
 $498 = (getTempRet0() | 0);
 $499 = (_i64Add(($218|0),($219|0),($240|0),($241|0))|0);
 $500 = (getTempRet0() | 0);
 $501 = (_i64Add(($499|0),($500|0),($194|0),($195|0))|0);
 $502 = (getTempRet0() | 0);
 $503 = (_i64Add(($501|0),($502|0),($172|0),($173|0))|0);
 $504 = (getTempRet0() | 0);
 $505 = (_i64Add(($503|0),($504|0),($148|0),($149|0))|0);
 $506 = (getTempRet0() | 0);
 $507 = (_i64Add(($505|0),($506|0),($126|0),($127|0))|0);
 $508 = (getTempRet0() | 0);
 $509 = (_i64Add(($507|0),($508|0),($102|0),($103|0))|0);
 $510 = (getTempRet0() | 0);
 $511 = (_i64Add(($509|0),($510|0),($80|0),($81|0))|0);
 $512 = (getTempRet0() | 0);
 $513 = (_i64Add(($511|0),($512|0),($56|0),($57|0))|0);
 $514 = (getTempRet0() | 0);
 $515 = (_i64Add(($513|0),($514|0),($286|0),($287|0))|0);
 $516 = (getTempRet0() | 0);
 $517 = (_i64Add(($515|0),($516|0),($497|0),($498|0))|0);
 $518 = (getTempRet0() | 0);
 $519 = $495 & -33554432;
 $520 = (_i64Subtract(($481|0),($482|0),($519|0),0)|0);
 $521 = (getTempRet0() | 0);
 $522 = (_i64Add(($490|0),($491|0),33554432,0)|0);
 $523 = (getTempRet0() | 0);
 $524 = (_bitshift64Lshr(($522|0),($523|0),26)|0);
 $525 = (getTempRet0() | 0);
 $526 = (_i64Add(($430|0),($431|0),($524|0),($525|0))|0);
 $527 = (getTempRet0() | 0);
 $528 = $522 & -67108864;
 $529 = (_i64Subtract(($490|0),($491|0),($528|0),0)|0);
 $530 = (getTempRet0() | 0);
 $531 = (_i64Add(($517|0),($518|0),33554432,0)|0);
 $532 = (getTempRet0() | 0);
 $533 = (_bitshift64Ashr(($531|0),($532|0),26)|0);
 $534 = (getTempRet0() | 0);
 $535 = (_i64Add(($242|0),($243|0),($264|0),($265|0))|0);
 $536 = (getTempRet0() | 0);
 $537 = (_i64Add(($535|0),($536|0),($220|0),($221|0))|0);
 $538 = (getTempRet0() | 0);
 $539 = (_i64Add(($537|0),($538|0),($196|0),($197|0))|0);
 $540 = (getTempRet0() | 0);
 $541 = (_i64Add(($539|0),($540|0),($174|0),($175|0))|0);
 $542 = (getTempRet0() | 0);
 $543 = (_i64Add(($541|0),($542|0),($150|0),($151|0))|0);
 $544 = (getTempRet0() | 0);
 $545 = (_i64Add(($543|0),($544|0),($128|0),($129|0))|0);
 $546 = (getTempRet0() | 0);
 $547 = (_i64Add(($545|0),($546|0),($104|0),($105|0))|0);
 $548 = (getTempRet0() | 0);
 $549 = (_i64Add(($547|0),($548|0),($82|0),($83|0))|0);
 $550 = (getTempRet0() | 0);
 $551 = (_i64Add(($549|0),($550|0),($60|0),($61|0))|0);
 $552 = (getTempRet0() | 0);
 $553 = (_i64Add(($551|0),($552|0),($533|0),($534|0))|0);
 $554 = (getTempRet0() | 0);
 $555 = $531 & -67108864;
 $556 = (_i64Subtract(($517|0),($518|0),($555|0),0)|0);
 $557 = (getTempRet0() | 0);
 $558 = (_i64Add(($553|0),($554|0),16777216,0)|0);
 $559 = (getTempRet0() | 0);
 $560 = (_bitshift64Ashr(($558|0),($559|0),25)|0);
 $561 = (getTempRet0() | 0);
 $562 = (___muldi3(($560|0),($561|0),19,0)|0);
 $563 = (getTempRet0() | 0);
 $564 = (_i64Add(($562|0),($563|0),($349|0),($350|0))|0);
 $565 = (getTempRet0() | 0);
 $566 = $558 & -33554432;
 $567 = (_i64Subtract(($553|0),($554|0),($566|0),0)|0);
 $568 = (getTempRet0() | 0);
 $569 = (_i64Add(($564|0),($565|0),33554432,0)|0);
 $570 = (getTempRet0() | 0);
 $571 = (_bitshift64Lshr(($569|0),($570|0),26)|0);
 $572 = (getTempRet0() | 0);
 $573 = (_i64Add(($403|0),($404|0),($571|0),($572|0))|0);
 $574 = (getTempRet0() | 0);
 $575 = $569 & -67108864;
 $576 = (_i64Subtract(($564|0),($565|0),($575|0),0)|0);
 $577 = (getTempRet0() | 0);
 HEAP32[$h>>2] = $576;
 $arrayidx482 = ((($h)) + 4|0);
 HEAP32[$arrayidx482>>2] = $573;
 $arrayidx484 = ((($h)) + 8|0);
 HEAP32[$arrayidx484>>2] = $457;
 $arrayidx486 = ((($h)) + 12|0);
 HEAP32[$arrayidx486>>2] = $493;
 $arrayidx488 = ((($h)) + 16|0);
 HEAP32[$arrayidx488>>2] = $529;
 $arrayidx490 = ((($h)) + 20|0);
 HEAP32[$arrayidx490>>2] = $526;
 $arrayidx492 = ((($h)) + 24|0);
 HEAP32[$arrayidx492>>2] = $484;
 $arrayidx494 = ((($h)) + 28|0);
 HEAP32[$arrayidx494>>2] = $520;
 $arrayidx496 = ((($h)) + 32|0);
 HEAP32[$arrayidx496>>2] = $556;
 $arrayidx498 = ((($h)) + 36|0);
 HEAP32[$arrayidx498>>2] = $567;
 return;
}
function _fe_isnegative($f) {
 $f = $f|0;
 var $0 = 0, $1 = 0, $and = 0, $s = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 32|0;
 $s = sp;
 _fe_tobytes($s,$f);
 $0 = HEAP8[$s>>0]|0;
 $1 = $0 & 1;
 $and = $1&255;
 STACKTOP = sp;return ($and|0);
}
function _fe_tobytes($s,$h) {
 $s = $s|0;
 $h = $h|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $add = 0;
 var $add10 = 0, $add12 = 0, $add14 = 0, $add16 = 0, $add18 = 0, $add20 = 0, $add22 = 0, $add24 = 0, $add26 = 0, $add28 = 0, $add31 = 0, $add33 = 0, $add35 = 0, $add39 = 0, $add43 = 0, $add47 = 0, $add51 = 0, $add55 = 0, $add59 = 0, $add63 = 0;
 var $arrayidx1 = 0, $arrayidx102 = 0, $arrayidx105 = 0, $arrayidx108 = 0, $arrayidx113 = 0, $arrayidx116 = 0, $arrayidx119 = 0, $arrayidx122 = 0, $arrayidx125 = 0, $arrayidx128 = 0, $arrayidx131 = 0, $arrayidx136 = 0, $arrayidx139 = 0, $arrayidx142 = 0, $arrayidx147 = 0, $arrayidx150 = 0, $arrayidx153 = 0, $arrayidx158 = 0, $arrayidx161 = 0, $arrayidx164 = 0;
 var $arrayidx169 = 0, $arrayidx172 = 0, $arrayidx175 = 0, $arrayidx178 = 0, $arrayidx2 = 0, $arrayidx3 = 0, $arrayidx4 = 0, $arrayidx5 = 0, $arrayidx6 = 0, $arrayidx7 = 0, $arrayidx73 = 0, $arrayidx76 = 0, $arrayidx8 = 0, $arrayidx80 = 0, $arrayidx83 = 0, $arrayidx86 = 0, $arrayidx9 = 0, $arrayidx91 = 0, $arrayidx94 = 0, $arrayidx97 = 0;
 var $conv = 0, $conv101 = 0, $conv104 = 0, $conv107 = 0, $conv112 = 0, $conv115 = 0, $conv118 = 0, $conv121 = 0, $conv124 = 0, $conv127 = 0, $conv130 = 0, $conv135 = 0, $conv138 = 0, $conv141 = 0, $conv146 = 0, $conv149 = 0, $conv152 = 0, $conv157 = 0, $conv160 = 0, $conv163 = 0;
 var $conv168 = 0, $conv171 = 0, $conv174 = 0, $conv177 = 0, $conv72 = 0, $conv75 = 0, $conv79 = 0, $conv82 = 0, $conv85 = 0, $conv90 = 0, $conv93 = 0, $conv96 = 0, $mul = 0, $mul30 = 0, $or = 0, $or100 = 0, $or111 = 0, $or134 = 0, $or145 = 0, $or156 = 0;
 var $or167 = 0, $or89 = 0, $shl110 = 0, $shl133 = 0, $shl144 = 0, $shl155 = 0, $shl166 = 0, $shl78 = 0, $shl88 = 0, $shl99 = 0, $shr = 0, $shr11 = 0, $shr13 = 0, $shr15 = 0, $shr17 = 0, $shr19 = 0, $shr21 = 0, $shr23 = 0, $shr25 = 0, $shr27 = 0;
 var $shr29 = 0, $shr32 = 0, $shr34 = 0, $shr38 = 0, $shr42 = 0, $shr46 = 0, $shr50 = 0, $shr54 = 0, $shr58 = 0, $shr62 = 0, $sub = 0, $sub37 = 0, $sub41 = 0, $sub45 = 0, $sub49 = 0, $sub53 = 0, $sub57 = 0, $sub61 = 0, $sub65 = 0, $sub68 = 0;
 var label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[$h>>2]|0;
 $arrayidx1 = ((($h)) + 4|0);
 $1 = HEAP32[$arrayidx1>>2]|0;
 $arrayidx2 = ((($h)) + 8|0);
 $2 = HEAP32[$arrayidx2>>2]|0;
 $arrayidx3 = ((($h)) + 12|0);
 $3 = HEAP32[$arrayidx3>>2]|0;
 $arrayidx4 = ((($h)) + 16|0);
 $4 = HEAP32[$arrayidx4>>2]|0;
 $arrayidx5 = ((($h)) + 20|0);
 $5 = HEAP32[$arrayidx5>>2]|0;
 $arrayidx6 = ((($h)) + 24|0);
 $6 = HEAP32[$arrayidx6>>2]|0;
 $arrayidx7 = ((($h)) + 28|0);
 $7 = HEAP32[$arrayidx7>>2]|0;
 $arrayidx8 = ((($h)) + 32|0);
 $8 = HEAP32[$arrayidx8>>2]|0;
 $arrayidx9 = ((($h)) + 36|0);
 $9 = HEAP32[$arrayidx9>>2]|0;
 $mul = ($9*19)|0;
 $add = (($mul) + 16777216)|0;
 $shr = $add >> 25;
 $add10 = (($shr) + ($0))|0;
 $shr11 = $add10 >> 26;
 $add12 = (($shr11) + ($1))|0;
 $shr13 = $add12 >> 25;
 $add14 = (($shr13) + ($2))|0;
 $shr15 = $add14 >> 26;
 $add16 = (($shr15) + ($3))|0;
 $shr17 = $add16 >> 25;
 $add18 = (($shr17) + ($4))|0;
 $shr19 = $add18 >> 26;
 $add20 = (($shr19) + ($5))|0;
 $shr21 = $add20 >> 25;
 $add22 = (($shr21) + ($6))|0;
 $shr23 = $add22 >> 26;
 $add24 = (($shr23) + ($7))|0;
 $shr25 = $add24 >> 25;
 $add26 = (($shr25) + ($8))|0;
 $shr27 = $add26 >> 26;
 $add28 = (($shr27) + ($9))|0;
 $shr29 = $add28 >> 25;
 $mul30 = ($shr29*19)|0;
 $add31 = (($mul30) + ($0))|0;
 $shr32 = $add31 >> 26;
 $add33 = (($shr32) + ($1))|0;
 $shr34 = $add33 >> 25;
 $add35 = (($shr34) + ($2))|0;
 $sub37 = $add33 & 33554431;
 $shr38 = $add35 >> 26;
 $add39 = (($shr38) + ($3))|0;
 $sub41 = $add35 & 67108863;
 $shr42 = $add39 >> 25;
 $add43 = (($shr42) + ($4))|0;
 $sub45 = $add39 & 33554431;
 $shr46 = $add43 >> 26;
 $add47 = (($shr46) + ($5))|0;
 $shr50 = $add47 >> 25;
 $add51 = (($shr50) + ($6))|0;
 $shr54 = $add51 >> 26;
 $add55 = (($shr54) + ($7))|0;
 $sub57 = $add51 & 67108863;
 $shr58 = $add55 >> 25;
 $add59 = (($shr58) + ($8))|0;
 $sub61 = $add55 & 33554431;
 $shr62 = $add59 >> 26;
 $add63 = (($shr62) + ($9))|0;
 $sub65 = $add59 & 67108863;
 $sub68 = $add63 & 33554431;
 $conv = $add31&255;
 HEAP8[$s>>0] = $conv;
 $10 = $add31 >>> 8;
 $conv72 = $10&255;
 $arrayidx73 = ((($s)) + 1|0);
 HEAP8[$arrayidx73>>0] = $conv72;
 $11 = $add31 >>> 16;
 $conv75 = $11&255;
 $arrayidx76 = ((($s)) + 2|0);
 HEAP8[$arrayidx76>>0] = $conv75;
 $sub = $add31 >>> 24;
 $12 = $sub & 3;
 $shl78 = $sub37 << 2;
 $or = $shl78 | $12;
 $conv79 = $or&255;
 $arrayidx80 = ((($s)) + 3|0);
 HEAP8[$arrayidx80>>0] = $conv79;
 $13 = $add33 >>> 6;
 $conv82 = $13&255;
 $arrayidx83 = ((($s)) + 4|0);
 HEAP8[$arrayidx83>>0] = $conv82;
 $14 = $add33 >>> 14;
 $conv85 = $14&255;
 $arrayidx86 = ((($s)) + 5|0);
 HEAP8[$arrayidx86>>0] = $conv85;
 $15 = $sub37 >>> 22;
 $shl88 = $sub41 << 3;
 $or89 = $shl88 | $15;
 $conv90 = $or89&255;
 $arrayidx91 = ((($s)) + 6|0);
 HEAP8[$arrayidx91>>0] = $conv90;
 $16 = $add35 >>> 5;
 $conv93 = $16&255;
 $arrayidx94 = ((($s)) + 7|0);
 HEAP8[$arrayidx94>>0] = $conv93;
 $17 = $add35 >>> 13;
 $conv96 = $17&255;
 $arrayidx97 = ((($s)) + 8|0);
 HEAP8[$arrayidx97>>0] = $conv96;
 $18 = $sub41 >>> 21;
 $shl99 = $sub45 << 5;
 $or100 = $shl99 | $18;
 $conv101 = $or100&255;
 $arrayidx102 = ((($s)) + 9|0);
 HEAP8[$arrayidx102>>0] = $conv101;
 $19 = $add39 >>> 3;
 $conv104 = $19&255;
 $arrayidx105 = ((($s)) + 10|0);
 HEAP8[$arrayidx105>>0] = $conv104;
 $20 = $add39 >>> 11;
 $conv107 = $20&255;
 $arrayidx108 = ((($s)) + 11|0);
 HEAP8[$arrayidx108>>0] = $conv107;
 $21 = $sub45 >>> 19;
 $shl110 = $add43 << 6;
 $or111 = $shl110 | $21;
 $conv112 = $or111&255;
 $arrayidx113 = ((($s)) + 12|0);
 HEAP8[$arrayidx113>>0] = $conv112;
 $22 = $add43 >>> 2;
 $conv115 = $22&255;
 $arrayidx116 = ((($s)) + 13|0);
 HEAP8[$arrayidx116>>0] = $conv115;
 $23 = $add43 >>> 10;
 $conv118 = $23&255;
 $arrayidx119 = ((($s)) + 14|0);
 HEAP8[$arrayidx119>>0] = $conv118;
 $sub49 = $add43 >>> 18;
 $conv121 = $sub49&255;
 $arrayidx122 = ((($s)) + 15|0);
 HEAP8[$arrayidx122>>0] = $conv121;
 $conv124 = $add47&255;
 $arrayidx125 = ((($s)) + 16|0);
 HEAP8[$arrayidx125>>0] = $conv124;
 $24 = $add47 >>> 8;
 $conv127 = $24&255;
 $arrayidx128 = ((($s)) + 17|0);
 HEAP8[$arrayidx128>>0] = $conv127;
 $25 = $add47 >>> 16;
 $conv130 = $25&255;
 $arrayidx131 = ((($s)) + 18|0);
 HEAP8[$arrayidx131>>0] = $conv130;
 $sub53 = $add47 >>> 24;
 $26 = $sub53 & 1;
 $shl133 = $sub57 << 1;
 $or134 = $shl133 | $26;
 $conv135 = $or134&255;
 $arrayidx136 = ((($s)) + 19|0);
 HEAP8[$arrayidx136>>0] = $conv135;
 $27 = $add51 >>> 7;
 $conv138 = $27&255;
 $arrayidx139 = ((($s)) + 20|0);
 HEAP8[$arrayidx139>>0] = $conv138;
 $28 = $add51 >>> 15;
 $conv141 = $28&255;
 $arrayidx142 = ((($s)) + 21|0);
 HEAP8[$arrayidx142>>0] = $conv141;
 $29 = $sub57 >>> 23;
 $shl144 = $sub61 << 3;
 $or145 = $shl144 | $29;
 $conv146 = $or145&255;
 $arrayidx147 = ((($s)) + 22|0);
 HEAP8[$arrayidx147>>0] = $conv146;
 $30 = $add55 >>> 5;
 $conv149 = $30&255;
 $arrayidx150 = ((($s)) + 23|0);
 HEAP8[$arrayidx150>>0] = $conv149;
 $31 = $add55 >>> 13;
 $conv152 = $31&255;
 $arrayidx153 = ((($s)) + 24|0);
 HEAP8[$arrayidx153>>0] = $conv152;
 $32 = $sub61 >>> 21;
 $shl155 = $sub65 << 4;
 $or156 = $shl155 | $32;
 $conv157 = $or156&255;
 $arrayidx158 = ((($s)) + 25|0);
 HEAP8[$arrayidx158>>0] = $conv157;
 $33 = $add59 >>> 4;
 $conv160 = $33&255;
 $arrayidx161 = ((($s)) + 26|0);
 HEAP8[$arrayidx161>>0] = $conv160;
 $34 = $add59 >>> 12;
 $conv163 = $34&255;
 $arrayidx164 = ((($s)) + 27|0);
 HEAP8[$arrayidx164>>0] = $conv163;
 $35 = $sub65 >>> 20;
 $shl166 = $sub68 << 6;
 $or167 = $shl166 | $35;
 $conv168 = $or167&255;
 $arrayidx169 = ((($s)) + 28|0);
 HEAP8[$arrayidx169>>0] = $conv168;
 $36 = $add63 >>> 2;
 $conv171 = $36&255;
 $arrayidx172 = ((($s)) + 29|0);
 HEAP8[$arrayidx172>>0] = $conv171;
 $37 = $add63 >>> 10;
 $conv174 = $37&255;
 $arrayidx175 = ((($s)) + 30|0);
 HEAP8[$arrayidx175>>0] = $conv174;
 $38 = $sub68 >>> 18;
 $conv177 = $38&255;
 $arrayidx178 = ((($s)) + 31|0);
 HEAP8[$arrayidx178>>0] = $conv177;
 return;
}
function _fe_isnonzero($f) {
 $f = $f|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $arrayidx1 = 0, $arrayidx104 = 0, $arrayidx109 = 0, $arrayidx114 = 0, $arrayidx119 = 0, $arrayidx124 = 0, $arrayidx129 = 0, $arrayidx134 = 0;
 var $arrayidx139 = 0, $arrayidx14 = 0, $arrayidx144 = 0, $arrayidx149 = 0, $arrayidx19 = 0, $arrayidx24 = 0, $arrayidx29 = 0, $arrayidx34 = 0, $arrayidx39 = 0, $arrayidx4 = 0, $arrayidx44 = 0, $arrayidx49 = 0, $arrayidx54 = 0, $arrayidx59 = 0, $arrayidx64 = 0, $arrayidx69 = 0, $arrayidx74 = 0, $arrayidx79 = 0, $arrayidx84 = 0, $arrayidx89 = 0;
 var $arrayidx9 = 0, $arrayidx94 = 0, $arrayidx99 = 0, $cmp = 0, $conv155 = 0, $or10253 = 0, $or10754 = 0, $or11255 = 0, $or11756 = 0, $or12257 = 0, $or1235 = 0, $or12758 = 0, $or13259 = 0, $or13760 = 0, $or14261 = 0, $or14762 = 0, $or15263 = 0, $or1736 = 0, $or2237 = 0, $or2738 = 0;
 var $or3239 = 0, $or33 = 0, $or3740 = 0, $or4241 = 0, $or4742 = 0, $or5243 = 0, $or5744 = 0, $or6245 = 0, $or6746 = 0, $or7247 = 0, $or734 = 0, $or7748 = 0, $or8249 = 0, $or8750 = 0, $or9251 = 0, $or9752 = 0, $s = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 32|0;
 $s = sp;
 _fe_tobytes($s,$f);
 $0 = HEAP8[$s>>0]|0;
 $arrayidx1 = ((($s)) + 1|0);
 $1 = HEAP8[$arrayidx1>>0]|0;
 $or33 = $1 | $0;
 $arrayidx4 = ((($s)) + 2|0);
 $2 = HEAP8[$arrayidx4>>0]|0;
 $or734 = $or33 | $2;
 $arrayidx9 = ((($s)) + 3|0);
 $3 = HEAP8[$arrayidx9>>0]|0;
 $or1235 = $or734 | $3;
 $arrayidx14 = ((($s)) + 4|0);
 $4 = HEAP8[$arrayidx14>>0]|0;
 $or1736 = $or1235 | $4;
 $arrayidx19 = ((($s)) + 5|0);
 $5 = HEAP8[$arrayidx19>>0]|0;
 $or2237 = $or1736 | $5;
 $arrayidx24 = ((($s)) + 6|0);
 $6 = HEAP8[$arrayidx24>>0]|0;
 $or2738 = $or2237 | $6;
 $arrayidx29 = ((($s)) + 7|0);
 $7 = HEAP8[$arrayidx29>>0]|0;
 $or3239 = $or2738 | $7;
 $arrayidx34 = ((($s)) + 8|0);
 $8 = HEAP8[$arrayidx34>>0]|0;
 $or3740 = $or3239 | $8;
 $arrayidx39 = ((($s)) + 9|0);
 $9 = HEAP8[$arrayidx39>>0]|0;
 $or4241 = $or3740 | $9;
 $arrayidx44 = ((($s)) + 10|0);
 $10 = HEAP8[$arrayidx44>>0]|0;
 $or4742 = $or4241 | $10;
 $arrayidx49 = ((($s)) + 11|0);
 $11 = HEAP8[$arrayidx49>>0]|0;
 $or5243 = $or4742 | $11;
 $arrayidx54 = ((($s)) + 12|0);
 $12 = HEAP8[$arrayidx54>>0]|0;
 $or5744 = $or5243 | $12;
 $arrayidx59 = ((($s)) + 13|0);
 $13 = HEAP8[$arrayidx59>>0]|0;
 $or6245 = $or5744 | $13;
 $arrayidx64 = ((($s)) + 14|0);
 $14 = HEAP8[$arrayidx64>>0]|0;
 $or6746 = $or6245 | $14;
 $arrayidx69 = ((($s)) + 15|0);
 $15 = HEAP8[$arrayidx69>>0]|0;
 $or7247 = $or6746 | $15;
 $arrayidx74 = ((($s)) + 16|0);
 $16 = HEAP8[$arrayidx74>>0]|0;
 $or7748 = $or7247 | $16;
 $arrayidx79 = ((($s)) + 17|0);
 $17 = HEAP8[$arrayidx79>>0]|0;
 $or8249 = $or7748 | $17;
 $arrayidx84 = ((($s)) + 18|0);
 $18 = HEAP8[$arrayidx84>>0]|0;
 $or8750 = $or8249 | $18;
 $arrayidx89 = ((($s)) + 19|0);
 $19 = HEAP8[$arrayidx89>>0]|0;
 $or9251 = $or8750 | $19;
 $arrayidx94 = ((($s)) + 20|0);
 $20 = HEAP8[$arrayidx94>>0]|0;
 $or9752 = $or9251 | $20;
 $arrayidx99 = ((($s)) + 21|0);
 $21 = HEAP8[$arrayidx99>>0]|0;
 $or10253 = $or9752 | $21;
 $arrayidx104 = ((($s)) + 22|0);
 $22 = HEAP8[$arrayidx104>>0]|0;
 $or10754 = $or10253 | $22;
 $arrayidx109 = ((($s)) + 23|0);
 $23 = HEAP8[$arrayidx109>>0]|0;
 $or11255 = $or10754 | $23;
 $arrayidx114 = ((($s)) + 24|0);
 $24 = HEAP8[$arrayidx114>>0]|0;
 $or11756 = $or11255 | $24;
 $arrayidx119 = ((($s)) + 25|0);
 $25 = HEAP8[$arrayidx119>>0]|0;
 $or12257 = $or11756 | $25;
 $arrayidx124 = ((($s)) + 26|0);
 $26 = HEAP8[$arrayidx124>>0]|0;
 $or12758 = $or12257 | $26;
 $arrayidx129 = ((($s)) + 27|0);
 $27 = HEAP8[$arrayidx129>>0]|0;
 $or13259 = $or12758 | $27;
 $arrayidx134 = ((($s)) + 28|0);
 $28 = HEAP8[$arrayidx134>>0]|0;
 $or13760 = $or13259 | $28;
 $arrayidx139 = ((($s)) + 29|0);
 $29 = HEAP8[$arrayidx139>>0]|0;
 $or14261 = $or13760 | $29;
 $arrayidx144 = ((($s)) + 30|0);
 $30 = HEAP8[$arrayidx144>>0]|0;
 $or14762 = $or14261 | $30;
 $arrayidx149 = ((($s)) + 31|0);
 $31 = HEAP8[$arrayidx149>>0]|0;
 $or15263 = $or14762 | $31;
 $cmp = ($or15263<<24>>24)!=(0);
 $conv155 = $cmp&1;
 STACKTOP = sp;return ($conv155|0);
}
function _fe_neg($h,$f) {
 $h = $h|0;
 $f = $f|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $arrayidx1 = 0, $arrayidx2 = 0, $arrayidx20 = 0, $arrayidx21 = 0, $arrayidx22 = 0, $arrayidx23 = 0, $arrayidx24 = 0, $arrayidx25 = 0, $arrayidx26 = 0, $arrayidx27 = 0;
 var $arrayidx28 = 0, $arrayidx3 = 0, $arrayidx4 = 0, $arrayidx5 = 0, $arrayidx6 = 0, $arrayidx7 = 0, $arrayidx8 = 0, $arrayidx9 = 0, $sub = 0, $sub10 = 0, $sub11 = 0, $sub12 = 0, $sub13 = 0, $sub14 = 0, $sub15 = 0, $sub16 = 0, $sub17 = 0, $sub18 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[$f>>2]|0;
 $arrayidx1 = ((($f)) + 4|0);
 $1 = HEAP32[$arrayidx1>>2]|0;
 $arrayidx2 = ((($f)) + 8|0);
 $2 = HEAP32[$arrayidx2>>2]|0;
 $arrayidx3 = ((($f)) + 12|0);
 $3 = HEAP32[$arrayidx3>>2]|0;
 $arrayidx4 = ((($f)) + 16|0);
 $4 = HEAP32[$arrayidx4>>2]|0;
 $arrayidx5 = ((($f)) + 20|0);
 $5 = HEAP32[$arrayidx5>>2]|0;
 $arrayidx6 = ((($f)) + 24|0);
 $6 = HEAP32[$arrayidx6>>2]|0;
 $arrayidx7 = ((($f)) + 28|0);
 $7 = HEAP32[$arrayidx7>>2]|0;
 $arrayidx8 = ((($f)) + 32|0);
 $8 = HEAP32[$arrayidx8>>2]|0;
 $arrayidx9 = ((($f)) + 36|0);
 $9 = HEAP32[$arrayidx9>>2]|0;
 $sub = (0 - ($0))|0;
 $sub10 = (0 - ($1))|0;
 $sub11 = (0 - ($2))|0;
 $sub12 = (0 - ($3))|0;
 $sub13 = (0 - ($4))|0;
 $sub14 = (0 - ($5))|0;
 $sub15 = (0 - ($6))|0;
 $sub16 = (0 - ($7))|0;
 $sub17 = (0 - ($8))|0;
 $sub18 = (0 - ($9))|0;
 HEAP32[$h>>2] = $sub;
 $arrayidx20 = ((($h)) + 4|0);
 HEAP32[$arrayidx20>>2] = $sub10;
 $arrayidx21 = ((($h)) + 8|0);
 HEAP32[$arrayidx21>>2] = $sub11;
 $arrayidx22 = ((($h)) + 12|0);
 HEAP32[$arrayidx22>>2] = $sub12;
 $arrayidx23 = ((($h)) + 16|0);
 HEAP32[$arrayidx23>>2] = $sub13;
 $arrayidx24 = ((($h)) + 20|0);
 HEAP32[$arrayidx24>>2] = $sub14;
 $arrayidx25 = ((($h)) + 24|0);
 HEAP32[$arrayidx25>>2] = $sub15;
 $arrayidx26 = ((($h)) + 28|0);
 HEAP32[$arrayidx26>>2] = $sub16;
 $arrayidx27 = ((($h)) + 32|0);
 HEAP32[$arrayidx27>>2] = $sub17;
 $arrayidx28 = ((($h)) + 36|0);
 HEAP32[$arrayidx28>>2] = $sub18;
 return;
}
function _fe_pow22523($out,$z) {
 $out = $out|0;
 $z = $z|0;
 var $exitcond = 0, $exitcond34 = 0, $exitcond35 = 0, $i$728 = 0, $i$827 = 0, $i$926 = 0, $inc104 = 0, $inc117 = 0, $inc91 = 0, $t0 = 0, $t1 = 0, $t2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 144|0;
 $t0 = sp + 96|0;
 $t1 = sp + 48|0;
 $t2 = sp;
 _fe_sq($t0,$z);
 _fe_sq($t1,$t0);
 _fe_sq($t1,$t1);
 _fe_mul($t1,$z,$t1);
 _fe_mul($t0,$t0,$t1);
 _fe_sq($t0,$t0);
 _fe_mul($t0,$t1,$t0);
 _fe_sq($t1,$t0);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_mul($t0,$t1,$t0);
 _fe_sq($t1,$t0);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_mul($t1,$t1,$t0);
 _fe_sq($t2,$t1);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_sq($t2,$t2);
 _fe_mul($t1,$t2,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_sq($t1,$t1);
 _fe_mul($t0,$t1,$t0);
 _fe_sq($t1,$t0);
 $i$728 = 1;
 while(1) {
  _fe_sq($t1,$t1);
  $inc91 = (($i$728) + 1)|0;
  $exitcond35 = ($inc91|0)==(50);
  if ($exitcond35) {
   break;
  } else {
   $i$728 = $inc91;
  }
 }
 _fe_mul($t1,$t1,$t0);
 _fe_sq($t2,$t1);
 $i$827 = 1;
 while(1) {
  _fe_sq($t2,$t2);
  $inc104 = (($i$827) + 1)|0;
  $exitcond34 = ($inc104|0)==(100);
  if ($exitcond34) {
   break;
  } else {
   $i$827 = $inc104;
  }
 }
 _fe_mul($t1,$t2,$t1);
 _fe_sq($t1,$t1);
 $i$926 = 1;
 while(1) {
  _fe_sq($t1,$t1);
  $inc117 = (($i$926) + 1)|0;
  $exitcond = ($inc117|0)==(50);
  if ($exitcond) {
   break;
  } else {
   $i$926 = $inc117;
  }
 }
 _fe_mul($t0,$t1,$t0);
 _fe_sq($t0,$t0);
 _fe_sq($t0,$t0);
 _fe_mul($out,$t0,$z);
 STACKTOP = sp;return;
}
function _fe_sq2($h,$f) {
 $h = $h|0;
 $f = $f|0;
 var $0 = 0, $1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0;
 var $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0;
 var $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0;
 var $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0;
 var $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0;
 var $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0;
 var $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0;
 var $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0;
 var $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0;
 var $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $278 = 0;
 var $279 = 0, $28 = 0, $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $285 = 0, $286 = 0, $287 = 0, $288 = 0, $289 = 0, $29 = 0, $290 = 0, $291 = 0, $292 = 0, $293 = 0, $294 = 0, $295 = 0, $296 = 0;
 var $297 = 0, $298 = 0, $299 = 0, $3 = 0, $30 = 0, $300 = 0, $301 = 0, $302 = 0, $303 = 0, $304 = 0, $305 = 0, $306 = 0, $307 = 0, $308 = 0, $309 = 0, $31 = 0, $310 = 0, $311 = 0, $312 = 0, $313 = 0;
 var $314 = 0, $315 = 0, $316 = 0, $317 = 0, $318 = 0, $319 = 0, $32 = 0, $320 = 0, $321 = 0, $322 = 0, $323 = 0, $324 = 0, $325 = 0, $326 = 0, $327 = 0, $328 = 0, $329 = 0, $33 = 0, $330 = 0, $331 = 0;
 var $332 = 0, $333 = 0, $334 = 0, $335 = 0, $336 = 0, $337 = 0, $338 = 0, $339 = 0, $34 = 0, $340 = 0, $341 = 0, $342 = 0, $343 = 0, $344 = 0, $345 = 0, $346 = 0, $347 = 0, $348 = 0, $349 = 0, $35 = 0;
 var $350 = 0, $351 = 0, $352 = 0, $353 = 0, $354 = 0, $355 = 0, $356 = 0, $357 = 0, $358 = 0, $359 = 0, $36 = 0, $360 = 0, $361 = 0, $362 = 0, $363 = 0, $364 = 0, $365 = 0, $366 = 0, $367 = 0, $368 = 0;
 var $369 = 0, $37 = 0, $370 = 0, $371 = 0, $372 = 0, $373 = 0, $374 = 0, $375 = 0, $376 = 0, $377 = 0, $378 = 0, $379 = 0, $38 = 0, $380 = 0, $381 = 0, $382 = 0, $383 = 0, $384 = 0, $385 = 0, $39 = 0;
 var $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0;
 var $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0;
 var $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0;
 var $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, $arrayidx1 = 0, $arrayidx2 = 0, $arrayidx3 = 0, $arrayidx301 = 0, $arrayidx303 = 0, $arrayidx305 = 0, $arrayidx307 = 0, $arrayidx309 = 0, $arrayidx311 = 0, $arrayidx313 = 0, $arrayidx315 = 0, $arrayidx317 = 0, $arrayidx4 = 0, $arrayidx5 = 0;
 var $arrayidx6 = 0, $arrayidx7 = 0, $arrayidx8 = 0, $arrayidx9 = 0, $mul = 0, $mul10 = 0, $mul11 = 0, $mul12 = 0, $mul13 = 0, $mul14 = 0, $mul15 = 0, $mul16 = 0, $mul17 = 0, $mul18 = 0, $mul19 = 0, $mul20 = 0, $mul21 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[$f>>2]|0;
 $arrayidx1 = ((($f)) + 4|0);
 $1 = HEAP32[$arrayidx1>>2]|0;
 $arrayidx2 = ((($f)) + 8|0);
 $2 = HEAP32[$arrayidx2>>2]|0;
 $arrayidx3 = ((($f)) + 12|0);
 $3 = HEAP32[$arrayidx3>>2]|0;
 $arrayidx4 = ((($f)) + 16|0);
 $4 = HEAP32[$arrayidx4>>2]|0;
 $arrayidx5 = ((($f)) + 20|0);
 $5 = HEAP32[$arrayidx5>>2]|0;
 $arrayidx6 = ((($f)) + 24|0);
 $6 = HEAP32[$arrayidx6>>2]|0;
 $arrayidx7 = ((($f)) + 28|0);
 $7 = HEAP32[$arrayidx7>>2]|0;
 $arrayidx8 = ((($f)) + 32|0);
 $8 = HEAP32[$arrayidx8>>2]|0;
 $arrayidx9 = ((($f)) + 36|0);
 $9 = HEAP32[$arrayidx9>>2]|0;
 $mul = $0 << 1;
 $mul10 = $1 << 1;
 $mul11 = $2 << 1;
 $mul12 = $3 << 1;
 $mul13 = $4 << 1;
 $mul14 = $5 << 1;
 $mul15 = $6 << 1;
 $mul16 = $7 << 1;
 $mul17 = ($5*38)|0;
 $mul18 = ($6*19)|0;
 $mul19 = ($7*38)|0;
 $mul20 = ($8*19)|0;
 $mul21 = ($9*38)|0;
 $10 = ($0|0)<(0);
 $11 = $10 << 31 >> 31;
 $12 = (___muldi3(($0|0),($11|0),($0|0),($11|0))|0);
 $13 = (getTempRet0() | 0);
 $14 = ($mul|0)<(0);
 $15 = $14 << 31 >> 31;
 $16 = ($1|0)<(0);
 $17 = $16 << 31 >> 31;
 $18 = (___muldi3(($mul|0),($15|0),($1|0),($17|0))|0);
 $19 = (getTempRet0() | 0);
 $20 = ($2|0)<(0);
 $21 = $20 << 31 >> 31;
 $22 = (___muldi3(($2|0),($21|0),($mul|0),($15|0))|0);
 $23 = (getTempRet0() | 0);
 $24 = ($3|0)<(0);
 $25 = $24 << 31 >> 31;
 $26 = (___muldi3(($3|0),($25|0),($mul|0),($15|0))|0);
 $27 = (getTempRet0() | 0);
 $28 = ($4|0)<(0);
 $29 = $28 << 31 >> 31;
 $30 = (___muldi3(($4|0),($29|0),($mul|0),($15|0))|0);
 $31 = (getTempRet0() | 0);
 $32 = ($5|0)<(0);
 $33 = $32 << 31 >> 31;
 $34 = (___muldi3(($5|0),($33|0),($mul|0),($15|0))|0);
 $35 = (getTempRet0() | 0);
 $36 = ($6|0)<(0);
 $37 = $36 << 31 >> 31;
 $38 = (___muldi3(($6|0),($37|0),($mul|0),($15|0))|0);
 $39 = (getTempRet0() | 0);
 $40 = ($7|0)<(0);
 $41 = $40 << 31 >> 31;
 $42 = (___muldi3(($7|0),($41|0),($mul|0),($15|0))|0);
 $43 = (getTempRet0() | 0);
 $44 = ($8|0)<(0);
 $45 = $44 << 31 >> 31;
 $46 = (___muldi3(($8|0),($45|0),($mul|0),($15|0))|0);
 $47 = (getTempRet0() | 0);
 $48 = ($9|0)<(0);
 $49 = $48 << 31 >> 31;
 $50 = (___muldi3(($9|0),($49|0),($mul|0),($15|0))|0);
 $51 = (getTempRet0() | 0);
 $52 = ($mul10|0)<(0);
 $53 = $52 << 31 >> 31;
 $54 = (___muldi3(($mul10|0),($53|0),($1|0),($17|0))|0);
 $55 = (getTempRet0() | 0);
 $56 = (___muldi3(($mul10|0),($53|0),($2|0),($21|0))|0);
 $57 = (getTempRet0() | 0);
 $58 = ($mul12|0)<(0);
 $59 = $58 << 31 >> 31;
 $60 = (___muldi3(($mul12|0),($59|0),($mul10|0),($53|0))|0);
 $61 = (getTempRet0() | 0);
 $62 = (___muldi3(($4|0),($29|0),($mul10|0),($53|0))|0);
 $63 = (getTempRet0() | 0);
 $64 = ($mul14|0)<(0);
 $65 = $64 << 31 >> 31;
 $66 = (___muldi3(($mul14|0),($65|0),($mul10|0),($53|0))|0);
 $67 = (getTempRet0() | 0);
 $68 = (___muldi3(($6|0),($37|0),($mul10|0),($53|0))|0);
 $69 = (getTempRet0() | 0);
 $70 = ($mul16|0)<(0);
 $71 = $70 << 31 >> 31;
 $72 = (___muldi3(($mul16|0),($71|0),($mul10|0),($53|0))|0);
 $73 = (getTempRet0() | 0);
 $74 = (___muldi3(($8|0),($45|0),($mul10|0),($53|0))|0);
 $75 = (getTempRet0() | 0);
 $76 = ($mul21|0)<(0);
 $77 = $76 << 31 >> 31;
 $78 = (___muldi3(($mul21|0),($77|0),($mul10|0),($53|0))|0);
 $79 = (getTempRet0() | 0);
 $80 = (___muldi3(($2|0),($21|0),($2|0),($21|0))|0);
 $81 = (getTempRet0() | 0);
 $82 = ($mul11|0)<(0);
 $83 = $82 << 31 >> 31;
 $84 = (___muldi3(($mul11|0),($83|0),($3|0),($25|0))|0);
 $85 = (getTempRet0() | 0);
 $86 = (___muldi3(($4|0),($29|0),($mul11|0),($83|0))|0);
 $87 = (getTempRet0() | 0);
 $88 = (___muldi3(($5|0),($33|0),($mul11|0),($83|0))|0);
 $89 = (getTempRet0() | 0);
 $90 = (___muldi3(($6|0),($37|0),($mul11|0),($83|0))|0);
 $91 = (getTempRet0() | 0);
 $92 = (___muldi3(($7|0),($41|0),($mul11|0),($83|0))|0);
 $93 = (getTempRet0() | 0);
 $94 = ($mul20|0)<(0);
 $95 = $94 << 31 >> 31;
 $96 = (___muldi3(($mul20|0),($95|0),($mul11|0),($83|0))|0);
 $97 = (getTempRet0() | 0);
 $98 = (___muldi3(($mul21|0),($77|0),($2|0),($21|0))|0);
 $99 = (getTempRet0() | 0);
 $100 = (___muldi3(($mul12|0),($59|0),($3|0),($25|0))|0);
 $101 = (getTempRet0() | 0);
 $102 = (___muldi3(($mul12|0),($59|0),($4|0),($29|0))|0);
 $103 = (getTempRet0() | 0);
 $104 = (___muldi3(($mul14|0),($65|0),($mul12|0),($59|0))|0);
 $105 = (getTempRet0() | 0);
 $106 = (___muldi3(($6|0),($37|0),($mul12|0),($59|0))|0);
 $107 = (getTempRet0() | 0);
 $108 = ($mul19|0)<(0);
 $109 = $108 << 31 >> 31;
 $110 = (___muldi3(($mul19|0),($109|0),($mul12|0),($59|0))|0);
 $111 = (getTempRet0() | 0);
 $112 = (___muldi3(($mul20|0),($95|0),($mul12|0),($59|0))|0);
 $113 = (getTempRet0() | 0);
 $114 = (___muldi3(($mul21|0),($77|0),($mul12|0),($59|0))|0);
 $115 = (getTempRet0() | 0);
 $116 = (___muldi3(($4|0),($29|0),($4|0),($29|0))|0);
 $117 = (getTempRet0() | 0);
 $118 = ($mul13|0)<(0);
 $119 = $118 << 31 >> 31;
 $120 = (___muldi3(($mul13|0),($119|0),($5|0),($33|0))|0);
 $121 = (getTempRet0() | 0);
 $122 = ($mul18|0)<(0);
 $123 = $122 << 31 >> 31;
 $124 = (___muldi3(($mul18|0),($123|0),($mul13|0),($119|0))|0);
 $125 = (getTempRet0() | 0);
 $126 = (___muldi3(($mul19|0),($109|0),($4|0),($29|0))|0);
 $127 = (getTempRet0() | 0);
 $128 = (___muldi3(($mul20|0),($95|0),($mul13|0),($119|0))|0);
 $129 = (getTempRet0() | 0);
 $130 = (___muldi3(($mul21|0),($77|0),($4|0),($29|0))|0);
 $131 = (getTempRet0() | 0);
 $132 = ($mul17|0)<(0);
 $133 = $132 << 31 >> 31;
 $134 = (___muldi3(($mul17|0),($133|0),($5|0),($33|0))|0);
 $135 = (getTempRet0() | 0);
 $136 = (___muldi3(($mul18|0),($123|0),($mul14|0),($65|0))|0);
 $137 = (getTempRet0() | 0);
 $138 = (___muldi3(($mul19|0),($109|0),($mul14|0),($65|0))|0);
 $139 = (getTempRet0() | 0);
 $140 = (___muldi3(($mul20|0),($95|0),($mul14|0),($65|0))|0);
 $141 = (getTempRet0() | 0);
 $142 = (___muldi3(($mul21|0),($77|0),($mul14|0),($65|0))|0);
 $143 = (getTempRet0() | 0);
 $144 = (___muldi3(($mul18|0),($123|0),($6|0),($37|0))|0);
 $145 = (getTempRet0() | 0);
 $146 = (___muldi3(($mul19|0),($109|0),($6|0),($37|0))|0);
 $147 = (getTempRet0() | 0);
 $148 = ($mul15|0)<(0);
 $149 = $148 << 31 >> 31;
 $150 = (___muldi3(($mul20|0),($95|0),($mul15|0),($149|0))|0);
 $151 = (getTempRet0() | 0);
 $152 = (___muldi3(($mul21|0),($77|0),($6|0),($37|0))|0);
 $153 = (getTempRet0() | 0);
 $154 = (___muldi3(($mul19|0),($109|0),($7|0),($41|0))|0);
 $155 = (getTempRet0() | 0);
 $156 = (___muldi3(($mul20|0),($95|0),($mul16|0),($71|0))|0);
 $157 = (getTempRet0() | 0);
 $158 = (___muldi3(($mul21|0),($77|0),($mul16|0),($71|0))|0);
 $159 = (getTempRet0() | 0);
 $160 = (___muldi3(($mul20|0),($95|0),($8|0),($45|0))|0);
 $161 = (getTempRet0() | 0);
 $162 = (___muldi3(($mul21|0),($77|0),($8|0),($45|0))|0);
 $163 = (getTempRet0() | 0);
 $164 = (___muldi3(($mul21|0),($77|0),($9|0),($49|0))|0);
 $165 = (getTempRet0() | 0);
 $166 = (_i64Add(($134|0),($135|0),($12|0),($13|0))|0);
 $167 = (getTempRet0() | 0);
 $168 = (_i64Add(($166|0),($167|0),($124|0),($125|0))|0);
 $169 = (getTempRet0() | 0);
 $170 = (_i64Add(($168|0),($169|0),($110|0),($111|0))|0);
 $171 = (getTempRet0() | 0);
 $172 = (_i64Add(($170|0),($171|0),($96|0),($97|0))|0);
 $173 = (getTempRet0() | 0);
 $174 = (_i64Add(($172|0),($173|0),($78|0),($79|0))|0);
 $175 = (getTempRet0() | 0);
 $176 = (_i64Add(($136|0),($137|0),($18|0),($19|0))|0);
 $177 = (getTempRet0() | 0);
 $178 = (_i64Add(($176|0),($177|0),($126|0),($127|0))|0);
 $179 = (getTempRet0() | 0);
 $180 = (_i64Add(($178|0),($179|0),($112|0),($113|0))|0);
 $181 = (getTempRet0() | 0);
 $182 = (_i64Add(($180|0),($181|0),($98|0),($99|0))|0);
 $183 = (getTempRet0() | 0);
 $184 = (_i64Add(($22|0),($23|0),($54|0),($55|0))|0);
 $185 = (getTempRet0() | 0);
 $186 = (_i64Add(($184|0),($185|0),($144|0),($145|0))|0);
 $187 = (getTempRet0() | 0);
 $188 = (_i64Add(($186|0),($187|0),($138|0),($139|0))|0);
 $189 = (getTempRet0() | 0);
 $190 = (_i64Add(($188|0),($189|0),($128|0),($129|0))|0);
 $191 = (getTempRet0() | 0);
 $192 = (_i64Add(($190|0),($191|0),($114|0),($115|0))|0);
 $193 = (getTempRet0() | 0);
 $194 = (_i64Add(($26|0),($27|0),($56|0),($57|0))|0);
 $195 = (getTempRet0() | 0);
 $196 = (_i64Add(($194|0),($195|0),($146|0),($147|0))|0);
 $197 = (getTempRet0() | 0);
 $198 = (_i64Add(($196|0),($197|0),($140|0),($141|0))|0);
 $199 = (getTempRet0() | 0);
 $200 = (_i64Add(($198|0),($199|0),($130|0),($131|0))|0);
 $201 = (getTempRet0() | 0);
 $202 = (_i64Add(($60|0),($61|0),($80|0),($81|0))|0);
 $203 = (getTempRet0() | 0);
 $204 = (_i64Add(($202|0),($203|0),($30|0),($31|0))|0);
 $205 = (getTempRet0() | 0);
 $206 = (_i64Add(($204|0),($205|0),($154|0),($155|0))|0);
 $207 = (getTempRet0() | 0);
 $208 = (_i64Add(($206|0),($207|0),($150|0),($151|0))|0);
 $209 = (getTempRet0() | 0);
 $210 = (_i64Add(($208|0),($209|0),($142|0),($143|0))|0);
 $211 = (getTempRet0() | 0);
 $212 = (_i64Add(($62|0),($63|0),($84|0),($85|0))|0);
 $213 = (getTempRet0() | 0);
 $214 = (_i64Add(($212|0),($213|0),($34|0),($35|0))|0);
 $215 = (getTempRet0() | 0);
 $216 = (_i64Add(($214|0),($215|0),($156|0),($157|0))|0);
 $217 = (getTempRet0() | 0);
 $218 = (_i64Add(($216|0),($217|0),($152|0),($153|0))|0);
 $219 = (getTempRet0() | 0);
 $220 = (_i64Add(($100|0),($101|0),($86|0),($87|0))|0);
 $221 = (getTempRet0() | 0);
 $222 = (_i64Add(($220|0),($221|0),($66|0),($67|0))|0);
 $223 = (getTempRet0() | 0);
 $224 = (_i64Add(($222|0),($223|0),($38|0),($39|0))|0);
 $225 = (getTempRet0() | 0);
 $226 = (_i64Add(($224|0),($225|0),($160|0),($161|0))|0);
 $227 = (getTempRet0() | 0);
 $228 = (_i64Add(($226|0),($227|0),($158|0),($159|0))|0);
 $229 = (getTempRet0() | 0);
 $230 = (_i64Add(($88|0),($89|0),($102|0),($103|0))|0);
 $231 = (getTempRet0() | 0);
 $232 = (_i64Add(($230|0),($231|0),($68|0),($69|0))|0);
 $233 = (getTempRet0() | 0);
 $234 = (_i64Add(($232|0),($233|0),($42|0),($43|0))|0);
 $235 = (getTempRet0() | 0);
 $236 = (_i64Add(($234|0),($235|0),($162|0),($163|0))|0);
 $237 = (getTempRet0() | 0);
 $238 = (_i64Add(($90|0),($91|0),($116|0),($117|0))|0);
 $239 = (getTempRet0() | 0);
 $240 = (_i64Add(($238|0),($239|0),($104|0),($105|0))|0);
 $241 = (getTempRet0() | 0);
 $242 = (_i64Add(($240|0),($241|0),($72|0),($73|0))|0);
 $243 = (getTempRet0() | 0);
 $244 = (_i64Add(($242|0),($243|0),($46|0),($47|0))|0);
 $245 = (getTempRet0() | 0);
 $246 = (_i64Add(($244|0),($245|0),($164|0),($165|0))|0);
 $247 = (getTempRet0() | 0);
 $248 = (_i64Add(($106|0),($107|0),($120|0),($121|0))|0);
 $249 = (getTempRet0() | 0);
 $250 = (_i64Add(($248|0),($249|0),($92|0),($93|0))|0);
 $251 = (getTempRet0() | 0);
 $252 = (_i64Add(($250|0),($251|0),($74|0),($75|0))|0);
 $253 = (getTempRet0() | 0);
 $254 = (_i64Add(($252|0),($253|0),($50|0),($51|0))|0);
 $255 = (getTempRet0() | 0);
 $256 = (_bitshift64Shl(($174|0),($175|0),1)|0);
 $257 = (getTempRet0() | 0);
 $258 = (_bitshift64Shl(($182|0),($183|0),1)|0);
 $259 = (getTempRet0() | 0);
 $260 = (_bitshift64Shl(($192|0),($193|0),1)|0);
 $261 = (getTempRet0() | 0);
 $262 = (_bitshift64Shl(($200|0),($201|0),1)|0);
 $263 = (getTempRet0() | 0);
 $264 = (_bitshift64Shl(($210|0),($211|0),1)|0);
 $265 = (getTempRet0() | 0);
 $266 = (_bitshift64Shl(($218|0),($219|0),1)|0);
 $267 = (getTempRet0() | 0);
 $268 = (_bitshift64Shl(($228|0),($229|0),1)|0);
 $269 = (getTempRet0() | 0);
 $270 = (_bitshift64Shl(($236|0),($237|0),1)|0);
 $271 = (getTempRet0() | 0);
 $272 = (_bitshift64Shl(($246|0),($247|0),1)|0);
 $273 = (getTempRet0() | 0);
 $274 = (_bitshift64Shl(($254|0),($255|0),1)|0);
 $275 = (getTempRet0() | 0);
 $276 = (_i64Add(($256|0),($257|0),33554432,0)|0);
 $277 = (getTempRet0() | 0);
 $278 = (_bitshift64Ashr(($276|0),($277|0),26)|0);
 $279 = (getTempRet0() | 0);
 $280 = (_i64Add(($278|0),($279|0),($258|0),($259|0))|0);
 $281 = (getTempRet0() | 0);
 $282 = $276 & -67108864;
 $283 = (_i64Subtract(($256|0),($257|0),($282|0),($277|0))|0);
 $284 = (getTempRet0() | 0);
 $285 = (_i64Add(($264|0),($265|0),33554432,0)|0);
 $286 = (getTempRet0() | 0);
 $287 = (_bitshift64Ashr(($285|0),($286|0),26)|0);
 $288 = (getTempRet0() | 0);
 $289 = (_i64Add(($287|0),($288|0),($266|0),($267|0))|0);
 $290 = (getTempRet0() | 0);
 $291 = $285 & -67108864;
 $292 = (_i64Subtract(($264|0),($265|0),($291|0),($286|0))|0);
 $293 = (getTempRet0() | 0);
 $294 = (_i64Add(($280|0),($281|0),16777216,0)|0);
 $295 = (getTempRet0() | 0);
 $296 = (_bitshift64Ashr(($294|0),($295|0),25)|0);
 $297 = (getTempRet0() | 0);
 $298 = (_i64Add(($296|0),($297|0),($260|0),($261|0))|0);
 $299 = (getTempRet0() | 0);
 $300 = $294 & -33554432;
 $301 = (_i64Subtract(($280|0),($281|0),($300|0),0)|0);
 $302 = (getTempRet0() | 0);
 $303 = (_i64Add(($289|0),($290|0),16777216,0)|0);
 $304 = (getTempRet0() | 0);
 $305 = (_bitshift64Ashr(($303|0),($304|0),25)|0);
 $306 = (getTempRet0() | 0);
 $307 = (_i64Add(($305|0),($306|0),($268|0),($269|0))|0);
 $308 = (getTempRet0() | 0);
 $309 = $303 & -33554432;
 $310 = (_i64Subtract(($289|0),($290|0),($309|0),0)|0);
 $311 = (getTempRet0() | 0);
 $312 = (_i64Add(($298|0),($299|0),33554432,0)|0);
 $313 = (getTempRet0() | 0);
 $314 = (_bitshift64Ashr(($312|0),($313|0),26)|0);
 $315 = (getTempRet0() | 0);
 $316 = (_i64Add(($314|0),($315|0),($262|0),($263|0))|0);
 $317 = (getTempRet0() | 0);
 $318 = $312 & -67108864;
 $319 = (_i64Subtract(($298|0),($299|0),($318|0),0)|0);
 $320 = (getTempRet0() | 0);
 $321 = (_i64Add(($307|0),($308|0),33554432,0)|0);
 $322 = (getTempRet0() | 0);
 $323 = (_bitshift64Ashr(($321|0),($322|0),26)|0);
 $324 = (getTempRet0() | 0);
 $325 = (_i64Add(($323|0),($324|0),($270|0),($271|0))|0);
 $326 = (getTempRet0() | 0);
 $327 = $321 & -67108864;
 $328 = (_i64Subtract(($307|0),($308|0),($327|0),0)|0);
 $329 = (getTempRet0() | 0);
 $330 = (_i64Add(($316|0),($317|0),16777216,0)|0);
 $331 = (getTempRet0() | 0);
 $332 = (_bitshift64Ashr(($330|0),($331|0),25)|0);
 $333 = (getTempRet0() | 0);
 $334 = (_i64Add(($332|0),($333|0),($292|0),($293|0))|0);
 $335 = (getTempRet0() | 0);
 $336 = $330 & -33554432;
 $337 = (_i64Subtract(($316|0),($317|0),($336|0),0)|0);
 $338 = (getTempRet0() | 0);
 $339 = (_i64Add(($325|0),($326|0),16777216,0)|0);
 $340 = (getTempRet0() | 0);
 $341 = (_bitshift64Ashr(($339|0),($340|0),25)|0);
 $342 = (getTempRet0() | 0);
 $343 = (_i64Add(($341|0),($342|0),($272|0),($273|0))|0);
 $344 = (getTempRet0() | 0);
 $345 = $339 & -33554432;
 $346 = (_i64Subtract(($325|0),($326|0),($345|0),0)|0);
 $347 = (getTempRet0() | 0);
 $348 = (_i64Add(($334|0),($335|0),33554432,0)|0);
 $349 = (getTempRet0() | 0);
 $350 = (_bitshift64Lshr(($348|0),($349|0),26)|0);
 $351 = (getTempRet0() | 0);
 $352 = (_i64Add(($310|0),($311|0),($350|0),($351|0))|0);
 $353 = (getTempRet0() | 0);
 $354 = $348 & -67108864;
 $355 = (_i64Subtract(($334|0),($335|0),($354|0),0)|0);
 $356 = (getTempRet0() | 0);
 $357 = (_i64Add(($343|0),($344|0),33554432,0)|0);
 $358 = (getTempRet0() | 0);
 $359 = (_bitshift64Ashr(($357|0),($358|0),26)|0);
 $360 = (getTempRet0() | 0);
 $361 = (_i64Add(($359|0),($360|0),($274|0),($275|0))|0);
 $362 = (getTempRet0() | 0);
 $363 = $357 & -67108864;
 $364 = (_i64Subtract(($343|0),($344|0),($363|0),0)|0);
 $365 = (getTempRet0() | 0);
 $366 = (_i64Add(($361|0),($362|0),16777216,0)|0);
 $367 = (getTempRet0() | 0);
 $368 = (_bitshift64Ashr(($366|0),($367|0),25)|0);
 $369 = (getTempRet0() | 0);
 $370 = (___muldi3(($368|0),($369|0),19,0)|0);
 $371 = (getTempRet0() | 0);
 $372 = (_i64Add(($370|0),($371|0),($283|0),($284|0))|0);
 $373 = (getTempRet0() | 0);
 $374 = $366 & -33554432;
 $375 = (_i64Subtract(($361|0),($362|0),($374|0),0)|0);
 $376 = (getTempRet0() | 0);
 $377 = (_i64Add(($372|0),($373|0),33554432,0)|0);
 $378 = (getTempRet0() | 0);
 $379 = (_bitshift64Lshr(($377|0),($378|0),26)|0);
 $380 = (getTempRet0() | 0);
 $381 = (_i64Add(($301|0),($302|0),($379|0),($380|0))|0);
 $382 = (getTempRet0() | 0);
 $383 = $377 & -67108864;
 $384 = (_i64Subtract(($372|0),($373|0),($383|0),0)|0);
 $385 = (getTempRet0() | 0);
 HEAP32[$h>>2] = $384;
 $arrayidx301 = ((($h)) + 4|0);
 HEAP32[$arrayidx301>>2] = $381;
 $arrayidx303 = ((($h)) + 8|0);
 HEAP32[$arrayidx303>>2] = $319;
 $arrayidx305 = ((($h)) + 12|0);
 HEAP32[$arrayidx305>>2] = $337;
 $arrayidx307 = ((($h)) + 16|0);
 HEAP32[$arrayidx307>>2] = $355;
 $arrayidx309 = ((($h)) + 20|0);
 HEAP32[$arrayidx309>>2] = $352;
 $arrayidx311 = ((($h)) + 24|0);
 HEAP32[$arrayidx311>>2] = $328;
 $arrayidx313 = ((($h)) + 28|0);
 HEAP32[$arrayidx313>>2] = $346;
 $arrayidx315 = ((($h)) + 32|0);
 HEAP32[$arrayidx315>>2] = $364;
 $arrayidx317 = ((($h)) + 36|0);
 HEAP32[$arrayidx317>>2] = $375;
 return;
}
function _fe_sub($h,$f,$g) {
 $h = $h|0;
 $f = $f|0;
 $g = $g|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0;
 var $arrayidx1 = 0, $arrayidx11 = 0, $arrayidx12 = 0, $arrayidx13 = 0, $arrayidx14 = 0, $arrayidx15 = 0, $arrayidx16 = 0, $arrayidx17 = 0, $arrayidx18 = 0, $arrayidx19 = 0, $arrayidx2 = 0, $arrayidx3 = 0, $arrayidx30 = 0, $arrayidx31 = 0, $arrayidx32 = 0, $arrayidx33 = 0, $arrayidx34 = 0, $arrayidx35 = 0, $arrayidx36 = 0, $arrayidx37 = 0;
 var $arrayidx38 = 0, $arrayidx4 = 0, $arrayidx5 = 0, $arrayidx6 = 0, $arrayidx7 = 0, $arrayidx8 = 0, $arrayidx9 = 0, $sub = 0, $sub20 = 0, $sub21 = 0, $sub22 = 0, $sub23 = 0, $sub24 = 0, $sub25 = 0, $sub26 = 0, $sub27 = 0, $sub28 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP32[$f>>2]|0;
 $arrayidx1 = ((($f)) + 4|0);
 $1 = HEAP32[$arrayidx1>>2]|0;
 $arrayidx2 = ((($f)) + 8|0);
 $2 = HEAP32[$arrayidx2>>2]|0;
 $arrayidx3 = ((($f)) + 12|0);
 $3 = HEAP32[$arrayidx3>>2]|0;
 $arrayidx4 = ((($f)) + 16|0);
 $4 = HEAP32[$arrayidx4>>2]|0;
 $arrayidx5 = ((($f)) + 20|0);
 $5 = HEAP32[$arrayidx5>>2]|0;
 $arrayidx6 = ((($f)) + 24|0);
 $6 = HEAP32[$arrayidx6>>2]|0;
 $arrayidx7 = ((($f)) + 28|0);
 $7 = HEAP32[$arrayidx7>>2]|0;
 $arrayidx8 = ((($f)) + 32|0);
 $8 = HEAP32[$arrayidx8>>2]|0;
 $arrayidx9 = ((($f)) + 36|0);
 $9 = HEAP32[$arrayidx9>>2]|0;
 $10 = HEAP32[$g>>2]|0;
 $arrayidx11 = ((($g)) + 4|0);
 $11 = HEAP32[$arrayidx11>>2]|0;
 $arrayidx12 = ((($g)) + 8|0);
 $12 = HEAP32[$arrayidx12>>2]|0;
 $arrayidx13 = ((($g)) + 12|0);
 $13 = HEAP32[$arrayidx13>>2]|0;
 $arrayidx14 = ((($g)) + 16|0);
 $14 = HEAP32[$arrayidx14>>2]|0;
 $arrayidx15 = ((($g)) + 20|0);
 $15 = HEAP32[$arrayidx15>>2]|0;
 $arrayidx16 = ((($g)) + 24|0);
 $16 = HEAP32[$arrayidx16>>2]|0;
 $arrayidx17 = ((($g)) + 28|0);
 $17 = HEAP32[$arrayidx17>>2]|0;
 $arrayidx18 = ((($g)) + 32|0);
 $18 = HEAP32[$arrayidx18>>2]|0;
 $arrayidx19 = ((($g)) + 36|0);
 $19 = HEAP32[$arrayidx19>>2]|0;
 $sub = (($0) - ($10))|0;
 $sub20 = (($1) - ($11))|0;
 $sub21 = (($2) - ($12))|0;
 $sub22 = (($3) - ($13))|0;
 $sub23 = (($4) - ($14))|0;
 $sub24 = (($5) - ($15))|0;
 $sub25 = (($6) - ($16))|0;
 $sub26 = (($7) - ($17))|0;
 $sub27 = (($8) - ($18))|0;
 $sub28 = (($9) - ($19))|0;
 HEAP32[$h>>2] = $sub;
 $arrayidx30 = ((($h)) + 4|0);
 HEAP32[$arrayidx30>>2] = $sub20;
 $arrayidx31 = ((($h)) + 8|0);
 HEAP32[$arrayidx31>>2] = $sub21;
 $arrayidx32 = ((($h)) + 12|0);
 HEAP32[$arrayidx32>>2] = $sub22;
 $arrayidx33 = ((($h)) + 16|0);
 HEAP32[$arrayidx33>>2] = $sub23;
 $arrayidx34 = ((($h)) + 20|0);
 HEAP32[$arrayidx34>>2] = $sub24;
 $arrayidx35 = ((($h)) + 24|0);
 HEAP32[$arrayidx35>>2] = $sub25;
 $arrayidx36 = ((($h)) + 28|0);
 HEAP32[$arrayidx36>>2] = $sub26;
 $arrayidx37 = ((($h)) + 32|0);
 HEAP32[$arrayidx37>>2] = $sub27;
 $arrayidx38 = ((($h)) + 36|0);
 HEAP32[$arrayidx38>>2] = $sub28;
 return;
}
function _ge_add($r,$p,$q) {
 $r = $r|0;
 $p = $p|0;
 $q = $q|0;
 var $arraydecay1 = 0, $arraydecay10 = 0, $arraydecay18 = 0, $arraydecay19 = 0, $arraydecay20 = 0, $arraydecay22 = 0, $arraydecay26 = 0, $arraydecay28 = 0, $arraydecay5 = 0, $t0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 48|0;
 $t0 = sp;
 $arraydecay1 = ((($p)) + 40|0);
 _fe_add($r,$arraydecay1,$p);
 $arraydecay5 = ((($r)) + 40|0);
 _fe_sub($arraydecay5,$arraydecay1,$p);
 $arraydecay10 = ((($r)) + 80|0);
 _fe_mul($arraydecay10,$r,$q);
 $arraydecay18 = ((($q)) + 40|0);
 _fe_mul($arraydecay5,$arraydecay5,$arraydecay18);
 $arraydecay19 = ((($r)) + 120|0);
 $arraydecay20 = ((($q)) + 120|0);
 $arraydecay22 = ((($p)) + 120|0);
 _fe_mul($arraydecay19,$arraydecay20,$arraydecay22);
 $arraydecay26 = ((($p)) + 80|0);
 $arraydecay28 = ((($q)) + 80|0);
 _fe_mul($r,$arraydecay26,$arraydecay28);
 _fe_add($t0,$r,$r);
 _fe_sub($r,$arraydecay10,$arraydecay5);
 _fe_add($arraydecay5,$arraydecay10,$arraydecay5);
 _fe_add($arraydecay10,$t0,$arraydecay19);
 _fe_sub($arraydecay19,$t0,$arraydecay19);
 STACKTOP = sp;return;
}
function _ge_double_scalarmult_vartime($r,$a,$A,$b) {
 $r = $r|0;
 $a = $a|0;
 $A = $A|0;
 $b = $b|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $A2 = 0, $Ai = 0, $arrayidx11 = 0, $arrayidx13 = 0, $arrayidx15 = 0, $arrayidx16 = 0, $arrayidx17 = 0, $arrayidx24 = 0, $arrayidx3 = 0, $arrayidx31 = 0;
 var $arrayidx40 = 0, $arrayidx43 = 0, $arrayidx5 = 0, $arrayidx51 = 0, $arrayidx62 = 0, $arrayidx7 = 0, $arrayidx9 = 0, $aslide = 0, $bslide = 0, $cmp = 0, $cmp21 = 0, $cmp2118 = 0, $cmp26 = 0, $cmp34 = 0, $cmp45 = 0, $cmp55 = 0, $dec = 0, $dec66 = 0, $div39 = 0, $div61 = 0;
 var $i$020 = 0, $i$119 = 0, $t = 0, $tobool = 0, $tobool19 = 0, $u = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 2272|0;
 $aslide = sp + 1536|0;
 $bslide = sp + 1280|0;
 $Ai = sp;
 $t = sp + 2112|0;
 $u = sp + 1952|0;
 $A2 = sp + 1792|0;
 _slide($aslide,$a);
 _slide($bslide,$b);
 _ge_p3_to_cached($Ai,$A);
 _ge_p3_dbl($t,$A);
 _ge_p1p1_to_p3($A2,$t);
 _ge_add($t,$A2,$Ai);
 _ge_p1p1_to_p3($u,$t);
 $arrayidx3 = ((($Ai)) + 160|0);
 _ge_p3_to_cached($arrayidx3,$u);
 _ge_add($t,$A2,$arrayidx3);
 _ge_p1p1_to_p3($u,$t);
 $arrayidx5 = ((($Ai)) + 320|0);
 _ge_p3_to_cached($arrayidx5,$u);
 _ge_add($t,$A2,$arrayidx5);
 _ge_p1p1_to_p3($u,$t);
 $arrayidx7 = ((($Ai)) + 480|0);
 _ge_p3_to_cached($arrayidx7,$u);
 _ge_add($t,$A2,$arrayidx7);
 _ge_p1p1_to_p3($u,$t);
 $arrayidx9 = ((($Ai)) + 640|0);
 _ge_p3_to_cached($arrayidx9,$u);
 _ge_add($t,$A2,$arrayidx9);
 _ge_p1p1_to_p3($u,$t);
 $arrayidx11 = ((($Ai)) + 800|0);
 _ge_p3_to_cached($arrayidx11,$u);
 _ge_add($t,$A2,$arrayidx11);
 _ge_p1p1_to_p3($u,$t);
 $arrayidx13 = ((($Ai)) + 960|0);
 _ge_p3_to_cached($arrayidx13,$u);
 _ge_add($t,$A2,$arrayidx13);
 _ge_p1p1_to_p3($u,$t);
 $arrayidx15 = ((($Ai)) + 1120|0);
 _ge_p3_to_cached($arrayidx15,$u);
 _ge_p2_0($r);
 $i$020 = 255;
 while(1) {
  $arrayidx16 = (($aslide) + ($i$020)|0);
  $0 = HEAP8[$arrayidx16>>0]|0;
  $tobool = ($0<<24>>24)==(0);
  if (!($tobool)) {
   break;
  }
  $arrayidx17 = (($bslide) + ($i$020)|0);
  $1 = HEAP8[$arrayidx17>>0]|0;
  $tobool19 = ($1<<24>>24)==(0);
  if (!($tobool19)) {
   break;
  }
  $dec = (($i$020) + -1)|0;
  $cmp = ($i$020|0)==(0);
  if ($cmp) {
   label = 16;
   break;
  } else {
   $i$020 = $dec;
  }
 }
 if ((label|0) == 16) {
  STACKTOP = sp;return;
 }
 $cmp2118 = ($i$020|0)>(-1);
 if (!($cmp2118)) {
  STACKTOP = sp;return;
 }
 $i$119 = $i$020;
 while(1) {
  _ge_p2_dbl($t,$r);
  $arrayidx24 = (($aslide) + ($i$119)|0);
  $2 = HEAP8[$arrayidx24>>0]|0;
  $cmp26 = ($2<<24>>24)>(0);
  if ($cmp26) {
   _ge_p1p1_to_p3($u,$t);
   $3 = ($2&255) >>> 1;
   $4 = $3&255;
   $arrayidx31 = (($Ai) + (($4*160)|0)|0);
   _ge_add($t,$u,$arrayidx31);
  } else {
   $cmp34 = ($2<<24>>24)<(0);
   if ($cmp34) {
    _ge_p1p1_to_p3($u,$t);
    $5 = (($2<<24>>24) / -2)&-1;
    $div39 = $5 << 24 >> 24;
    $arrayidx40 = (($Ai) + (($div39*160)|0)|0);
    _ge_sub($t,$u,$arrayidx40);
   }
  }
  $arrayidx43 = (($bslide) + ($i$119)|0);
  $6 = HEAP8[$arrayidx43>>0]|0;
  $cmp45 = ($6<<24>>24)>(0);
  if ($cmp45) {
   _ge_p1p1_to_p3($u,$t);
   $7 = ($6&255) >>> 1;
   $8 = $7&255;
   $arrayidx51 = (16 + (($8*120)|0)|0);
   _ge_madd($t,$u,$arrayidx51);
  } else {
   $cmp55 = ($6<<24>>24)<(0);
   if ($cmp55) {
    _ge_p1p1_to_p3($u,$t);
    $9 = (($6<<24>>24) / -2)&-1;
    $div61 = $9 << 24 >> 24;
    $arrayidx62 = (16 + (($div61*120)|0)|0);
    _ge_msub($t,$u,$arrayidx62);
   }
  }
  _ge_p1p1_to_p2($r,$t);
  $dec66 = (($i$119) + -1)|0;
  $cmp21 = ($i$119|0)>(0);
  if ($cmp21) {
   $i$119 = $dec66;
  } else {
   break;
  }
 }
 STACKTOP = sp;return;
}
function _slide($r,$a) {
 $r = $r|0;
 $a = $a|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $add = 0, $add25 = 0, $and = 0, $and2 = 0, $arrayidx = 0, $arrayidx17 = 0, $arrayidx4 = 0, $arrayidx61 = 0, $arrayidx9 = 0, $b$052 = 0, $cmp11 = 0, $cmp13 = 0, $cmp26 = 0, $cmp45 = 0;
 var $cmp58 = 0, $conv = 0, $conv21 = 0, $conv24 = 0, $conv3 = 0, $conv36 = 0, $conv55 = 0, $exitcond = 0, $exitcond58 = 0, $i$056 = 0, $i$153 = 0, $inc = 0, $inc67 = 0, $inc74 = 0, $inc78 = 0, $k$051 = 0, $shl = 0, $shr1 = 0, $sub = 0, $tobool = 0;
 var $tobool18 = 0, $tobool62 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $i$056 = 0;
 while(1) {
  $0 = $i$056 >>> 3;
  $arrayidx = (($a) + ($0)|0);
  $1 = HEAP8[$arrayidx>>0]|0;
  $conv = $1&255;
  $and = $i$056 & 7;
  $shr1 = $conv >>> $and;
  $and2 = $shr1 & 1;
  $conv3 = $and2&255;
  $arrayidx4 = (($r) + ($i$056)|0);
  HEAP8[$arrayidx4>>0] = $conv3;
  $inc = (($i$056) + 1)|0;
  $exitcond58 = ($inc|0)==(256);
  if ($exitcond58) {
   break;
  } else {
   $i$056 = $inc;
  }
 }
 $i$153 = 0;
 while(1) {
  $arrayidx9 = (($r) + ($i$153)|0);
  $2 = HEAP8[$arrayidx9>>0]|0;
  $tobool = ($2<<24>>24)==(0);
  L6: do {
   if (!($tobool)) {
    $b$052 = 1;
    while(1) {
     $add = (($b$052) + ($i$153))|0;
     $cmp13 = ($add>>>0)<(256);
     if (!($cmp13)) {
      break L6;
     }
     $arrayidx17 = (($r) + ($add)|0);
     $3 = HEAP8[$arrayidx17>>0]|0;
     $tobool18 = ($3<<24>>24)==(0);
     L11: do {
      if (!($tobool18)) {
       $4 = HEAP8[$arrayidx9>>0]|0;
       $conv21 = $4 << 24 >> 24;
       $conv24 = $3 << 24 >> 24;
       $shl = $conv24 << $b$052;
       $add25 = (($shl) + ($conv21))|0;
       $cmp26 = ($add25|0)<(16);
       if ($cmp26) {
        $conv36 = $add25&255;
        HEAP8[$arrayidx9>>0] = $conv36;
        HEAP8[$arrayidx17>>0] = 0;
        break;
       }
       $sub = (($conv21) - ($shl))|0;
       $cmp45 = ($sub|0)>(-16);
       if (!($cmp45)) {
        break L6;
       }
       $conv55 = $sub&255;
       HEAP8[$arrayidx9>>0] = $conv55;
       $k$051 = $add;
       while(1) {
        $arrayidx61 = (($r) + ($k$051)|0);
        $5 = HEAP8[$arrayidx61>>0]|0;
        $tobool62 = ($5<<24>>24)==(0);
        if ($tobool62) {
         break;
        }
        HEAP8[$arrayidx61>>0] = 0;
        $inc67 = (($k$051) + 1)|0;
        $cmp58 = ($k$051>>>0)<(255);
        if ($cmp58) {
         $k$051 = $inc67;
        } else {
         break L11;
        }
       }
       HEAP8[$arrayidx61>>0] = 1;
      }
     } while(0);
     $inc74 = (($b$052) + 1)|0;
     $cmp11 = ($inc74>>>0)<(7);
     if ($cmp11) {
      $b$052 = $inc74;
     } else {
      break;
     }
    }
   }
  } while(0);
  $inc78 = (($i$153) + 1)|0;
  $exitcond = ($inc78|0)==(256);
  if ($exitcond) {
   break;
  } else {
   $i$153 = $inc78;
  }
 }
 return;
}
function _ge_p3_to_cached($r,$p) {
 $r = $r|0;
 $p = $p|0;
 var $arraydecay1 = 0, $arraydecay10 = 0, $arraydecay11 = 0, $arraydecay12 = 0, $arraydecay3 = 0, $arraydecay8 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $arraydecay1 = ((($p)) + 40|0);
 _fe_add($r,$arraydecay1,$p);
 $arraydecay3 = ((($r)) + 40|0);
 _fe_sub($arraydecay3,$arraydecay1,$p);
 $arraydecay8 = ((($r)) + 80|0);
 $arraydecay10 = ((($p)) + 80|0);
 _fe_copy($arraydecay8,$arraydecay10);
 $arraydecay11 = ((($r)) + 120|0);
 $arraydecay12 = ((($p)) + 120|0);
 _fe_mul($arraydecay11,$arraydecay12,976);
 return;
}
function _ge_p3_dbl($r,$p) {
 $r = $r|0;
 $p = $p|0;
 var $q = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 128|0;
 $q = sp;
 _ge_p3_to_p2($q,$p);
 _ge_p2_dbl($r,$q);
 STACKTOP = sp;return;
}
function _ge_p1p1_to_p3($r,$p) {
 $r = $r|0;
 $p = $p|0;
 var $arraydecay15 = 0, $arraydecay3 = 0, $arraydecay4 = 0, $arraydecay6 = 0, $arraydecay7 = 0, $arraydecay9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $arraydecay3 = ((($p)) + 120|0);
 _fe_mul($r,$p,$arraydecay3);
 $arraydecay4 = ((($r)) + 40|0);
 $arraydecay6 = ((($p)) + 40|0);
 $arraydecay7 = ((($p)) + 80|0);
 _fe_mul($arraydecay4,$arraydecay6,$arraydecay7);
 $arraydecay9 = ((($r)) + 80|0);
 _fe_mul($arraydecay9,$arraydecay7,$arraydecay3);
 $arraydecay15 = ((($r)) + 120|0);
 _fe_mul($arraydecay15,$p,$arraydecay6);
 return;
}
function _ge_p2_0($h) {
 $h = $h|0;
 var $arraydecay1 = 0, $arraydecay2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 _fe_0($h);
 $arraydecay1 = ((($h)) + 40|0);
 _fe_1($arraydecay1);
 $arraydecay2 = ((($h)) + 80|0);
 _fe_1($arraydecay2);
 return;
}
function _ge_p2_dbl($r,$p) {
 $r = $r|0;
 $p = $p|0;
 var $arraydecay3 = 0, $arraydecay4 = 0, $arraydecay5 = 0, $arraydecay7 = 0, $arraydecay9 = 0, $t0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 48|0;
 $t0 = sp;
 _fe_sq($r,$p);
 $arraydecay3 = ((($r)) + 80|0);
 $arraydecay4 = ((($p)) + 40|0);
 _fe_sq($arraydecay3,$arraydecay4);
 $arraydecay5 = ((($r)) + 120|0);
 $arraydecay7 = ((($p)) + 80|0);
 _fe_sq2($arraydecay5,$arraydecay7);
 $arraydecay9 = ((($r)) + 40|0);
 _fe_add($arraydecay9,$p,$arraydecay4);
 _fe_sq($t0,$arraydecay9);
 _fe_add($arraydecay9,$arraydecay3,$r);
 _fe_sub($arraydecay3,$arraydecay3,$r);
 _fe_sub($r,$t0,$arraydecay9);
 _fe_sub($arraydecay5,$arraydecay5,$arraydecay3);
 STACKTOP = sp;return;
}
function _ge_sub($r,$p,$q) {
 $r = $r|0;
 $p = $p|0;
 $q = $q|0;
 var $arraydecay1 = 0, $arraydecay10 = 0, $arraydecay13 = 0, $arraydecay19 = 0, $arraydecay20 = 0, $arraydecay22 = 0, $arraydecay26 = 0, $arraydecay28 = 0, $arraydecay5 = 0, $t0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 48|0;
 $t0 = sp;
 $arraydecay1 = ((($p)) + 40|0);
 _fe_add($r,$arraydecay1,$p);
 $arraydecay5 = ((($r)) + 40|0);
 _fe_sub($arraydecay5,$arraydecay1,$p);
 $arraydecay10 = ((($r)) + 80|0);
 $arraydecay13 = ((($q)) + 40|0);
 _fe_mul($arraydecay10,$r,$arraydecay13);
 _fe_mul($arraydecay5,$arraydecay5,$q);
 $arraydecay19 = ((($r)) + 120|0);
 $arraydecay20 = ((($q)) + 120|0);
 $arraydecay22 = ((($p)) + 120|0);
 _fe_mul($arraydecay19,$arraydecay20,$arraydecay22);
 $arraydecay26 = ((($p)) + 80|0);
 $arraydecay28 = ((($q)) + 80|0);
 _fe_mul($r,$arraydecay26,$arraydecay28);
 _fe_add($t0,$r,$r);
 _fe_sub($r,$arraydecay10,$arraydecay5);
 _fe_add($arraydecay5,$arraydecay10,$arraydecay5);
 _fe_sub($arraydecay10,$t0,$arraydecay19);
 _fe_add($arraydecay19,$t0,$arraydecay19);
 STACKTOP = sp;return;
}
function _ge_madd($r,$p,$q) {
 $r = $r|0;
 $p = $p|0;
 $q = $q|0;
 var $arraydecay1 = 0, $arraydecay10 = 0, $arraydecay18 = 0, $arraydecay19 = 0, $arraydecay20 = 0, $arraydecay22 = 0, $arraydecay25 = 0, $arraydecay5 = 0, $t0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 48|0;
 $t0 = sp;
 $arraydecay1 = ((($p)) + 40|0);
 _fe_add($r,$arraydecay1,$p);
 $arraydecay5 = ((($r)) + 40|0);
 _fe_sub($arraydecay5,$arraydecay1,$p);
 $arraydecay10 = ((($r)) + 80|0);
 _fe_mul($arraydecay10,$r,$q);
 $arraydecay18 = ((($q)) + 40|0);
 _fe_mul($arraydecay5,$arraydecay5,$arraydecay18);
 $arraydecay19 = ((($r)) + 120|0);
 $arraydecay20 = ((($q)) + 80|0);
 $arraydecay22 = ((($p)) + 120|0);
 _fe_mul($arraydecay19,$arraydecay20,$arraydecay22);
 $arraydecay25 = ((($p)) + 80|0);
 _fe_add($t0,$arraydecay25,$arraydecay25);
 _fe_sub($r,$arraydecay10,$arraydecay5);
 _fe_add($arraydecay5,$arraydecay10,$arraydecay5);
 _fe_add($arraydecay10,$t0,$arraydecay19);
 _fe_sub($arraydecay19,$t0,$arraydecay19);
 STACKTOP = sp;return;
}
function _ge_msub($r,$p,$q) {
 $r = $r|0;
 $p = $p|0;
 $q = $q|0;
 var $arraydecay1 = 0, $arraydecay10 = 0, $arraydecay13 = 0, $arraydecay19 = 0, $arraydecay20 = 0, $arraydecay22 = 0, $arraydecay25 = 0, $arraydecay5 = 0, $t0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 48|0;
 $t0 = sp;
 $arraydecay1 = ((($p)) + 40|0);
 _fe_add($r,$arraydecay1,$p);
 $arraydecay5 = ((($r)) + 40|0);
 _fe_sub($arraydecay5,$arraydecay1,$p);
 $arraydecay10 = ((($r)) + 80|0);
 $arraydecay13 = ((($q)) + 40|0);
 _fe_mul($arraydecay10,$r,$arraydecay13);
 _fe_mul($arraydecay5,$arraydecay5,$q);
 $arraydecay19 = ((($r)) + 120|0);
 $arraydecay20 = ((($q)) + 80|0);
 $arraydecay22 = ((($p)) + 120|0);
 _fe_mul($arraydecay19,$arraydecay20,$arraydecay22);
 $arraydecay25 = ((($p)) + 80|0);
 _fe_add($t0,$arraydecay25,$arraydecay25);
 _fe_sub($r,$arraydecay10,$arraydecay5);
 _fe_add($arraydecay5,$arraydecay10,$arraydecay5);
 _fe_sub($arraydecay10,$t0,$arraydecay19);
 _fe_add($arraydecay19,$t0,$arraydecay19);
 STACKTOP = sp;return;
}
function _ge_p1p1_to_p2($r,$p) {
 $r = $r|0;
 $p = $p|0;
 var $arraydecay3 = 0, $arraydecay4 = 0, $arraydecay6 = 0, $arraydecay7 = 0, $arraydecay9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $arraydecay3 = ((($p)) + 120|0);
 _fe_mul($r,$p,$arraydecay3);
 $arraydecay4 = ((($r)) + 40|0);
 $arraydecay6 = ((($p)) + 40|0);
 $arraydecay7 = ((($p)) + 80|0);
 _fe_mul($arraydecay4,$arraydecay6,$arraydecay7);
 $arraydecay9 = ((($r)) + 80|0);
 _fe_mul($arraydecay9,$arraydecay7,$arraydecay3);
 return;
}
function _ge_p3_to_p2($r,$p) {
 $r = $r|0;
 $p = $p|0;
 var $arraydecay3 = 0, $arraydecay5 = 0, $arraydecay6 = 0, $arraydecay8 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 _fe_copy($r,$p);
 $arraydecay3 = ((($r)) + 40|0);
 $arraydecay5 = ((($p)) + 40|0);
 _fe_copy($arraydecay3,$arraydecay5);
 $arraydecay6 = ((($r)) + 80|0);
 $arraydecay8 = ((($p)) + 80|0);
 _fe_copy($arraydecay6,$arraydecay8);
 return;
}
function _ge_frombytes_negate_vartime($h,$s) {
 $h = $h|0;
 $s = $s|0;
 var $0 = 0, $1 = 0, $arraydecay = 0, $arraydecay1 = 0, $arraydecay78 = 0, $arrayidx = 0, $call = 0, $call60 = 0, $call70 = 0, $check = 0, $cmp = 0, $conv = 0, $retval$0 = 0, $tobool = 0, $tobool61 = 0, $u = 0, $v = 0, $v3 = 0, $vxx = 0, label = 0;
 var sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 240|0;
 $u = sp + 192|0;
 $v = sp + 144|0;
 $v3 = sp + 96|0;
 $vxx = sp + 48|0;
 $check = sp;
 $arraydecay = ((($h)) + 40|0);
 _fe_frombytes($arraydecay,$s);
 $arraydecay1 = ((($h)) + 80|0);
 _fe_1($arraydecay1);
 _fe_sq($u,$arraydecay);
 _fe_mul($v,$u,1024);
 _fe_sub($u,$u,$arraydecay1);
 _fe_add($v,$v,$arraydecay1);
 _fe_sq($v3,$v);
 _fe_mul($v3,$v3,$v);
 _fe_sq($h,$v3);
 _fe_mul($h,$h,$v);
 _fe_mul($h,$h,$u);
 _fe_pow22523($h,$h);
 _fe_mul($h,$h,$v3);
 _fe_mul($h,$h,$u);
 _fe_sq($vxx,$h);
 _fe_mul($vxx,$vxx,$v);
 _fe_sub($check,$vxx,$u);
 $call = (_fe_isnonzero($check)|0);
 $tobool = ($call|0)==(0);
 do {
  if (!($tobool)) {
   _fe_add($check,$vxx,$u);
   $call60 = (_fe_isnonzero($check)|0);
   $tobool61 = ($call60|0)==(0);
   if ($tobool61) {
    _fe_mul($h,$h,1072);
    break;
   } else {
    $retval$0 = -1;
    STACKTOP = sp;return ($retval$0|0);
   }
  }
 } while(0);
 $call70 = (_fe_isnegative($h)|0);
 $arrayidx = ((($s)) + 31|0);
 $0 = HEAP8[$arrayidx>>0]|0;
 $conv = $0&255;
 $1 = $conv >>> 7;
 $cmp = ($call70|0)==($1|0);
 if ($cmp) {
  _fe_neg($h,$h);
 }
 $arraydecay78 = ((($h)) + 120|0);
 _fe_mul($arraydecay78,$h,$arraydecay);
 $retval$0 = 0;
 STACKTOP = sp;return ($retval$0|0);
}
function _ge_p3_0($h) {
 $h = $h|0;
 var $arraydecay1 = 0, $arraydecay2 = 0, $arraydecay3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 _fe_0($h);
 $arraydecay1 = ((($h)) + 40|0);
 _fe_1($arraydecay1);
 $arraydecay2 = ((($h)) + 80|0);
 _fe_1($arraydecay2);
 $arraydecay3 = ((($h)) + 120|0);
 _fe_0($arraydecay3);
 return;
}
function _ge_p3_tobytes($s,$h) {
 $s = $s|0;
 $h = $h|0;
 var $0 = 0, $arraydecay1 = 0, $arraydecay6 = 0, $arrayidx = 0, $call = 0, $conv = 0, $conv10 = 0, $recip = 0, $shl = 0, $x = 0, $xor = 0, $y = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 144|0;
 $recip = sp + 96|0;
 $x = sp + 48|0;
 $y = sp;
 $arraydecay1 = ((($h)) + 80|0);
 _fe_invert($recip,$arraydecay1);
 _fe_mul($x,$h,$recip);
 $arraydecay6 = ((($h)) + 40|0);
 _fe_mul($y,$arraydecay6,$recip);
 _fe_tobytes($s,$y);
 $call = (_fe_isnegative($x)|0);
 $shl = $call << 7;
 $arrayidx = ((($s)) + 31|0);
 $0 = HEAP8[$arrayidx>>0]|0;
 $conv = $0&255;
 $xor = $shl ^ $conv;
 $conv10 = $xor&255;
 HEAP8[$arrayidx>>0] = $conv10;
 STACKTOP = sp;return;
}
function _ge_scalarmult_base($h,$a) {
 $h = $h|0;
 $a = $a|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $add18 = 0, $add37 = 0, $add45 = 0, $add54 = 0, $add9 = 0, $arrayidx = 0, $arrayidx10 = 0, $arrayidx16 = 0, $arrayidx2 = 0, $arrayidx35 = 0, $arrayidx43 = 0, $arrayidx52 = 0, $carry$034 = 0;
 var $cmp40 = 0, $cmp48 = 0, $conv1730 = 0, $conv30 = 0, $conv3629 = 0, $conv38 = 0, $div = 0, $div51 = 0, $e = 0, $exitcond = 0, $exitcond37 = 0, $i$036 = 0, $i$135 = 0, $i$233 = 0, $i$332 = 0, $inc = 0, $inc32 = 0, $mul = 0, $r = 0, $s = 0;
 var $sext = 0, $sext31 = 0, $shl = 0, $shr25 = 0, $sub = 0, $t = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 464|0;
 $e = sp;
 $r = sp + 304|0;
 $s = sp + 184|0;
 $t = sp + 64|0;
 $i$036 = 0;
 while(1) {
  $arrayidx = (($a) + ($i$036)|0);
  $0 = HEAP8[$arrayidx>>0]|0;
  $1 = $0 & 15;
  $mul = $i$036 << 1;
  $arrayidx2 = (($e) + ($mul)|0);
  HEAP8[$arrayidx2>>0] = $1;
  $2 = ($0&255) >>> 4;
  $add9 = $mul | 1;
  $arrayidx10 = (($e) + ($add9)|0);
  HEAP8[$arrayidx10>>0] = $2;
  $inc = (($i$036) + 1)|0;
  $exitcond37 = ($inc|0)==(32);
  if ($exitcond37) {
   break;
  } else {
   $i$036 = $inc;
  }
 }
 $carry$034 = 0;$i$135 = 0;
 while(1) {
  $arrayidx16 = (($e) + ($i$135)|0);
  $3 = HEAP8[$arrayidx16>>0]|0;
  $conv1730 = $3&255;
  $add18 = (($carry$034) + ($conv1730))|0;
  $sext = $add18 << 24;
  $sext31 = (($sext) + 134217728)|0;
  $shr25 = $sext31 >> 28;
  $shl = $shr25 << 4;
  $sub = (($add18) - ($shl))|0;
  $conv30 = $sub&255;
  HEAP8[$arrayidx16>>0] = $conv30;
  $inc32 = (($i$135) + 1)|0;
  $exitcond = ($inc32|0)==(63);
  if ($exitcond) {
   break;
  } else {
   $carry$034 = $shr25;$i$135 = $inc32;
  }
 }
 $arrayidx35 = ((($e)) + 63|0);
 $4 = HEAP8[$arrayidx35>>0]|0;
 $conv3629 = $4&255;
 $add37 = (($shr25) + ($conv3629))|0;
 $conv38 = $add37&255;
 HEAP8[$arrayidx35>>0] = $conv38;
 _ge_p3_0($h);
 $i$233 = 1;
 while(1) {
  $div = $i$233 >>> 1;
  $arrayidx43 = (($e) + ($i$233)|0);
  $5 = HEAP8[$arrayidx43>>0]|0;
  _select_42($t,$div,$5);
  _ge_madd($r,$h,$t);
  _ge_p1p1_to_p3($h,$r);
  $add45 = (($i$233) + 2)|0;
  $cmp40 = ($add45>>>0)<(64);
  if ($cmp40) {
   $i$233 = $add45;
  } else {
   break;
  }
 }
 _ge_p3_dbl($r,$h);
 _ge_p1p1_to_p2($s,$r);
 _ge_p2_dbl($r,$s);
 _ge_p1p1_to_p2($s,$r);
 _ge_p2_dbl($r,$s);
 _ge_p1p1_to_p2($s,$r);
 _ge_p2_dbl($r,$s);
 _ge_p1p1_to_p3($h,$r);
 $i$332 = 0;
 while(1) {
  $div51 = $i$332 >>> 1;
  $arrayidx52 = (($e) + ($i$332)|0);
  $6 = HEAP8[$arrayidx52>>0]|0;
  _select_42($t,$div51,$6);
  _ge_madd($r,$h,$t);
  _ge_p1p1_to_p3($h,$r);
  $add54 = (($i$332) + 2)|0;
  $cmp48 = ($add54>>>0)<(64);
  if ($cmp48) {
   $i$332 = $add54;
  } else {
   break;
  }
 }
 STACKTOP = sp;return;
}
function _select_42($t,$pos,$b) {
 $t = $t|0;
 $pos = $pos|0;
 $b = $b|0;
 var $and = 0, $arraydecay35 = 0, $arraydecay39 = 0, $arraydecay5 = 0, $arraydecay6 = 0, $arrayidx10 = 0, $arrayidx13 = 0, $arrayidx16 = 0, $arrayidx19 = 0, $arrayidx22 = 0, $arrayidx25 = 0, $arrayidx28 = 0, $arrayidx7 = 0, $call = 0, $call11 = 0, $call14 = 0, $call17 = 0, $call20 = 0, $call23 = 0, $call26 = 0;
 var $call29 = 0, $call8 = 0, $conv = 0, $conv1 = 0, $conv4 = 0, $minust = 0, $shl = 0, $sub = 0, $sub3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 128|0;
 $minust = sp;
 $call = (_negative($b)|0);
 $conv = $b << 24 >> 24;
 $conv1 = $call&255;
 $sub = (0 - ($conv1))|0;
 $and = $sub & $conv;
 $shl = $and << 1;
 $sub3 = (($conv) - ($shl))|0;
 $conv4 = $sub3&255;
 _fe_1($t);
 $arraydecay5 = ((($t)) + 40|0);
 _fe_1($arraydecay5);
 $arraydecay6 = ((($t)) + 80|0);
 _fe_0($arraydecay6);
 $arrayidx7 = (1120 + (($pos*960)|0)|0);
 $call8 = (_equal($conv4,1)|0);
 _cmov($t,$arrayidx7,$call8);
 $arrayidx10 = (((1120 + (($pos*960)|0)|0)) + 120|0);
 $call11 = (_equal($conv4,2)|0);
 _cmov($t,$arrayidx10,$call11);
 $arrayidx13 = (((1120 + (($pos*960)|0)|0)) + 240|0);
 $call14 = (_equal($conv4,3)|0);
 _cmov($t,$arrayidx13,$call14);
 $arrayidx16 = (((1120 + (($pos*960)|0)|0)) + 360|0);
 $call17 = (_equal($conv4,4)|0);
 _cmov($t,$arrayidx16,$call17);
 $arrayidx19 = (((1120 + (($pos*960)|0)|0)) + 480|0);
 $call20 = (_equal($conv4,5)|0);
 _cmov($t,$arrayidx19,$call20);
 $arrayidx22 = (((1120 + (($pos*960)|0)|0)) + 600|0);
 $call23 = (_equal($conv4,6)|0);
 _cmov($t,$arrayidx22,$call23);
 $arrayidx25 = (((1120 + (($pos*960)|0)|0)) + 720|0);
 $call26 = (_equal($conv4,7)|0);
 _cmov($t,$arrayidx25,$call26);
 $arrayidx28 = (((1120 + (($pos*960)|0)|0)) + 840|0);
 $call29 = (_equal($conv4,8)|0);
 _cmov($t,$arrayidx28,$call29);
 _fe_copy($minust,$arraydecay5);
 $arraydecay35 = ((($minust)) + 40|0);
 _fe_copy($arraydecay35,$t);
 $arraydecay39 = ((($minust)) + 80|0);
 _fe_neg($arraydecay39,$arraydecay6);
 _cmov($t,$minust,$call);
 STACKTOP = sp;return;
}
function _negative($b) {
 $b = $b|0;
 var $0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = ($b&255) >>> 7;
 return ($0|0);
}
function _equal($b,$c) {
 $b = $b|0;
 $c = $c|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $xor4 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $xor4 = $c ^ $b;
 $0 = $xor4&255;
 $1 = (_i64Add(($0|0),0,-1,-1)|0);
 $2 = (getTempRet0() | 0);
 $3 = (_bitshift64Lshr(($1|0),($2|0),63)|0);
 $4 = (getTempRet0() | 0);
 $5 = $3&255;
 return ($5|0);
}
function _cmov($t,$u,$b) {
 $t = $t|0;
 $u = $u|0;
 $b = $b|0;
 var $arraydecay3 = 0, $arraydecay5 = 0, $arraydecay7 = 0, $arraydecay9 = 0, $conv = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $conv = $b&255;
 _fe_cmov($t,$u,$conv);
 $arraydecay3 = ((($t)) + 40|0);
 $arraydecay5 = ((($u)) + 40|0);
 _fe_cmov($arraydecay3,$arraydecay5,$conv);
 $arraydecay7 = ((($t)) + 80|0);
 $arraydecay9 = ((($u)) + 80|0);
 _fe_cmov($arraydecay7,$arraydecay9,$conv);
 return;
}
function _ge_tobytes($s,$h) {
 $s = $s|0;
 $h = $h|0;
 var $0 = 0, $arraydecay1 = 0, $arraydecay6 = 0, $arrayidx = 0, $call = 0, $conv = 0, $conv10 = 0, $recip = 0, $shl = 0, $x = 0, $xor = 0, $y = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 144|0;
 $recip = sp + 96|0;
 $x = sp + 48|0;
 $y = sp;
 $arraydecay1 = ((($h)) + 80|0);
 _fe_invert($recip,$arraydecay1);
 _fe_mul($x,$h,$recip);
 $arraydecay6 = ((($h)) + 40|0);
 _fe_mul($y,$arraydecay6,$recip);
 _fe_tobytes($s,$y);
 $call = (_fe_isnegative($x)|0);
 $shl = $call << 7;
 $arrayidx = ((($s)) + 31|0);
 $0 = HEAP8[$arrayidx>>0]|0;
 $conv = $0&255;
 $xor = $shl ^ $conv;
 $conv10 = $xor&255;
 HEAP8[$arrayidx>>0] = $conv10;
 STACKTOP = sp;return;
}
function _ed25519_create_keypair($public_key,$private_key,$seed) {
 $public_key = $public_key|0;
 $private_key = $private_key|0;
 $seed = $seed|0;
 var $0 = 0, $1 = 0, $2 = 0, $3 = 0, $4 = 0, $A = 0, $arrayidx2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 160|0;
 $A = sp;
 (_sha512($seed,32,$private_key)|0);
 $0 = HEAP8[$private_key>>0]|0;
 $1 = $0 & -8;
 HEAP8[$private_key>>0] = $1;
 $arrayidx2 = ((($private_key)) + 31|0);
 $2 = HEAP8[$arrayidx2>>0]|0;
 $3 = $2 & 63;
 $4 = $3 | 64;
 HEAP8[$arrayidx2>>0] = $4;
 _ge_scalarmult_base($A,$private_key);
 _ge_p3_tobytes($public_key,$A);
 STACKTOP = sp;return;
}
function _sc_reduce($s) {
 $s = $s|0;
 var $0 = 0, $1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0;
 var $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0;
 var $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0;
 var $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0, $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0;
 var $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0;
 var $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0;
 var $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0;
 var $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0;
 var $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0;
 var $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $278 = 0;
 var $279 = 0, $28 = 0, $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $285 = 0, $286 = 0, $287 = 0, $288 = 0, $289 = 0, $29 = 0, $290 = 0, $291 = 0, $292 = 0, $293 = 0, $294 = 0, $295 = 0, $296 = 0;
 var $297 = 0, $298 = 0, $299 = 0, $3 = 0, $30 = 0, $300 = 0, $301 = 0, $302 = 0, $303 = 0, $304 = 0, $305 = 0, $306 = 0, $307 = 0, $308 = 0, $309 = 0, $31 = 0, $310 = 0, $311 = 0, $312 = 0, $313 = 0;
 var $314 = 0, $315 = 0, $316 = 0, $317 = 0, $318 = 0, $319 = 0, $32 = 0, $320 = 0, $321 = 0, $322 = 0, $323 = 0, $324 = 0, $325 = 0, $326 = 0, $327 = 0, $328 = 0, $329 = 0, $33 = 0, $330 = 0, $331 = 0;
 var $332 = 0, $333 = 0, $334 = 0, $335 = 0, $336 = 0, $337 = 0, $338 = 0, $339 = 0, $34 = 0, $340 = 0, $341 = 0, $342 = 0, $343 = 0, $344 = 0, $345 = 0, $346 = 0, $347 = 0, $348 = 0, $349 = 0, $35 = 0;
 var $350 = 0, $351 = 0, $352 = 0, $353 = 0, $354 = 0, $355 = 0, $356 = 0, $357 = 0, $358 = 0, $359 = 0, $36 = 0, $360 = 0, $361 = 0, $362 = 0, $363 = 0, $364 = 0, $365 = 0, $366 = 0, $367 = 0, $368 = 0;
 var $369 = 0, $37 = 0, $370 = 0, $371 = 0, $372 = 0, $373 = 0, $374 = 0, $375 = 0, $376 = 0, $377 = 0, $378 = 0, $379 = 0, $38 = 0, $380 = 0, $381 = 0, $382 = 0, $383 = 0, $384 = 0, $385 = 0, $386 = 0;
 var $387 = 0, $388 = 0, $389 = 0, $39 = 0, $390 = 0, $391 = 0, $392 = 0, $393 = 0, $394 = 0, $395 = 0, $396 = 0, $397 = 0, $398 = 0, $399 = 0, $4 = 0, $40 = 0, $400 = 0, $401 = 0, $402 = 0, $403 = 0;
 var $404 = 0, $405 = 0, $406 = 0, $407 = 0, $408 = 0, $409 = 0, $41 = 0, $410 = 0, $411 = 0, $412 = 0, $413 = 0, $414 = 0, $415 = 0, $416 = 0, $417 = 0, $418 = 0, $419 = 0, $42 = 0, $420 = 0, $421 = 0;
 var $422 = 0, $423 = 0, $424 = 0, $425 = 0, $426 = 0, $427 = 0, $428 = 0, $429 = 0, $43 = 0, $430 = 0, $431 = 0, $432 = 0, $433 = 0, $434 = 0, $435 = 0, $436 = 0, $437 = 0, $438 = 0, $439 = 0, $44 = 0;
 var $440 = 0, $441 = 0, $442 = 0, $443 = 0, $444 = 0, $445 = 0, $446 = 0, $447 = 0, $448 = 0, $449 = 0, $45 = 0, $450 = 0, $451 = 0, $452 = 0, $453 = 0, $454 = 0, $455 = 0, $456 = 0, $457 = 0, $458 = 0;
 var $459 = 0, $46 = 0, $460 = 0, $461 = 0, $462 = 0, $463 = 0, $464 = 0, $465 = 0, $466 = 0, $467 = 0, $468 = 0, $469 = 0, $47 = 0, $470 = 0, $471 = 0, $472 = 0, $473 = 0, $474 = 0, $475 = 0, $476 = 0;
 var $477 = 0, $478 = 0, $479 = 0, $48 = 0, $480 = 0, $481 = 0, $482 = 0, $483 = 0, $484 = 0, $485 = 0, $486 = 0, $487 = 0, $488 = 0, $489 = 0, $49 = 0, $490 = 0, $491 = 0, $492 = 0, $493 = 0, $494 = 0;
 var $495 = 0, $496 = 0, $497 = 0, $498 = 0, $499 = 0, $5 = 0, $50 = 0, $500 = 0, $501 = 0, $502 = 0, $503 = 0, $504 = 0, $505 = 0, $506 = 0, $507 = 0, $508 = 0, $509 = 0, $51 = 0, $510 = 0, $511 = 0;
 var $512 = 0, $513 = 0, $514 = 0, $515 = 0, $516 = 0, $517 = 0, $518 = 0, $519 = 0, $52 = 0, $520 = 0, $521 = 0, $522 = 0, $523 = 0, $524 = 0, $525 = 0, $526 = 0, $527 = 0, $528 = 0, $529 = 0, $53 = 0;
 var $530 = 0, $531 = 0, $532 = 0, $533 = 0, $534 = 0, $535 = 0, $536 = 0, $537 = 0, $538 = 0, $539 = 0, $54 = 0, $540 = 0, $541 = 0, $542 = 0, $543 = 0, $544 = 0, $545 = 0, $546 = 0, $547 = 0, $548 = 0;
 var $549 = 0, $55 = 0, $550 = 0, $551 = 0, $552 = 0, $553 = 0, $554 = 0, $555 = 0, $556 = 0, $557 = 0, $558 = 0, $559 = 0, $56 = 0, $560 = 0, $561 = 0, $562 = 0, $563 = 0, $564 = 0, $565 = 0, $566 = 0;
 var $567 = 0, $568 = 0, $569 = 0, $57 = 0, $570 = 0, $571 = 0, $572 = 0, $573 = 0, $574 = 0, $575 = 0, $576 = 0, $577 = 0, $578 = 0, $579 = 0, $58 = 0, $580 = 0, $581 = 0, $582 = 0, $583 = 0, $584 = 0;
 var $585 = 0, $586 = 0, $587 = 0, $588 = 0, $589 = 0, $59 = 0, $590 = 0, $591 = 0, $592 = 0, $593 = 0, $594 = 0, $595 = 0, $596 = 0, $597 = 0, $598 = 0, $599 = 0, $6 = 0, $60 = 0, $600 = 0, $601 = 0;
 var $602 = 0, $603 = 0, $604 = 0, $605 = 0, $606 = 0, $607 = 0, $608 = 0, $609 = 0, $61 = 0, $610 = 0, $611 = 0, $612 = 0, $613 = 0, $614 = 0, $615 = 0, $616 = 0, $617 = 0, $618 = 0, $619 = 0, $62 = 0;
 var $620 = 0, $621 = 0, $622 = 0, $623 = 0, $624 = 0, $625 = 0, $626 = 0, $627 = 0, $628 = 0, $629 = 0, $63 = 0, $630 = 0, $631 = 0, $632 = 0, $633 = 0, $634 = 0, $635 = 0, $636 = 0, $637 = 0, $638 = 0;
 var $639 = 0, $64 = 0, $640 = 0, $641 = 0, $642 = 0, $643 = 0, $644 = 0, $645 = 0, $646 = 0, $647 = 0, $648 = 0, $649 = 0, $65 = 0, $650 = 0, $651 = 0, $652 = 0, $653 = 0, $654 = 0, $655 = 0, $656 = 0;
 var $657 = 0, $658 = 0, $659 = 0, $66 = 0, $660 = 0, $661 = 0, $662 = 0, $663 = 0, $664 = 0, $665 = 0, $666 = 0, $667 = 0, $668 = 0, $669 = 0, $67 = 0, $670 = 0, $671 = 0, $672 = 0, $673 = 0, $674 = 0;
 var $675 = 0, $676 = 0, $677 = 0, $678 = 0, $679 = 0, $68 = 0, $680 = 0, $681 = 0, $682 = 0, $683 = 0, $684 = 0, $685 = 0, $686 = 0, $687 = 0, $688 = 0, $689 = 0, $69 = 0, $690 = 0, $691 = 0, $692 = 0;
 var $693 = 0, $694 = 0, $695 = 0, $696 = 0, $697 = 0, $698 = 0, $699 = 0, $7 = 0, $70 = 0, $700 = 0, $701 = 0, $702 = 0, $703 = 0, $704 = 0, $705 = 0, $706 = 0, $707 = 0, $708 = 0, $709 = 0, $71 = 0;
 var $710 = 0, $711 = 0, $712 = 0, $713 = 0, $714 = 0, $715 = 0, $716 = 0, $717 = 0, $718 = 0, $719 = 0, $72 = 0, $720 = 0, $721 = 0, $722 = 0, $723 = 0, $724 = 0, $725 = 0, $726 = 0, $727 = 0, $728 = 0;
 var $729 = 0, $73 = 0, $730 = 0, $731 = 0, $732 = 0, $733 = 0, $734 = 0, $735 = 0, $736 = 0, $737 = 0, $738 = 0, $739 = 0, $74 = 0, $740 = 0, $741 = 0, $742 = 0, $743 = 0, $744 = 0, $745 = 0, $746 = 0;
 var $747 = 0, $748 = 0, $749 = 0, $75 = 0, $750 = 0, $751 = 0, $752 = 0, $753 = 0, $754 = 0, $755 = 0, $756 = 0, $757 = 0, $758 = 0, $759 = 0, $76 = 0, $760 = 0, $761 = 0, $762 = 0, $763 = 0, $764 = 0;
 var $765 = 0, $766 = 0, $767 = 0, $768 = 0, $769 = 0, $77 = 0, $770 = 0, $771 = 0, $772 = 0, $773 = 0, $774 = 0, $775 = 0, $776 = 0, $777 = 0, $778 = 0, $779 = 0, $78 = 0, $780 = 0, $781 = 0, $782 = 0;
 var $783 = 0, $784 = 0, $785 = 0, $786 = 0, $787 = 0, $788 = 0, $789 = 0, $79 = 0, $790 = 0, $791 = 0, $792 = 0, $793 = 0, $794 = 0, $795 = 0, $796 = 0, $797 = 0, $798 = 0, $799 = 0, $8 = 0, $80 = 0;
 var $800 = 0, $801 = 0, $802 = 0, $803 = 0, $804 = 0, $805 = 0, $806 = 0, $807 = 0, $808 = 0, $809 = 0, $81 = 0, $810 = 0, $811 = 0, $812 = 0, $813 = 0, $814 = 0, $815 = 0, $816 = 0, $817 = 0, $818 = 0;
 var $819 = 0, $82 = 0, $820 = 0, $821 = 0, $822 = 0, $823 = 0, $824 = 0, $825 = 0, $826 = 0, $827 = 0, $828 = 0, $829 = 0, $83 = 0, $830 = 0, $831 = 0, $832 = 0, $833 = 0, $834 = 0, $835 = 0, $836 = 0;
 var $837 = 0, $838 = 0, $839 = 0, $84 = 0, $840 = 0, $841 = 0, $842 = 0, $843 = 0, $844 = 0, $845 = 0, $846 = 0, $847 = 0, $848 = 0, $849 = 0, $85 = 0, $850 = 0, $851 = 0, $852 = 0, $853 = 0, $854 = 0;
 var $855 = 0, $856 = 0, $857 = 0, $858 = 0, $859 = 0, $86 = 0, $860 = 0, $861 = 0, $862 = 0, $863 = 0, $864 = 0, $865 = 0, $866 = 0, $867 = 0, $868 = 0, $869 = 0, $87 = 0, $870 = 0, $871 = 0, $872 = 0;
 var $873 = 0, $874 = 0, $875 = 0, $876 = 0, $877 = 0, $878 = 0, $879 = 0, $88 = 0, $880 = 0, $881 = 0, $882 = 0, $883 = 0, $884 = 0, $885 = 0, $886 = 0, $887 = 0, $888 = 0, $89 = 0, $9 = 0, $90 = 0;
 var $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, $add$ptr = 0, $add$ptr11 = 0, $add$ptr15 = 0, $add$ptr19 = 0, $add$ptr23 = 0, $add$ptr27 = 0, $add$ptr3 = 0, $add$ptr30 = 0, $add$ptr34 = 0, $add$ptr38 = 0, $add$ptr42 = 0;
 var $add$ptr46 = 0, $add$ptr50 = 0, $add$ptr54 = 0, $add$ptr58 = 0, $add$ptr61 = 0, $add$ptr65 = 0, $add$ptr69 = 0, $add$ptr7 = 0, $add$ptr73 = 0, $add$ptr77 = 0, $add$ptr81 = 0, $add$ptr85 = 0, $arrayidx462 = 0, $arrayidx469 = 0, $arrayidx472 = 0, $arrayidx480 = 0, $arrayidx488 = 0, $arrayidx491 = 0, $arrayidx499 = 0, $arrayidx502 = 0;
 var $arrayidx510 = 0, $arrayidx518 = 0, $arrayidx521 = 0, $arrayidx529 = 0, $arrayidx532 = 0, $arrayidx538 = 0, $arrayidx546 = 0, $arrayidx549 = 0, $arrayidx557 = 0, $arrayidx565 = 0, $arrayidx568 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (_load_3_17($s)|0);
 $1 = (getTempRet0() | 0);
 $2 = $0 & 2097151;
 $add$ptr = ((($s)) + 2|0);
 $3 = (_load_4_18($add$ptr)|0);
 $4 = (getTempRet0() | 0);
 $5 = (_bitshift64Lshr(($3|0),($4|0),5)|0);
 $6 = (getTempRet0() | 0);
 $7 = $5 & 2097151;
 $add$ptr3 = ((($s)) + 5|0);
 $8 = (_load_3_17($add$ptr3)|0);
 $9 = (getTempRet0() | 0);
 $10 = (_bitshift64Lshr(($8|0),($9|0),2)|0);
 $11 = (getTempRet0() | 0);
 $12 = $10 & 2097151;
 $add$ptr7 = ((($s)) + 7|0);
 $13 = (_load_4_18($add$ptr7)|0);
 $14 = (getTempRet0() | 0);
 $15 = (_bitshift64Lshr(($13|0),($14|0),7)|0);
 $16 = (getTempRet0() | 0);
 $17 = $15 & 2097151;
 $add$ptr11 = ((($s)) + 10|0);
 $18 = (_load_4_18($add$ptr11)|0);
 $19 = (getTempRet0() | 0);
 $20 = (_bitshift64Lshr(($18|0),($19|0),4)|0);
 $21 = (getTempRet0() | 0);
 $22 = $20 & 2097151;
 $add$ptr15 = ((($s)) + 13|0);
 $23 = (_load_3_17($add$ptr15)|0);
 $24 = (getTempRet0() | 0);
 $25 = (_bitshift64Lshr(($23|0),($24|0),1)|0);
 $26 = (getTempRet0() | 0);
 $27 = $25 & 2097151;
 $add$ptr19 = ((($s)) + 15|0);
 $28 = (_load_4_18($add$ptr19)|0);
 $29 = (getTempRet0() | 0);
 $30 = (_bitshift64Lshr(($28|0),($29|0),6)|0);
 $31 = (getTempRet0() | 0);
 $32 = $30 & 2097151;
 $add$ptr23 = ((($s)) + 18|0);
 $33 = (_load_3_17($add$ptr23)|0);
 $34 = (getTempRet0() | 0);
 $35 = (_bitshift64Lshr(($33|0),($34|0),3)|0);
 $36 = (getTempRet0() | 0);
 $37 = $35 & 2097151;
 $add$ptr27 = ((($s)) + 21|0);
 $38 = (_load_3_17($add$ptr27)|0);
 $39 = (getTempRet0() | 0);
 $40 = $38 & 2097151;
 $add$ptr30 = ((($s)) + 23|0);
 $41 = (_load_4_18($add$ptr30)|0);
 $42 = (getTempRet0() | 0);
 $43 = (_bitshift64Lshr(($41|0),($42|0),5)|0);
 $44 = (getTempRet0() | 0);
 $45 = $43 & 2097151;
 $add$ptr34 = ((($s)) + 26|0);
 $46 = (_load_3_17($add$ptr34)|0);
 $47 = (getTempRet0() | 0);
 $48 = (_bitshift64Lshr(($46|0),($47|0),2)|0);
 $49 = (getTempRet0() | 0);
 $50 = $48 & 2097151;
 $add$ptr38 = ((($s)) + 28|0);
 $51 = (_load_4_18($add$ptr38)|0);
 $52 = (getTempRet0() | 0);
 $53 = (_bitshift64Lshr(($51|0),($52|0),7)|0);
 $54 = (getTempRet0() | 0);
 $55 = $53 & 2097151;
 $add$ptr42 = ((($s)) + 31|0);
 $56 = (_load_4_18($add$ptr42)|0);
 $57 = (getTempRet0() | 0);
 $58 = (_bitshift64Lshr(($56|0),($57|0),4)|0);
 $59 = (getTempRet0() | 0);
 $60 = $58 & 2097151;
 $add$ptr46 = ((($s)) + 34|0);
 $61 = (_load_3_17($add$ptr46)|0);
 $62 = (getTempRet0() | 0);
 $63 = (_bitshift64Lshr(($61|0),($62|0),1)|0);
 $64 = (getTempRet0() | 0);
 $65 = $63 & 2097151;
 $add$ptr50 = ((($s)) + 36|0);
 $66 = (_load_4_18($add$ptr50)|0);
 $67 = (getTempRet0() | 0);
 $68 = (_bitshift64Lshr(($66|0),($67|0),6)|0);
 $69 = (getTempRet0() | 0);
 $70 = $68 & 2097151;
 $add$ptr54 = ((($s)) + 39|0);
 $71 = (_load_3_17($add$ptr54)|0);
 $72 = (getTempRet0() | 0);
 $73 = (_bitshift64Lshr(($71|0),($72|0),3)|0);
 $74 = (getTempRet0() | 0);
 $75 = $73 & 2097151;
 $add$ptr58 = ((($s)) + 42|0);
 $76 = (_load_3_17($add$ptr58)|0);
 $77 = (getTempRet0() | 0);
 $78 = $76 & 2097151;
 $add$ptr61 = ((($s)) + 44|0);
 $79 = (_load_4_18($add$ptr61)|0);
 $80 = (getTempRet0() | 0);
 $81 = (_bitshift64Lshr(($79|0),($80|0),5)|0);
 $82 = (getTempRet0() | 0);
 $83 = $81 & 2097151;
 $add$ptr65 = ((($s)) + 47|0);
 $84 = (_load_3_17($add$ptr65)|0);
 $85 = (getTempRet0() | 0);
 $86 = (_bitshift64Lshr(($84|0),($85|0),2)|0);
 $87 = (getTempRet0() | 0);
 $88 = $86 & 2097151;
 $add$ptr69 = ((($s)) + 49|0);
 $89 = (_load_4_18($add$ptr69)|0);
 $90 = (getTempRet0() | 0);
 $91 = (_bitshift64Lshr(($89|0),($90|0),7)|0);
 $92 = (getTempRet0() | 0);
 $93 = $91 & 2097151;
 $add$ptr73 = ((($s)) + 52|0);
 $94 = (_load_4_18($add$ptr73)|0);
 $95 = (getTempRet0() | 0);
 $96 = (_bitshift64Lshr(($94|0),($95|0),4)|0);
 $97 = (getTempRet0() | 0);
 $98 = $96 & 2097151;
 $add$ptr77 = ((($s)) + 55|0);
 $99 = (_load_3_17($add$ptr77)|0);
 $100 = (getTempRet0() | 0);
 $101 = (_bitshift64Lshr(($99|0),($100|0),1)|0);
 $102 = (getTempRet0() | 0);
 $103 = $101 & 2097151;
 $add$ptr81 = ((($s)) + 57|0);
 $104 = (_load_4_18($add$ptr81)|0);
 $105 = (getTempRet0() | 0);
 $106 = (_bitshift64Lshr(($104|0),($105|0),6)|0);
 $107 = (getTempRet0() | 0);
 $108 = $106 & 2097151;
 $add$ptr85 = ((($s)) + 60|0);
 $109 = (_load_4_18($add$ptr85)|0);
 $110 = (getTempRet0() | 0);
 $111 = (_bitshift64Lshr(($109|0),($110|0),3)|0);
 $112 = (getTempRet0() | 0);
 $113 = (___muldi3(($111|0),($112|0),666643,0)|0);
 $114 = (getTempRet0() | 0);
 $115 = (___muldi3(($111|0),($112|0),470296,0)|0);
 $116 = (getTempRet0() | 0);
 $117 = (___muldi3(($111|0),($112|0),654183,0)|0);
 $118 = (getTempRet0() | 0);
 $119 = (___muldi3(($111|0),($112|0),-997805,-1)|0);
 $120 = (getTempRet0() | 0);
 $121 = (___muldi3(($111|0),($112|0),136657,0)|0);
 $122 = (getTempRet0() | 0);
 $123 = (_i64Add(($121|0),($122|0),($75|0),0)|0);
 $124 = (getTempRet0() | 0);
 $125 = (___muldi3(($111|0),($112|0),-683901,-1)|0);
 $126 = (getTempRet0() | 0);
 $127 = (_i64Add(($125|0),($126|0),($78|0),0)|0);
 $128 = (getTempRet0() | 0);
 $129 = (___muldi3(($108|0),0,666643,0)|0);
 $130 = (getTempRet0() | 0);
 $131 = (___muldi3(($108|0),0,470296,0)|0);
 $132 = (getTempRet0() | 0);
 $133 = (___muldi3(($108|0),0,654183,0)|0);
 $134 = (getTempRet0() | 0);
 $135 = (___muldi3(($108|0),0,-997805,-1)|0);
 $136 = (getTempRet0() | 0);
 $137 = (___muldi3(($108|0),0,136657,0)|0);
 $138 = (getTempRet0() | 0);
 $139 = (___muldi3(($108|0),0,-683901,-1)|0);
 $140 = (getTempRet0() | 0);
 $141 = (_i64Add(($123|0),($124|0),($139|0),($140|0))|0);
 $142 = (getTempRet0() | 0);
 $143 = (___muldi3(($103|0),0,666643,0)|0);
 $144 = (getTempRet0() | 0);
 $145 = (___muldi3(($103|0),0,470296,0)|0);
 $146 = (getTempRet0() | 0);
 $147 = (___muldi3(($103|0),0,654183,0)|0);
 $148 = (getTempRet0() | 0);
 $149 = (___muldi3(($103|0),0,-997805,-1)|0);
 $150 = (getTempRet0() | 0);
 $151 = (___muldi3(($103|0),0,136657,0)|0);
 $152 = (getTempRet0() | 0);
 $153 = (___muldi3(($103|0),0,-683901,-1)|0);
 $154 = (getTempRet0() | 0);
 $155 = (_i64Add(($153|0),($154|0),($70|0),0)|0);
 $156 = (getTempRet0() | 0);
 $157 = (_i64Add(($155|0),($156|0),($119|0),($120|0))|0);
 $158 = (getTempRet0() | 0);
 $159 = (_i64Add(($157|0),($158|0),($137|0),($138|0))|0);
 $160 = (getTempRet0() | 0);
 $161 = (___muldi3(($98|0),0,666643,0)|0);
 $162 = (getTempRet0() | 0);
 $163 = (___muldi3(($98|0),0,470296,0)|0);
 $164 = (getTempRet0() | 0);
 $165 = (___muldi3(($98|0),0,654183,0)|0);
 $166 = (getTempRet0() | 0);
 $167 = (___muldi3(($98|0),0,-997805,-1)|0);
 $168 = (getTempRet0() | 0);
 $169 = (___muldi3(($98|0),0,136657,0)|0);
 $170 = (getTempRet0() | 0);
 $171 = (___muldi3(($98|0),0,-683901,-1)|0);
 $172 = (getTempRet0() | 0);
 $173 = (___muldi3(($93|0),0,666643,0)|0);
 $174 = (getTempRet0() | 0);
 $175 = (___muldi3(($93|0),0,470296,0)|0);
 $176 = (getTempRet0() | 0);
 $177 = (___muldi3(($93|0),0,654183,0)|0);
 $178 = (getTempRet0() | 0);
 $179 = (___muldi3(($93|0),0,-997805,-1)|0);
 $180 = (getTempRet0() | 0);
 $181 = (___muldi3(($93|0),0,136657,0)|0);
 $182 = (getTempRet0() | 0);
 $183 = (___muldi3(($93|0),0,-683901,-1)|0);
 $184 = (getTempRet0() | 0);
 $185 = (_i64Add(($183|0),($184|0),($60|0),0)|0);
 $186 = (getTempRet0() | 0);
 $187 = (_i64Add(($185|0),($186|0),($169|0),($170|0))|0);
 $188 = (getTempRet0() | 0);
 $189 = (_i64Add(($187|0),($188|0),($149|0),($150|0))|0);
 $190 = (getTempRet0() | 0);
 $191 = (_i64Add(($189|0),($190|0),($115|0),($116|0))|0);
 $192 = (getTempRet0() | 0);
 $193 = (_i64Add(($191|0),($192|0),($133|0),($134|0))|0);
 $194 = (getTempRet0() | 0);
 $195 = (___muldi3(($88|0),0,666643,0)|0);
 $196 = (getTempRet0() | 0);
 $197 = (_i64Add(($195|0),($196|0),($32|0),0)|0);
 $198 = (getTempRet0() | 0);
 $199 = (___muldi3(($88|0),0,470296,0)|0);
 $200 = (getTempRet0() | 0);
 $201 = (___muldi3(($88|0),0,654183,0)|0);
 $202 = (getTempRet0() | 0);
 $203 = (_i64Add(($201|0),($202|0),($40|0),0)|0);
 $204 = (getTempRet0() | 0);
 $205 = (_i64Add(($203|0),($204|0),($175|0),($176|0))|0);
 $206 = (getTempRet0() | 0);
 $207 = (_i64Add(($205|0),($206|0),($161|0),($162|0))|0);
 $208 = (getTempRet0() | 0);
 $209 = (___muldi3(($88|0),0,-997805,-1)|0);
 $210 = (getTempRet0() | 0);
 $211 = (___muldi3(($88|0),0,136657,0)|0);
 $212 = (getTempRet0() | 0);
 $213 = (_i64Add(($211|0),($212|0),($50|0),0)|0);
 $214 = (getTempRet0() | 0);
 $215 = (_i64Add(($213|0),($214|0),($179|0),($180|0))|0);
 $216 = (getTempRet0() | 0);
 $217 = (_i64Add(($215|0),($216|0),($165|0),($166|0))|0);
 $218 = (getTempRet0() | 0);
 $219 = (_i64Add(($217|0),($218|0),($145|0),($146|0))|0);
 $220 = (getTempRet0() | 0);
 $221 = (_i64Add(($219|0),($220|0),($129|0),($130|0))|0);
 $222 = (getTempRet0() | 0);
 $223 = (___muldi3(($88|0),0,-683901,-1)|0);
 $224 = (getTempRet0() | 0);
 $225 = (_i64Add(($197|0),($198|0),1048576,0)|0);
 $226 = (getTempRet0() | 0);
 $227 = (_bitshift64Lshr(($225|0),($226|0),21)|0);
 $228 = (getTempRet0() | 0);
 $229 = (_i64Add(($199|0),($200|0),($37|0),0)|0);
 $230 = (getTempRet0() | 0);
 $231 = (_i64Add(($229|0),($230|0),($173|0),($174|0))|0);
 $232 = (getTempRet0() | 0);
 $233 = (_i64Add(($231|0),($232|0),($227|0),($228|0))|0);
 $234 = (getTempRet0() | 0);
 $235 = $225 & -2097152;
 $236 = $226 & 2047;
 $237 = (_i64Subtract(($197|0),($198|0),($235|0),($236|0))|0);
 $238 = (getTempRet0() | 0);
 $239 = (_i64Add(($207|0),($208|0),1048576,0)|0);
 $240 = (getTempRet0() | 0);
 $241 = (_bitshift64Lshr(($239|0),($240|0),21)|0);
 $242 = (getTempRet0() | 0);
 $243 = (_i64Add(($209|0),($210|0),($45|0),0)|0);
 $244 = (getTempRet0() | 0);
 $245 = (_i64Add(($243|0),($244|0),($177|0),($178|0))|0);
 $246 = (getTempRet0() | 0);
 $247 = (_i64Add(($245|0),($246|0),($163|0),($164|0))|0);
 $248 = (getTempRet0() | 0);
 $249 = (_i64Add(($247|0),($248|0),($143|0),($144|0))|0);
 $250 = (getTempRet0() | 0);
 $251 = (_i64Add(($249|0),($250|0),($241|0),($242|0))|0);
 $252 = (getTempRet0() | 0);
 $253 = $239 & -2097152;
 $254 = (_i64Add(($221|0),($222|0),1048576,0)|0);
 $255 = (getTempRet0() | 0);
 $256 = (_bitshift64Ashr(($254|0),($255|0),21)|0);
 $257 = (getTempRet0() | 0);
 $258 = (_i64Add(($223|0),($224|0),($55|0),0)|0);
 $259 = (getTempRet0() | 0);
 $260 = (_i64Add(($258|0),($259|0),($181|0),($182|0))|0);
 $261 = (getTempRet0() | 0);
 $262 = (_i64Add(($260|0),($261|0),($167|0),($168|0))|0);
 $263 = (getTempRet0() | 0);
 $264 = (_i64Add(($262|0),($263|0),($147|0),($148|0))|0);
 $265 = (getTempRet0() | 0);
 $266 = (_i64Add(($264|0),($265|0),($113|0),($114|0))|0);
 $267 = (getTempRet0() | 0);
 $268 = (_i64Add(($266|0),($267|0),($131|0),($132|0))|0);
 $269 = (getTempRet0() | 0);
 $270 = (_i64Add(($268|0),($269|0),($256|0),($257|0))|0);
 $271 = (getTempRet0() | 0);
 $272 = $254 & -2097152;
 $273 = (_i64Add(($193|0),($194|0),1048576,0)|0);
 $274 = (getTempRet0() | 0);
 $275 = (_bitshift64Ashr(($273|0),($274|0),21)|0);
 $276 = (getTempRet0() | 0);
 $277 = (_i64Add(($171|0),($172|0),($65|0),0)|0);
 $278 = (getTempRet0() | 0);
 $279 = (_i64Add(($277|0),($278|0),($151|0),($152|0))|0);
 $280 = (getTempRet0() | 0);
 $281 = (_i64Add(($279|0),($280|0),($117|0),($118|0))|0);
 $282 = (getTempRet0() | 0);
 $283 = (_i64Add(($281|0),($282|0),($135|0),($136|0))|0);
 $284 = (getTempRet0() | 0);
 $285 = (_i64Add(($283|0),($284|0),($275|0),($276|0))|0);
 $286 = (getTempRet0() | 0);
 $287 = $273 & -2097152;
 $288 = (_i64Subtract(($193|0),($194|0),($287|0),($274|0))|0);
 $289 = (getTempRet0() | 0);
 $290 = (_i64Add(($159|0),($160|0),1048576,0)|0);
 $291 = (getTempRet0() | 0);
 $292 = (_bitshift64Ashr(($290|0),($291|0),21)|0);
 $293 = (getTempRet0() | 0);
 $294 = (_i64Add(($141|0),($142|0),($292|0),($293|0))|0);
 $295 = (getTempRet0() | 0);
 $296 = $290 & -2097152;
 $297 = (_i64Subtract(($159|0),($160|0),($296|0),($291|0))|0);
 $298 = (getTempRet0() | 0);
 $299 = (_i64Add(($127|0),($128|0),1048576,0)|0);
 $300 = (getTempRet0() | 0);
 $301 = (_bitshift64Ashr(($299|0),($300|0),21)|0);
 $302 = (getTempRet0() | 0);
 $303 = (_i64Add(($301|0),($302|0),($83|0),0)|0);
 $304 = (getTempRet0() | 0);
 $305 = $299 & -2097152;
 $306 = (_i64Subtract(($127|0),($128|0),($305|0),($300|0))|0);
 $307 = (getTempRet0() | 0);
 $308 = (_i64Add(($233|0),($234|0),1048576,0)|0);
 $309 = (getTempRet0() | 0);
 $310 = (_bitshift64Lshr(($308|0),($309|0),21)|0);
 $311 = (getTempRet0() | 0);
 $312 = $308 & -2097152;
 $313 = (_i64Subtract(($233|0),($234|0),($312|0),($309|0))|0);
 $314 = (getTempRet0() | 0);
 $315 = (_i64Add(($251|0),($252|0),1048576,0)|0);
 $316 = (getTempRet0() | 0);
 $317 = (_bitshift64Ashr(($315|0),($316|0),21)|0);
 $318 = (getTempRet0() | 0);
 $319 = $315 & -2097152;
 $320 = (_i64Add(($270|0),($271|0),1048576,0)|0);
 $321 = (getTempRet0() | 0);
 $322 = (_bitshift64Ashr(($320|0),($321|0),21)|0);
 $323 = (getTempRet0() | 0);
 $324 = (_i64Add(($322|0),($323|0),($288|0),($289|0))|0);
 $325 = (getTempRet0() | 0);
 $326 = $320 & -2097152;
 $327 = (_i64Subtract(($270|0),($271|0),($326|0),($321|0))|0);
 $328 = (getTempRet0() | 0);
 $329 = (_i64Add(($285|0),($286|0),1048576,0)|0);
 $330 = (getTempRet0() | 0);
 $331 = (_bitshift64Ashr(($329|0),($330|0),21)|0);
 $332 = (getTempRet0() | 0);
 $333 = (_i64Add(($331|0),($332|0),($297|0),($298|0))|0);
 $334 = (getTempRet0() | 0);
 $335 = $329 & -2097152;
 $336 = (_i64Subtract(($285|0),($286|0),($335|0),($330|0))|0);
 $337 = (getTempRet0() | 0);
 $338 = (_i64Add(($294|0),($295|0),1048576,0)|0);
 $339 = (getTempRet0() | 0);
 $340 = (_bitshift64Ashr(($338|0),($339|0),21)|0);
 $341 = (getTempRet0() | 0);
 $342 = (_i64Add(($340|0),($341|0),($306|0),($307|0))|0);
 $343 = (getTempRet0() | 0);
 $344 = $338 & -2097152;
 $345 = (_i64Subtract(($294|0),($295|0),($344|0),($339|0))|0);
 $346 = (getTempRet0() | 0);
 $347 = (___muldi3(($303|0),($304|0),666643,0)|0);
 $348 = (getTempRet0() | 0);
 $349 = (_i64Add(($347|0),($348|0),($27|0),0)|0);
 $350 = (getTempRet0() | 0);
 $351 = (___muldi3(($303|0),($304|0),470296,0)|0);
 $352 = (getTempRet0() | 0);
 $353 = (_i64Add(($237|0),($238|0),($351|0),($352|0))|0);
 $354 = (getTempRet0() | 0);
 $355 = (___muldi3(($303|0),($304|0),654183,0)|0);
 $356 = (getTempRet0() | 0);
 $357 = (_i64Add(($313|0),($314|0),($355|0),($356|0))|0);
 $358 = (getTempRet0() | 0);
 $359 = (___muldi3(($303|0),($304|0),-997805,-1)|0);
 $360 = (getTempRet0() | 0);
 $361 = (___muldi3(($303|0),($304|0),136657,0)|0);
 $362 = (getTempRet0() | 0);
 $363 = (___muldi3(($303|0),($304|0),-683901,-1)|0);
 $364 = (getTempRet0() | 0);
 $365 = (_i64Add(($363|0),($364|0),($221|0),($222|0))|0);
 $366 = (getTempRet0() | 0);
 $367 = (_i64Add(($365|0),($366|0),($317|0),($318|0))|0);
 $368 = (getTempRet0() | 0);
 $369 = (_i64Subtract(($367|0),($368|0),($272|0),($255|0))|0);
 $370 = (getTempRet0() | 0);
 $371 = (___muldi3(($342|0),($343|0),666643,0)|0);
 $372 = (getTempRet0() | 0);
 $373 = (_i64Add(($371|0),($372|0),($22|0),0)|0);
 $374 = (getTempRet0() | 0);
 $375 = (___muldi3(($342|0),($343|0),470296,0)|0);
 $376 = (getTempRet0() | 0);
 $377 = (_i64Add(($349|0),($350|0),($375|0),($376|0))|0);
 $378 = (getTempRet0() | 0);
 $379 = (___muldi3(($342|0),($343|0),654183,0)|0);
 $380 = (getTempRet0() | 0);
 $381 = (_i64Add(($353|0),($354|0),($379|0),($380|0))|0);
 $382 = (getTempRet0() | 0);
 $383 = (___muldi3(($342|0),($343|0),-997805,-1)|0);
 $384 = (getTempRet0() | 0);
 $385 = (_i64Add(($357|0),($358|0),($383|0),($384|0))|0);
 $386 = (getTempRet0() | 0);
 $387 = (___muldi3(($342|0),($343|0),136657,0)|0);
 $388 = (getTempRet0() | 0);
 $389 = (___muldi3(($342|0),($343|0),-683901,-1)|0);
 $390 = (getTempRet0() | 0);
 $391 = (___muldi3(($345|0),($346|0),666643,0)|0);
 $392 = (getTempRet0() | 0);
 $393 = (_i64Add(($391|0),($392|0),($17|0),0)|0);
 $394 = (getTempRet0() | 0);
 $395 = (___muldi3(($345|0),($346|0),470296,0)|0);
 $396 = (getTempRet0() | 0);
 $397 = (_i64Add(($373|0),($374|0),($395|0),($396|0))|0);
 $398 = (getTempRet0() | 0);
 $399 = (___muldi3(($345|0),($346|0),654183,0)|0);
 $400 = (getTempRet0() | 0);
 $401 = (_i64Add(($377|0),($378|0),($399|0),($400|0))|0);
 $402 = (getTempRet0() | 0);
 $403 = (___muldi3(($345|0),($346|0),-997805,-1)|0);
 $404 = (getTempRet0() | 0);
 $405 = (_i64Add(($381|0),($382|0),($403|0),($404|0))|0);
 $406 = (getTempRet0() | 0);
 $407 = (___muldi3(($345|0),($346|0),136657,0)|0);
 $408 = (getTempRet0() | 0);
 $409 = (_i64Add(($385|0),($386|0),($407|0),($408|0))|0);
 $410 = (getTempRet0() | 0);
 $411 = (___muldi3(($345|0),($346|0),-683901,-1)|0);
 $412 = (getTempRet0() | 0);
 $413 = (_i64Add(($310|0),($311|0),($207|0),($208|0))|0);
 $414 = (getTempRet0() | 0);
 $415 = (_i64Subtract(($413|0),($414|0),($253|0),($240|0))|0);
 $416 = (getTempRet0() | 0);
 $417 = (_i64Add(($415|0),($416|0),($359|0),($360|0))|0);
 $418 = (getTempRet0() | 0);
 $419 = (_i64Add(($417|0),($418|0),($387|0),($388|0))|0);
 $420 = (getTempRet0() | 0);
 $421 = (_i64Add(($419|0),($420|0),($411|0),($412|0))|0);
 $422 = (getTempRet0() | 0);
 $423 = (___muldi3(($333|0),($334|0),666643,0)|0);
 $424 = (getTempRet0() | 0);
 $425 = (_i64Add(($423|0),($424|0),($12|0),0)|0);
 $426 = (getTempRet0() | 0);
 $427 = (___muldi3(($333|0),($334|0),470296,0)|0);
 $428 = (getTempRet0() | 0);
 $429 = (_i64Add(($393|0),($394|0),($427|0),($428|0))|0);
 $430 = (getTempRet0() | 0);
 $431 = (___muldi3(($333|0),($334|0),654183,0)|0);
 $432 = (getTempRet0() | 0);
 $433 = (_i64Add(($397|0),($398|0),($431|0),($432|0))|0);
 $434 = (getTempRet0() | 0);
 $435 = (___muldi3(($333|0),($334|0),-997805,-1)|0);
 $436 = (getTempRet0() | 0);
 $437 = (_i64Add(($401|0),($402|0),($435|0),($436|0))|0);
 $438 = (getTempRet0() | 0);
 $439 = (___muldi3(($333|0),($334|0),136657,0)|0);
 $440 = (getTempRet0() | 0);
 $441 = (_i64Add(($405|0),($406|0),($439|0),($440|0))|0);
 $442 = (getTempRet0() | 0);
 $443 = (___muldi3(($333|0),($334|0),-683901,-1)|0);
 $444 = (getTempRet0() | 0);
 $445 = (_i64Add(($409|0),($410|0),($443|0),($444|0))|0);
 $446 = (getTempRet0() | 0);
 $447 = (___muldi3(($336|0),($337|0),666643,0)|0);
 $448 = (getTempRet0() | 0);
 $449 = (_i64Add(($447|0),($448|0),($7|0),0)|0);
 $450 = (getTempRet0() | 0);
 $451 = (___muldi3(($336|0),($337|0),470296,0)|0);
 $452 = (getTempRet0() | 0);
 $453 = (_i64Add(($425|0),($426|0),($451|0),($452|0))|0);
 $454 = (getTempRet0() | 0);
 $455 = (___muldi3(($336|0),($337|0),654183,0)|0);
 $456 = (getTempRet0() | 0);
 $457 = (_i64Add(($429|0),($430|0),($455|0),($456|0))|0);
 $458 = (getTempRet0() | 0);
 $459 = (___muldi3(($336|0),($337|0),-997805,-1)|0);
 $460 = (getTempRet0() | 0);
 $461 = (_i64Add(($433|0),($434|0),($459|0),($460|0))|0);
 $462 = (getTempRet0() | 0);
 $463 = (___muldi3(($336|0),($337|0),136657,0)|0);
 $464 = (getTempRet0() | 0);
 $465 = (_i64Add(($437|0),($438|0),($463|0),($464|0))|0);
 $466 = (getTempRet0() | 0);
 $467 = (___muldi3(($336|0),($337|0),-683901,-1)|0);
 $468 = (getTempRet0() | 0);
 $469 = (_i64Add(($441|0),($442|0),($467|0),($468|0))|0);
 $470 = (getTempRet0() | 0);
 $471 = (___muldi3(($324|0),($325|0),666643,0)|0);
 $472 = (getTempRet0() | 0);
 $473 = (_i64Add(($471|0),($472|0),($2|0),0)|0);
 $474 = (getTempRet0() | 0);
 $475 = (___muldi3(($324|0),($325|0),470296,0)|0);
 $476 = (getTempRet0() | 0);
 $477 = (_i64Add(($449|0),($450|0),($475|0),($476|0))|0);
 $478 = (getTempRet0() | 0);
 $479 = (___muldi3(($324|0),($325|0),654183,0)|0);
 $480 = (getTempRet0() | 0);
 $481 = (_i64Add(($453|0),($454|0),($479|0),($480|0))|0);
 $482 = (getTempRet0() | 0);
 $483 = (___muldi3(($324|0),($325|0),-997805,-1)|0);
 $484 = (getTempRet0() | 0);
 $485 = (_i64Add(($457|0),($458|0),($483|0),($484|0))|0);
 $486 = (getTempRet0() | 0);
 $487 = (___muldi3(($324|0),($325|0),136657,0)|0);
 $488 = (getTempRet0() | 0);
 $489 = (_i64Add(($461|0),($462|0),($487|0),($488|0))|0);
 $490 = (getTempRet0() | 0);
 $491 = (___muldi3(($324|0),($325|0),-683901,-1)|0);
 $492 = (getTempRet0() | 0);
 $493 = (_i64Add(($465|0),($466|0),($491|0),($492|0))|0);
 $494 = (getTempRet0() | 0);
 $495 = (_i64Add(($473|0),($474|0),1048576,0)|0);
 $496 = (getTempRet0() | 0);
 $497 = (_bitshift64Ashr(($495|0),($496|0),21)|0);
 $498 = (getTempRet0() | 0);
 $499 = (_i64Add(($477|0),($478|0),($497|0),($498|0))|0);
 $500 = (getTempRet0() | 0);
 $501 = $495 & -2097152;
 $502 = (_i64Subtract(($473|0),($474|0),($501|0),($496|0))|0);
 $503 = (getTempRet0() | 0);
 $504 = (_i64Add(($481|0),($482|0),1048576,0)|0);
 $505 = (getTempRet0() | 0);
 $506 = (_bitshift64Ashr(($504|0),($505|0),21)|0);
 $507 = (getTempRet0() | 0);
 $508 = (_i64Add(($485|0),($486|0),($506|0),($507|0))|0);
 $509 = (getTempRet0() | 0);
 $510 = $504 & -2097152;
 $511 = (_i64Add(($489|0),($490|0),1048576,0)|0);
 $512 = (getTempRet0() | 0);
 $513 = (_bitshift64Ashr(($511|0),($512|0),21)|0);
 $514 = (getTempRet0() | 0);
 $515 = (_i64Add(($493|0),($494|0),($513|0),($514|0))|0);
 $516 = (getTempRet0() | 0);
 $517 = $511 & -2097152;
 $518 = (_i64Add(($469|0),($470|0),1048576,0)|0);
 $519 = (getTempRet0() | 0);
 $520 = (_bitshift64Ashr(($518|0),($519|0),21)|0);
 $521 = (getTempRet0() | 0);
 $522 = (_i64Add(($445|0),($446|0),($520|0),($521|0))|0);
 $523 = (getTempRet0() | 0);
 $524 = $518 & -2097152;
 $525 = (_i64Subtract(($469|0),($470|0),($524|0),($519|0))|0);
 $526 = (getTempRet0() | 0);
 $527 = (_i64Add(($421|0),($422|0),1048576,0)|0);
 $528 = (getTempRet0() | 0);
 $529 = (_bitshift64Ashr(($527|0),($528|0),21)|0);
 $530 = (getTempRet0() | 0);
 $531 = (_i64Add(($361|0),($362|0),($251|0),($252|0))|0);
 $532 = (getTempRet0() | 0);
 $533 = (_i64Subtract(($531|0),($532|0),($319|0),($316|0))|0);
 $534 = (getTempRet0() | 0);
 $535 = (_i64Add(($533|0),($534|0),($389|0),($390|0))|0);
 $536 = (getTempRet0() | 0);
 $537 = (_i64Add(($535|0),($536|0),($529|0),($530|0))|0);
 $538 = (getTempRet0() | 0);
 $539 = $527 & -2097152;
 $540 = (_i64Subtract(($421|0),($422|0),($539|0),($528|0))|0);
 $541 = (getTempRet0() | 0);
 $542 = (_i64Add(($369|0),($370|0),1048576,0)|0);
 $543 = (getTempRet0() | 0);
 $544 = (_bitshift64Ashr(($542|0),($543|0),21)|0);
 $545 = (getTempRet0() | 0);
 $546 = (_i64Add(($544|0),($545|0),($327|0),($328|0))|0);
 $547 = (getTempRet0() | 0);
 $548 = $542 & -2097152;
 $549 = (_i64Subtract(($369|0),($370|0),($548|0),($543|0))|0);
 $550 = (getTempRet0() | 0);
 $551 = (_i64Add(($499|0),($500|0),1048576,0)|0);
 $552 = (getTempRet0() | 0);
 $553 = (_bitshift64Ashr(($551|0),($552|0),21)|0);
 $554 = (getTempRet0() | 0);
 $555 = $551 & -2097152;
 $556 = (_i64Add(($508|0),($509|0),1048576,0)|0);
 $557 = (getTempRet0() | 0);
 $558 = (_bitshift64Ashr(($556|0),($557|0),21)|0);
 $559 = (getTempRet0() | 0);
 $560 = $556 & -2097152;
 $561 = (_i64Add(($515|0),($516|0),1048576,0)|0);
 $562 = (getTempRet0() | 0);
 $563 = (_bitshift64Ashr(($561|0),($562|0),21)|0);
 $564 = (getTempRet0() | 0);
 $565 = (_i64Add(($525|0),($526|0),($563|0),($564|0))|0);
 $566 = (getTempRet0() | 0);
 $567 = $561 & -2097152;
 $568 = (_i64Add(($522|0),($523|0),1048576,0)|0);
 $569 = (getTempRet0() | 0);
 $570 = (_bitshift64Ashr(($568|0),($569|0),21)|0);
 $571 = (getTempRet0() | 0);
 $572 = (_i64Add(($540|0),($541|0),($570|0),($571|0))|0);
 $573 = (getTempRet0() | 0);
 $574 = $568 & -2097152;
 $575 = (_i64Subtract(($522|0),($523|0),($574|0),($569|0))|0);
 $576 = (getTempRet0() | 0);
 $577 = (_i64Add(($537|0),($538|0),1048576,0)|0);
 $578 = (getTempRet0() | 0);
 $579 = (_bitshift64Ashr(($577|0),($578|0),21)|0);
 $580 = (getTempRet0() | 0);
 $581 = (_i64Add(($549|0),($550|0),($579|0),($580|0))|0);
 $582 = (getTempRet0() | 0);
 $583 = $577 & -2097152;
 $584 = (_i64Subtract(($537|0),($538|0),($583|0),($578|0))|0);
 $585 = (getTempRet0() | 0);
 $586 = (_i64Add(($546|0),($547|0),1048576,0)|0);
 $587 = (getTempRet0() | 0);
 $588 = (_bitshift64Ashr(($586|0),($587|0),21)|0);
 $589 = (getTempRet0() | 0);
 $590 = $586 & -2097152;
 $591 = (_i64Subtract(($546|0),($547|0),($590|0),($587|0))|0);
 $592 = (getTempRet0() | 0);
 $593 = (___muldi3(($588|0),($589|0),666643,0)|0);
 $594 = (getTempRet0() | 0);
 $595 = (_i64Add(($502|0),($503|0),($593|0),($594|0))|0);
 $596 = (getTempRet0() | 0);
 $597 = (___muldi3(($588|0),($589|0),470296,0)|0);
 $598 = (getTempRet0() | 0);
 $599 = (___muldi3(($588|0),($589|0),654183,0)|0);
 $600 = (getTempRet0() | 0);
 $601 = (___muldi3(($588|0),($589|0),-997805,-1)|0);
 $602 = (getTempRet0() | 0);
 $603 = (___muldi3(($588|0),($589|0),136657,0)|0);
 $604 = (getTempRet0() | 0);
 $605 = (___muldi3(($588|0),($589|0),-683901,-1)|0);
 $606 = (getTempRet0() | 0);
 $607 = (_bitshift64Ashr(($595|0),($596|0),21)|0);
 $608 = (getTempRet0() | 0);
 $609 = (_i64Add(($597|0),($598|0),($499|0),($500|0))|0);
 $610 = (getTempRet0() | 0);
 $611 = (_i64Subtract(($609|0),($610|0),($555|0),($552|0))|0);
 $612 = (getTempRet0() | 0);
 $613 = (_i64Add(($611|0),($612|0),($607|0),($608|0))|0);
 $614 = (getTempRet0() | 0);
 $615 = $595 & 2097151;
 $616 = (_bitshift64Ashr(($613|0),($614|0),21)|0);
 $617 = (getTempRet0() | 0);
 $618 = (_i64Add(($599|0),($600|0),($481|0),($482|0))|0);
 $619 = (getTempRet0() | 0);
 $620 = (_i64Subtract(($618|0),($619|0),($510|0),($505|0))|0);
 $621 = (getTempRet0() | 0);
 $622 = (_i64Add(($620|0),($621|0),($553|0),($554|0))|0);
 $623 = (getTempRet0() | 0);
 $624 = (_i64Add(($622|0),($623|0),($616|0),($617|0))|0);
 $625 = (getTempRet0() | 0);
 $626 = $613 & 2097151;
 $627 = (_bitshift64Ashr(($624|0),($625|0),21)|0);
 $628 = (getTempRet0() | 0);
 $629 = (_i64Add(($508|0),($509|0),($601|0),($602|0))|0);
 $630 = (getTempRet0() | 0);
 $631 = (_i64Subtract(($629|0),($630|0),($560|0),($557|0))|0);
 $632 = (getTempRet0() | 0);
 $633 = (_i64Add(($631|0),($632|0),($627|0),($628|0))|0);
 $634 = (getTempRet0() | 0);
 $635 = $624 & 2097151;
 $636 = (_bitshift64Ashr(($633|0),($634|0),21)|0);
 $637 = (getTempRet0() | 0);
 $638 = (_i64Add(($603|0),($604|0),($489|0),($490|0))|0);
 $639 = (getTempRet0() | 0);
 $640 = (_i64Subtract(($638|0),($639|0),($517|0),($512|0))|0);
 $641 = (getTempRet0() | 0);
 $642 = (_i64Add(($640|0),($641|0),($558|0),($559|0))|0);
 $643 = (getTempRet0() | 0);
 $644 = (_i64Add(($642|0),($643|0),($636|0),($637|0))|0);
 $645 = (getTempRet0() | 0);
 $646 = $633 & 2097151;
 $647 = (_bitshift64Ashr(($644|0),($645|0),21)|0);
 $648 = (getTempRet0() | 0);
 $649 = (_i64Add(($515|0),($516|0),($605|0),($606|0))|0);
 $650 = (getTempRet0() | 0);
 $651 = (_i64Subtract(($649|0),($650|0),($567|0),($562|0))|0);
 $652 = (getTempRet0() | 0);
 $653 = (_i64Add(($651|0),($652|0),($647|0),($648|0))|0);
 $654 = (getTempRet0() | 0);
 $655 = $644 & 2097151;
 $656 = (_bitshift64Ashr(($653|0),($654|0),21)|0);
 $657 = (getTempRet0() | 0);
 $658 = (_i64Add(($565|0),($566|0),($656|0),($657|0))|0);
 $659 = (getTempRet0() | 0);
 $660 = $653 & 2097151;
 $661 = (_bitshift64Ashr(($658|0),($659|0),21)|0);
 $662 = (getTempRet0() | 0);
 $663 = (_i64Add(($661|0),($662|0),($575|0),($576|0))|0);
 $664 = (getTempRet0() | 0);
 $665 = $658 & 2097151;
 $666 = (_bitshift64Ashr(($663|0),($664|0),21)|0);
 $667 = (getTempRet0() | 0);
 $668 = (_i64Add(($572|0),($573|0),($666|0),($667|0))|0);
 $669 = (getTempRet0() | 0);
 $670 = $663 & 2097151;
 $671 = (_bitshift64Ashr(($668|0),($669|0),21)|0);
 $672 = (getTempRet0() | 0);
 $673 = (_i64Add(($671|0),($672|0),($584|0),($585|0))|0);
 $674 = (getTempRet0() | 0);
 $675 = $668 & 2097151;
 $676 = (_bitshift64Ashr(($673|0),($674|0),21)|0);
 $677 = (getTempRet0() | 0);
 $678 = (_i64Add(($581|0),($582|0),($676|0),($677|0))|0);
 $679 = (getTempRet0() | 0);
 $680 = $673 & 2097151;
 $681 = (_bitshift64Ashr(($678|0),($679|0),21)|0);
 $682 = (getTempRet0() | 0);
 $683 = (_i64Add(($681|0),($682|0),($591|0),($592|0))|0);
 $684 = (getTempRet0() | 0);
 $685 = $678 & 2097151;
 $686 = (_bitshift64Ashr(($683|0),($684|0),21)|0);
 $687 = (getTempRet0() | 0);
 $688 = $683 & 2097151;
 $689 = (___muldi3(($686|0),($687|0),666643,0)|0);
 $690 = (getTempRet0() | 0);
 $691 = (_i64Add(($689|0),($690|0),($615|0),0)|0);
 $692 = (getTempRet0() | 0);
 $693 = (___muldi3(($686|0),($687|0),470296,0)|0);
 $694 = (getTempRet0() | 0);
 $695 = (_i64Add(($693|0),($694|0),($626|0),0)|0);
 $696 = (getTempRet0() | 0);
 $697 = (___muldi3(($686|0),($687|0),654183,0)|0);
 $698 = (getTempRet0() | 0);
 $699 = (_i64Add(($697|0),($698|0),($635|0),0)|0);
 $700 = (getTempRet0() | 0);
 $701 = (___muldi3(($686|0),($687|0),-997805,-1)|0);
 $702 = (getTempRet0() | 0);
 $703 = (_i64Add(($701|0),($702|0),($646|0),0)|0);
 $704 = (getTempRet0() | 0);
 $705 = (___muldi3(($686|0),($687|0),136657,0)|0);
 $706 = (getTempRet0() | 0);
 $707 = (_i64Add(($705|0),($706|0),($655|0),0)|0);
 $708 = (getTempRet0() | 0);
 $709 = (___muldi3(($686|0),($687|0),-683901,-1)|0);
 $710 = (getTempRet0() | 0);
 $711 = (_i64Add(($709|0),($710|0),($660|0),0)|0);
 $712 = (getTempRet0() | 0);
 $713 = (_bitshift64Ashr(($691|0),($692|0),21)|0);
 $714 = (getTempRet0() | 0);
 $715 = (_i64Add(($695|0),($696|0),($713|0),($714|0))|0);
 $716 = (getTempRet0() | 0);
 $717 = (_bitshift64Ashr(($715|0),($716|0),21)|0);
 $718 = (getTempRet0() | 0);
 $719 = (_i64Add(($699|0),($700|0),($717|0),($718|0))|0);
 $720 = (getTempRet0() | 0);
 $721 = $715 & 2097151;
 $722 = (_bitshift64Ashr(($719|0),($720|0),21)|0);
 $723 = (getTempRet0() | 0);
 $724 = (_i64Add(($703|0),($704|0),($722|0),($723|0))|0);
 $725 = (getTempRet0() | 0);
 $726 = $719 & 2097151;
 $727 = (_bitshift64Ashr(($724|0),($725|0),21)|0);
 $728 = (getTempRet0() | 0);
 $729 = (_i64Add(($707|0),($708|0),($727|0),($728|0))|0);
 $730 = (getTempRet0() | 0);
 $731 = $724 & 2097151;
 $732 = (_bitshift64Ashr(($729|0),($730|0),21)|0);
 $733 = (getTempRet0() | 0);
 $734 = (_i64Add(($711|0),($712|0),($732|0),($733|0))|0);
 $735 = (getTempRet0() | 0);
 $736 = $729 & 2097151;
 $737 = (_bitshift64Ashr(($734|0),($735|0),21)|0);
 $738 = (getTempRet0() | 0);
 $739 = (_i64Add(($737|0),($738|0),($665|0),0)|0);
 $740 = (getTempRet0() | 0);
 $741 = $734 & 2097151;
 $742 = (_bitshift64Ashr(($739|0),($740|0),21)|0);
 $743 = (getTempRet0() | 0);
 $744 = (_i64Add(($742|0),($743|0),($670|0),0)|0);
 $745 = (getTempRet0() | 0);
 $746 = $739 & 2097151;
 $747 = (_bitshift64Ashr(($744|0),($745|0),21)|0);
 $748 = (getTempRet0() | 0);
 $749 = (_i64Add(($747|0),($748|0),($675|0),0)|0);
 $750 = (getTempRet0() | 0);
 $751 = (_bitshift64Ashr(($749|0),($750|0),21)|0);
 $752 = (getTempRet0() | 0);
 $753 = (_i64Add(($751|0),($752|0),($680|0),0)|0);
 $754 = (getTempRet0() | 0);
 $755 = (_bitshift64Ashr(($753|0),($754|0),21)|0);
 $756 = (getTempRet0() | 0);
 $757 = (_i64Add(($755|0),($756|0),($685|0),0)|0);
 $758 = (getTempRet0() | 0);
 $759 = $753 & 2097151;
 $760 = (_bitshift64Ashr(($757|0),($758|0),21)|0);
 $761 = (getTempRet0() | 0);
 $762 = (_i64Add(($760|0),($761|0),($688|0),0)|0);
 $763 = (getTempRet0() | 0);
 $764 = $757 & 2097151;
 $765 = $691&255;
 HEAP8[$s>>0] = $765;
 $766 = (_bitshift64Lshr(($691|0),($692|0),8)|0);
 $767 = (getTempRet0() | 0);
 $768 = $766&255;
 $arrayidx462 = ((($s)) + 1|0);
 HEAP8[$arrayidx462>>0] = $768;
 $769 = (_bitshift64Lshr(($691|0),($692|0),16)|0);
 $770 = (getTempRet0() | 0);
 $771 = $769 & 31;
 $772 = (_bitshift64Shl(($721|0),0,5)|0);
 $773 = (getTempRet0() | 0);
 $774 = $772 | $771;
 $775 = $774&255;
 HEAP8[$add$ptr>>0] = $775;
 $776 = (_bitshift64Lshr(($715|0),($716|0),3)|0);
 $777 = (getTempRet0() | 0);
 $778 = $776&255;
 $arrayidx469 = ((($s)) + 3|0);
 HEAP8[$arrayidx469>>0] = $778;
 $779 = (_bitshift64Lshr(($715|0),($716|0),11)|0);
 $780 = (getTempRet0() | 0);
 $781 = $779&255;
 $arrayidx472 = ((($s)) + 4|0);
 HEAP8[$arrayidx472>>0] = $781;
 $782 = (_bitshift64Lshr(($721|0),0,19)|0);
 $783 = (getTempRet0() | 0);
 $784 = (_bitshift64Shl(($726|0),0,2)|0);
 $785 = (getTempRet0() | 0);
 $786 = $784 | $782;
 $785 | $783;
 $787 = $786&255;
 HEAP8[$add$ptr3>>0] = $787;
 $788 = (_bitshift64Lshr(($719|0),($720|0),6)|0);
 $789 = (getTempRet0() | 0);
 $790 = $788&255;
 $arrayidx480 = ((($s)) + 6|0);
 HEAP8[$arrayidx480>>0] = $790;
 $791 = (_bitshift64Lshr(($726|0),0,14)|0);
 $792 = (getTempRet0() | 0);
 $793 = (_bitshift64Shl(($731|0),0,7)|0);
 $794 = (getTempRet0() | 0);
 $795 = $793 | $791;
 $794 | $792;
 $796 = $795&255;
 HEAP8[$add$ptr7>>0] = $796;
 $797 = (_bitshift64Lshr(($724|0),($725|0),1)|0);
 $798 = (getTempRet0() | 0);
 $799 = $797&255;
 $arrayidx488 = ((($s)) + 8|0);
 HEAP8[$arrayidx488>>0] = $799;
 $800 = (_bitshift64Lshr(($724|0),($725|0),9)|0);
 $801 = (getTempRet0() | 0);
 $802 = $800&255;
 $arrayidx491 = ((($s)) + 9|0);
 HEAP8[$arrayidx491>>0] = $802;
 $803 = (_bitshift64Lshr(($731|0),0,17)|0);
 $804 = (getTempRet0() | 0);
 $805 = (_bitshift64Shl(($736|0),0,4)|0);
 $806 = (getTempRet0() | 0);
 $807 = $805 | $803;
 $806 | $804;
 $808 = $807&255;
 HEAP8[$add$ptr11>>0] = $808;
 $809 = (_bitshift64Lshr(($729|0),($730|0),4)|0);
 $810 = (getTempRet0() | 0);
 $811 = $809&255;
 $arrayidx499 = ((($s)) + 11|0);
 HEAP8[$arrayidx499>>0] = $811;
 $812 = (_bitshift64Lshr(($729|0),($730|0),12)|0);
 $813 = (getTempRet0() | 0);
 $814 = $812&255;
 $arrayidx502 = ((($s)) + 12|0);
 HEAP8[$arrayidx502>>0] = $814;
 $815 = (_bitshift64Lshr(($736|0),0,20)|0);
 $816 = (getTempRet0() | 0);
 $817 = (_bitshift64Shl(($741|0),0,1)|0);
 $818 = (getTempRet0() | 0);
 $819 = $817 | $815;
 $818 | $816;
 $820 = $819&255;
 HEAP8[$add$ptr15>>0] = $820;
 $821 = (_bitshift64Lshr(($734|0),($735|0),7)|0);
 $822 = (getTempRet0() | 0);
 $823 = $821&255;
 $arrayidx510 = ((($s)) + 14|0);
 HEAP8[$arrayidx510>>0] = $823;
 $824 = (_bitshift64Lshr(($741|0),0,15)|0);
 $825 = (getTempRet0() | 0);
 $826 = (_bitshift64Shl(($746|0),0,6)|0);
 $827 = (getTempRet0() | 0);
 $828 = $826 | $824;
 $827 | $825;
 $829 = $828&255;
 HEAP8[$add$ptr19>>0] = $829;
 $830 = (_bitshift64Lshr(($739|0),($740|0),2)|0);
 $831 = (getTempRet0() | 0);
 $832 = $830&255;
 $arrayidx518 = ((($s)) + 16|0);
 HEAP8[$arrayidx518>>0] = $832;
 $833 = (_bitshift64Lshr(($739|0),($740|0),10)|0);
 $834 = (getTempRet0() | 0);
 $835 = $833&255;
 $arrayidx521 = ((($s)) + 17|0);
 HEAP8[$arrayidx521>>0] = $835;
 $836 = (_bitshift64Lshr(($746|0),0,18)|0);
 $837 = (getTempRet0() | 0);
 $838 = (_bitshift64Shl(($744|0),($745|0),3)|0);
 $839 = (getTempRet0() | 0);
 $840 = $838 | $836;
 $839 | $837;
 $841 = $840&255;
 HEAP8[$add$ptr23>>0] = $841;
 $842 = (_bitshift64Lshr(($744|0),($745|0),5)|0);
 $843 = (getTempRet0() | 0);
 $844 = $842&255;
 $arrayidx529 = ((($s)) + 19|0);
 HEAP8[$arrayidx529>>0] = $844;
 $845 = (_bitshift64Lshr(($744|0),($745|0),13)|0);
 $846 = (getTempRet0() | 0);
 $847 = $845&255;
 $arrayidx532 = ((($s)) + 20|0);
 HEAP8[$arrayidx532>>0] = $847;
 $848 = $749&255;
 HEAP8[$add$ptr27>>0] = $848;
 $849 = (_bitshift64Lshr(($749|0),($750|0),8)|0);
 $850 = (getTempRet0() | 0);
 $851 = $849&255;
 $arrayidx538 = ((($s)) + 22|0);
 HEAP8[$arrayidx538>>0] = $851;
 $852 = (_bitshift64Lshr(($749|0),($750|0),16)|0);
 $853 = (getTempRet0() | 0);
 $854 = $852 & 31;
 $855 = (_bitshift64Shl(($759|0),0,5)|0);
 $856 = (getTempRet0() | 0);
 $857 = $855 | $854;
 $858 = $857&255;
 HEAP8[$add$ptr30>>0] = $858;
 $859 = (_bitshift64Lshr(($753|0),($754|0),3)|0);
 $860 = (getTempRet0() | 0);
 $861 = $859&255;
 $arrayidx546 = ((($s)) + 24|0);
 HEAP8[$arrayidx546>>0] = $861;
 $862 = (_bitshift64Lshr(($753|0),($754|0),11)|0);
 $863 = (getTempRet0() | 0);
 $864 = $862&255;
 $arrayidx549 = ((($s)) + 25|0);
 HEAP8[$arrayidx549>>0] = $864;
 $865 = (_bitshift64Lshr(($759|0),0,19)|0);
 $866 = (getTempRet0() | 0);
 $867 = (_bitshift64Shl(($764|0),0,2)|0);
 $868 = (getTempRet0() | 0);
 $869 = $867 | $865;
 $868 | $866;
 $870 = $869&255;
 HEAP8[$add$ptr34>>0] = $870;
 $871 = (_bitshift64Lshr(($757|0),($758|0),6)|0);
 $872 = (getTempRet0() | 0);
 $873 = $871&255;
 $arrayidx557 = ((($s)) + 27|0);
 HEAP8[$arrayidx557>>0] = $873;
 $874 = (_bitshift64Lshr(($764|0),0,14)|0);
 $875 = (getTempRet0() | 0);
 $876 = (_bitshift64Shl(($762|0),($763|0),7)|0);
 $877 = (getTempRet0() | 0);
 $878 = $876 | $874;
 $877 | $875;
 $879 = $878&255;
 HEAP8[$add$ptr38>>0] = $879;
 $880 = (_bitshift64Lshr(($762|0),($763|0),1)|0);
 $881 = (getTempRet0() | 0);
 $882 = $880&255;
 $arrayidx565 = ((($s)) + 29|0);
 HEAP8[$arrayidx565>>0] = $882;
 $883 = (_bitshift64Lshr(($762|0),($763|0),9)|0);
 $884 = (getTempRet0() | 0);
 $885 = $883&255;
 $arrayidx568 = ((($s)) + 30|0);
 HEAP8[$arrayidx568>>0] = $885;
 $886 = (_bitshift64Ashr(($762|0),($763|0),17)|0);
 $887 = (getTempRet0() | 0);
 $888 = $886&255;
 HEAP8[$add$ptr42>>0] = $888;
 return;
}
function _load_3_17($in) {
 $in = $in|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $arrayidx1 = 0, $arrayidx3 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP8[$in>>0]|0;
 $1 = $0&255;
 $arrayidx1 = ((($in)) + 1|0);
 $2 = HEAP8[$arrayidx1>>0]|0;
 $3 = $2&255;
 $4 = (_bitshift64Shl(($3|0),0,8)|0);
 $5 = (getTempRet0() | 0);
 $6 = $4 | $1;
 $arrayidx3 = ((($in)) + 2|0);
 $7 = HEAP8[$arrayidx3>>0]|0;
 $8 = $7&255;
 $9 = (_bitshift64Shl(($8|0),0,16)|0);
 $10 = (getTempRet0() | 0);
 $11 = $6 | $9;
 $12 = $5 | $10;
 setTempRet0(($12) | 0);
 return ($11|0);
}
function _load_4_18($in) {
 $in = $in|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $2 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $arrayidx1 = 0;
 var $arrayidx3 = 0, $arrayidx7 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP8[$in>>0]|0;
 $1 = $0&255;
 $arrayidx1 = ((($in)) + 1|0);
 $2 = HEAP8[$arrayidx1>>0]|0;
 $3 = $2&255;
 $4 = (_bitshift64Shl(($3|0),0,8)|0);
 $5 = (getTempRet0() | 0);
 $6 = $4 | $1;
 $arrayidx3 = ((($in)) + 2|0);
 $7 = HEAP8[$arrayidx3>>0]|0;
 $8 = $7&255;
 $9 = (_bitshift64Shl(($8|0),0,16)|0);
 $10 = (getTempRet0() | 0);
 $11 = $6 | $9;
 $12 = $5 | $10;
 $arrayidx7 = ((($in)) + 3|0);
 $13 = HEAP8[$arrayidx7>>0]|0;
 $14 = $13&255;
 $15 = (_bitshift64Shl(($14|0),0,24)|0);
 $16 = (getTempRet0() | 0);
 $17 = $11 | $15;
 $18 = $12 | $16;
 setTempRet0(($18) | 0);
 return ($17|0);
}
function _sc_muladd($s,$a,$b,$c) {
 $s = $s|0;
 $a = $a|0;
 $b = $b|0;
 $c = $c|0;
 var $0 = 0, $1 = 0, $10 = 0, $100 = 0, $1000 = 0, $1001 = 0, $1002 = 0, $1003 = 0, $1004 = 0, $1005 = 0, $1006 = 0, $1007 = 0, $1008 = 0, $1009 = 0, $101 = 0, $1010 = 0, $1011 = 0, $1012 = 0, $1013 = 0, $1014 = 0;
 var $1015 = 0, $1016 = 0, $1017 = 0, $1018 = 0, $1019 = 0, $102 = 0, $1020 = 0, $1021 = 0, $1022 = 0, $1023 = 0, $1024 = 0, $1025 = 0, $1026 = 0, $1027 = 0, $1028 = 0, $1029 = 0, $103 = 0, $1030 = 0, $1031 = 0, $1032 = 0;
 var $1033 = 0, $1034 = 0, $1035 = 0, $1036 = 0, $1037 = 0, $1038 = 0, $1039 = 0, $104 = 0, $1040 = 0, $1041 = 0, $1042 = 0, $1043 = 0, $1044 = 0, $1045 = 0, $1046 = 0, $1047 = 0, $1048 = 0, $1049 = 0, $105 = 0, $1050 = 0;
 var $1051 = 0, $1052 = 0, $1053 = 0, $1054 = 0, $1055 = 0, $1056 = 0, $1057 = 0, $1058 = 0, $1059 = 0, $106 = 0, $1060 = 0, $1061 = 0, $1062 = 0, $1063 = 0, $1064 = 0, $1065 = 0, $1066 = 0, $1067 = 0, $1068 = 0, $1069 = 0;
 var $107 = 0, $1070 = 0, $1071 = 0, $1072 = 0, $1073 = 0, $1074 = 0, $1075 = 0, $1076 = 0, $1077 = 0, $1078 = 0, $1079 = 0, $108 = 0, $1080 = 0, $1081 = 0, $1082 = 0, $1083 = 0, $1084 = 0, $1085 = 0, $1086 = 0, $1087 = 0;
 var $1088 = 0, $1089 = 0, $109 = 0, $1090 = 0, $1091 = 0, $1092 = 0, $1093 = 0, $1094 = 0, $1095 = 0, $1096 = 0, $1097 = 0, $1098 = 0, $1099 = 0, $11 = 0, $110 = 0, $1100 = 0, $1101 = 0, $1102 = 0, $1103 = 0, $1104 = 0;
 var $1105 = 0, $1106 = 0, $1107 = 0, $1108 = 0, $1109 = 0, $111 = 0, $1110 = 0, $1111 = 0, $1112 = 0, $1113 = 0, $1114 = 0, $1115 = 0, $1116 = 0, $1117 = 0, $1118 = 0, $1119 = 0, $112 = 0, $1120 = 0, $1121 = 0, $1122 = 0;
 var $1123 = 0, $1124 = 0, $1125 = 0, $1126 = 0, $1127 = 0, $1128 = 0, $1129 = 0, $113 = 0, $1130 = 0, $1131 = 0, $1132 = 0, $1133 = 0, $1134 = 0, $1135 = 0, $1136 = 0, $1137 = 0, $1138 = 0, $1139 = 0, $114 = 0, $1140 = 0;
 var $1141 = 0, $1142 = 0, $1143 = 0, $1144 = 0, $1145 = 0, $1146 = 0, $1147 = 0, $1148 = 0, $1149 = 0, $115 = 0, $1150 = 0, $1151 = 0, $1152 = 0, $1153 = 0, $1154 = 0, $1155 = 0, $1156 = 0, $1157 = 0, $1158 = 0, $1159 = 0;
 var $116 = 0, $1160 = 0, $1161 = 0, $1162 = 0, $1163 = 0, $1164 = 0, $1165 = 0, $1166 = 0, $1167 = 0, $1168 = 0, $1169 = 0, $117 = 0, $1170 = 0, $1171 = 0, $1172 = 0, $1173 = 0, $1174 = 0, $1175 = 0, $1176 = 0, $1177 = 0;
 var $1178 = 0, $1179 = 0, $118 = 0, $1180 = 0, $1181 = 0, $1182 = 0, $1183 = 0, $1184 = 0, $1185 = 0, $1186 = 0, $1187 = 0, $1188 = 0, $1189 = 0, $119 = 0, $1190 = 0, $1191 = 0, $1192 = 0, $1193 = 0, $1194 = 0, $1195 = 0;
 var $1196 = 0, $1197 = 0, $1198 = 0, $1199 = 0, $12 = 0, $120 = 0, $1200 = 0, $1201 = 0, $1202 = 0, $1203 = 0, $1204 = 0, $1205 = 0, $1206 = 0, $1207 = 0, $1208 = 0, $1209 = 0, $121 = 0, $1210 = 0, $1211 = 0, $1212 = 0;
 var $1213 = 0, $1214 = 0, $1215 = 0, $1216 = 0, $1217 = 0, $1218 = 0, $1219 = 0, $122 = 0, $1220 = 0, $1221 = 0, $1222 = 0, $1223 = 0, $1224 = 0, $1225 = 0, $1226 = 0, $1227 = 0, $1228 = 0, $1229 = 0, $123 = 0, $1230 = 0;
 var $1231 = 0, $1232 = 0, $1233 = 0, $1234 = 0, $1235 = 0, $1236 = 0, $1237 = 0, $1238 = 0, $1239 = 0, $124 = 0, $1240 = 0, $1241 = 0, $1242 = 0, $1243 = 0, $1244 = 0, $1245 = 0, $1246 = 0, $1247 = 0, $1248 = 0, $1249 = 0;
 var $125 = 0, $1250 = 0, $1251 = 0, $1252 = 0, $1253 = 0, $1254 = 0, $1255 = 0, $1256 = 0, $1257 = 0, $1258 = 0, $1259 = 0, $126 = 0, $1260 = 0, $1261 = 0, $1262 = 0, $1263 = 0, $1264 = 0, $1265 = 0, $1266 = 0, $1267 = 0;
 var $1268 = 0, $1269 = 0, $127 = 0, $1270 = 0, $1271 = 0, $1272 = 0, $1273 = 0, $1274 = 0, $1275 = 0, $1276 = 0, $1277 = 0, $1278 = 0, $1279 = 0, $128 = 0, $1280 = 0, $1281 = 0, $1282 = 0, $1283 = 0, $1284 = 0, $1285 = 0;
 var $1286 = 0, $1287 = 0, $1288 = 0, $1289 = 0, $129 = 0, $1290 = 0, $1291 = 0, $1292 = 0, $1293 = 0, $1294 = 0, $1295 = 0, $1296 = 0, $1297 = 0, $1298 = 0, $1299 = 0, $13 = 0, $130 = 0, $1300 = 0, $1301 = 0, $1302 = 0;
 var $1303 = 0, $1304 = 0, $1305 = 0, $1306 = 0, $1307 = 0, $1308 = 0, $1309 = 0, $131 = 0, $1310 = 0, $1311 = 0, $1312 = 0, $1313 = 0, $1314 = 0, $1315 = 0, $1316 = 0, $1317 = 0, $1318 = 0, $1319 = 0, $132 = 0, $1320 = 0;
 var $1321 = 0, $1322 = 0, $1323 = 0, $1324 = 0, $1325 = 0, $1326 = 0, $1327 = 0, $1328 = 0, $1329 = 0, $133 = 0, $1330 = 0, $1331 = 0, $1332 = 0, $1333 = 0, $1334 = 0, $1335 = 0, $1336 = 0, $1337 = 0, $1338 = 0, $1339 = 0;
 var $134 = 0, $1340 = 0, $1341 = 0, $1342 = 0, $1343 = 0, $1344 = 0, $1345 = 0, $1346 = 0, $1347 = 0, $1348 = 0, $1349 = 0, $135 = 0, $1350 = 0, $1351 = 0, $1352 = 0, $1353 = 0, $1354 = 0, $1355 = 0, $1356 = 0, $1357 = 0;
 var $1358 = 0, $1359 = 0, $136 = 0, $1360 = 0, $1361 = 0, $1362 = 0, $1363 = 0, $1364 = 0, $1365 = 0, $1366 = 0, $1367 = 0, $1368 = 0, $1369 = 0, $137 = 0, $1370 = 0, $1371 = 0, $1372 = 0, $1373 = 0, $1374 = 0, $1375 = 0;
 var $1376 = 0, $1377 = 0, $1378 = 0, $1379 = 0, $138 = 0, $1380 = 0, $1381 = 0, $1382 = 0, $1383 = 0, $1384 = 0, $1385 = 0, $1386 = 0, $1387 = 0, $1388 = 0, $1389 = 0, $139 = 0, $1390 = 0, $1391 = 0, $1392 = 0, $1393 = 0;
 var $1394 = 0, $1395 = 0, $1396 = 0, $1397 = 0, $1398 = 0, $1399 = 0, $14 = 0, $140 = 0, $1400 = 0, $1401 = 0, $1402 = 0, $1403 = 0, $1404 = 0, $1405 = 0, $1406 = 0, $1407 = 0, $1408 = 0, $1409 = 0, $141 = 0, $1410 = 0;
 var $1411 = 0, $1412 = 0, $1413 = 0, $1414 = 0, $1415 = 0, $1416 = 0, $1417 = 0, $1418 = 0, $1419 = 0, $142 = 0, $1420 = 0, $1421 = 0, $1422 = 0, $1423 = 0, $1424 = 0, $1425 = 0, $1426 = 0, $1427 = 0, $1428 = 0, $1429 = 0;
 var $143 = 0, $1430 = 0, $1431 = 0, $1432 = 0, $1433 = 0, $1434 = 0, $1435 = 0, $1436 = 0, $1437 = 0, $1438 = 0, $1439 = 0, $144 = 0, $1440 = 0, $1441 = 0, $1442 = 0, $1443 = 0, $1444 = 0, $1445 = 0, $1446 = 0, $1447 = 0;
 var $1448 = 0, $1449 = 0, $145 = 0, $1450 = 0, $1451 = 0, $1452 = 0, $1453 = 0, $1454 = 0, $1455 = 0, $1456 = 0, $1457 = 0, $1458 = 0, $1459 = 0, $146 = 0, $1460 = 0, $1461 = 0, $1462 = 0, $1463 = 0, $1464 = 0, $1465 = 0;
 var $1466 = 0, $1467 = 0, $1468 = 0, $1469 = 0, $147 = 0, $1470 = 0, $1471 = 0, $1472 = 0, $1473 = 0, $1474 = 0, $1475 = 0, $1476 = 0, $1477 = 0, $1478 = 0, $1479 = 0, $148 = 0, $1480 = 0, $1481 = 0, $1482 = 0, $1483 = 0;
 var $1484 = 0, $1485 = 0, $1486 = 0, $1487 = 0, $1488 = 0, $1489 = 0, $149 = 0, $1490 = 0, $1491 = 0, $1492 = 0, $1493 = 0, $1494 = 0, $1495 = 0, $1496 = 0, $1497 = 0, $1498 = 0, $1499 = 0, $15 = 0, $150 = 0, $1500 = 0;
 var $1501 = 0, $1502 = 0, $1503 = 0, $1504 = 0, $1505 = 0, $1506 = 0, $1507 = 0, $1508 = 0, $1509 = 0, $151 = 0, $1510 = 0, $1511 = 0, $1512 = 0, $1513 = 0, $1514 = 0, $1515 = 0, $1516 = 0, $1517 = 0, $1518 = 0, $1519 = 0;
 var $152 = 0, $1520 = 0, $1521 = 0, $1522 = 0, $1523 = 0, $1524 = 0, $1525 = 0, $1526 = 0, $1527 = 0, $1528 = 0, $1529 = 0, $153 = 0, $1530 = 0, $1531 = 0, $1532 = 0, $1533 = 0, $1534 = 0, $1535 = 0, $1536 = 0, $1537 = 0;
 var $1538 = 0, $1539 = 0, $154 = 0, $1540 = 0, $1541 = 0, $1542 = 0, $1543 = 0, $1544 = 0, $1545 = 0, $1546 = 0, $1547 = 0, $1548 = 0, $1549 = 0, $155 = 0, $1550 = 0, $1551 = 0, $1552 = 0, $1553 = 0, $1554 = 0, $1555 = 0;
 var $1556 = 0, $1557 = 0, $1558 = 0, $1559 = 0, $156 = 0, $1560 = 0, $1561 = 0, $1562 = 0, $1563 = 0, $1564 = 0, $1565 = 0, $1566 = 0, $1567 = 0, $1568 = 0, $1569 = 0, $157 = 0, $1570 = 0, $1571 = 0, $1572 = 0, $1573 = 0;
 var $1574 = 0, $1575 = 0, $1576 = 0, $1577 = 0, $1578 = 0, $1579 = 0, $158 = 0, $1580 = 0, $1581 = 0, $1582 = 0, $1583 = 0, $1584 = 0, $1585 = 0, $1586 = 0, $1587 = 0, $1588 = 0, $1589 = 0, $159 = 0, $1590 = 0, $1591 = 0;
 var $1592 = 0, $1593 = 0, $1594 = 0, $1595 = 0, $1596 = 0, $1597 = 0, $1598 = 0, $1599 = 0, $16 = 0, $160 = 0, $1600 = 0, $1601 = 0, $1602 = 0, $1603 = 0, $1604 = 0, $1605 = 0, $1606 = 0, $1607 = 0, $1608 = 0, $1609 = 0;
 var $161 = 0, $1610 = 0, $1611 = 0, $1612 = 0, $1613 = 0, $1614 = 0, $1615 = 0, $1616 = 0, $1617 = 0, $1618 = 0, $1619 = 0, $162 = 0, $1620 = 0, $1621 = 0, $1622 = 0, $1623 = 0, $1624 = 0, $1625 = 0, $1626 = 0, $1627 = 0;
 var $1628 = 0, $1629 = 0, $163 = 0, $1630 = 0, $1631 = 0, $1632 = 0, $1633 = 0, $1634 = 0, $1635 = 0, $1636 = 0, $1637 = 0, $1638 = 0, $1639 = 0, $164 = 0, $1640 = 0, $1641 = 0, $1642 = 0, $1643 = 0, $1644 = 0, $1645 = 0;
 var $1646 = 0, $1647 = 0, $1648 = 0, $1649 = 0, $165 = 0, $1650 = 0, $1651 = 0, $1652 = 0, $1653 = 0, $1654 = 0, $1655 = 0, $1656 = 0, $1657 = 0, $1658 = 0, $1659 = 0, $166 = 0, $1660 = 0, $1661 = 0, $1662 = 0, $1663 = 0;
 var $1664 = 0, $1665 = 0, $1666 = 0, $1667 = 0, $1668 = 0, $1669 = 0, $167 = 0, $1670 = 0, $1671 = 0, $1672 = 0, $1673 = 0, $1674 = 0, $1675 = 0, $1676 = 0, $1677 = 0, $1678 = 0, $1679 = 0, $168 = 0, $1680 = 0, $1681 = 0;
 var $1682 = 0, $1683 = 0, $1684 = 0, $1685 = 0, $1686 = 0, $1687 = 0, $1688 = 0, $1689 = 0, $169 = 0, $1690 = 0, $1691 = 0, $1692 = 0, $1693 = 0, $1694 = 0, $1695 = 0, $1696 = 0, $1697 = 0, $1698 = 0, $1699 = 0, $17 = 0;
 var $170 = 0, $1700 = 0, $1701 = 0, $1702 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0, $183 = 0, $184 = 0, $185 = 0;
 var $186 = 0, $187 = 0, $188 = 0, $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0, $200 = 0, $201 = 0, $202 = 0;
 var $203 = 0, $204 = 0, $205 = 0, $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0, $219 = 0, $22 = 0, $220 = 0;
 var $221 = 0, $222 = 0, $223 = 0, $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0, $237 = 0, $238 = 0, $239 = 0;
 var $24 = 0, $240 = 0, $241 = 0, $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0, $255 = 0, $256 = 0, $257 = 0;
 var $258 = 0, $259 = 0, $26 = 0, $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0, $273 = 0, $274 = 0, $275 = 0;
 var $276 = 0, $277 = 0, $278 = 0, $279 = 0, $28 = 0, $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $285 = 0, $286 = 0, $287 = 0, $288 = 0, $289 = 0, $29 = 0, $290 = 0, $291 = 0, $292 = 0, $293 = 0;
 var $294 = 0, $295 = 0, $296 = 0, $297 = 0, $298 = 0, $299 = 0, $3 = 0, $30 = 0, $300 = 0, $301 = 0, $302 = 0, $303 = 0, $304 = 0, $305 = 0, $306 = 0, $307 = 0, $308 = 0, $309 = 0, $31 = 0, $310 = 0;
 var $311 = 0, $312 = 0, $313 = 0, $314 = 0, $315 = 0, $316 = 0, $317 = 0, $318 = 0, $319 = 0, $32 = 0, $320 = 0, $321 = 0, $322 = 0, $323 = 0, $324 = 0, $325 = 0, $326 = 0, $327 = 0, $328 = 0, $329 = 0;
 var $33 = 0, $330 = 0, $331 = 0, $332 = 0, $333 = 0, $334 = 0, $335 = 0, $336 = 0, $337 = 0, $338 = 0, $339 = 0, $34 = 0, $340 = 0, $341 = 0, $342 = 0, $343 = 0, $344 = 0, $345 = 0, $346 = 0, $347 = 0;
 var $348 = 0, $349 = 0, $35 = 0, $350 = 0, $351 = 0, $352 = 0, $353 = 0, $354 = 0, $355 = 0, $356 = 0, $357 = 0, $358 = 0, $359 = 0, $36 = 0, $360 = 0, $361 = 0, $362 = 0, $363 = 0, $364 = 0, $365 = 0;
 var $366 = 0, $367 = 0, $368 = 0, $369 = 0, $37 = 0, $370 = 0, $371 = 0, $372 = 0, $373 = 0, $374 = 0, $375 = 0, $376 = 0, $377 = 0, $378 = 0, $379 = 0, $38 = 0, $380 = 0, $381 = 0, $382 = 0, $383 = 0;
 var $384 = 0, $385 = 0, $386 = 0, $387 = 0, $388 = 0, $389 = 0, $39 = 0, $390 = 0, $391 = 0, $392 = 0, $393 = 0, $394 = 0, $395 = 0, $396 = 0, $397 = 0, $398 = 0, $399 = 0, $4 = 0, $40 = 0, $400 = 0;
 var $401 = 0, $402 = 0, $403 = 0, $404 = 0, $405 = 0, $406 = 0, $407 = 0, $408 = 0, $409 = 0, $41 = 0, $410 = 0, $411 = 0, $412 = 0, $413 = 0, $414 = 0, $415 = 0, $416 = 0, $417 = 0, $418 = 0, $419 = 0;
 var $42 = 0, $420 = 0, $421 = 0, $422 = 0, $423 = 0, $424 = 0, $425 = 0, $426 = 0, $427 = 0, $428 = 0, $429 = 0, $43 = 0, $430 = 0, $431 = 0, $432 = 0, $433 = 0, $434 = 0, $435 = 0, $436 = 0, $437 = 0;
 var $438 = 0, $439 = 0, $44 = 0, $440 = 0, $441 = 0, $442 = 0, $443 = 0, $444 = 0, $445 = 0, $446 = 0, $447 = 0, $448 = 0, $449 = 0, $45 = 0, $450 = 0, $451 = 0, $452 = 0, $453 = 0, $454 = 0, $455 = 0;
 var $456 = 0, $457 = 0, $458 = 0, $459 = 0, $46 = 0, $460 = 0, $461 = 0, $462 = 0, $463 = 0, $464 = 0, $465 = 0, $466 = 0, $467 = 0, $468 = 0, $469 = 0, $47 = 0, $470 = 0, $471 = 0, $472 = 0, $473 = 0;
 var $474 = 0, $475 = 0, $476 = 0, $477 = 0, $478 = 0, $479 = 0, $48 = 0, $480 = 0, $481 = 0, $482 = 0, $483 = 0, $484 = 0, $485 = 0, $486 = 0, $487 = 0, $488 = 0, $489 = 0, $49 = 0, $490 = 0, $491 = 0;
 var $492 = 0, $493 = 0, $494 = 0, $495 = 0, $496 = 0, $497 = 0, $498 = 0, $499 = 0, $5 = 0, $50 = 0, $500 = 0, $501 = 0, $502 = 0, $503 = 0, $504 = 0, $505 = 0, $506 = 0, $507 = 0, $508 = 0, $509 = 0;
 var $51 = 0, $510 = 0, $511 = 0, $512 = 0, $513 = 0, $514 = 0, $515 = 0, $516 = 0, $517 = 0, $518 = 0, $519 = 0, $52 = 0, $520 = 0, $521 = 0, $522 = 0, $523 = 0, $524 = 0, $525 = 0, $526 = 0, $527 = 0;
 var $528 = 0, $529 = 0, $53 = 0, $530 = 0, $531 = 0, $532 = 0, $533 = 0, $534 = 0, $535 = 0, $536 = 0, $537 = 0, $538 = 0, $539 = 0, $54 = 0, $540 = 0, $541 = 0, $542 = 0, $543 = 0, $544 = 0, $545 = 0;
 var $546 = 0, $547 = 0, $548 = 0, $549 = 0, $55 = 0, $550 = 0, $551 = 0, $552 = 0, $553 = 0, $554 = 0, $555 = 0, $556 = 0, $557 = 0, $558 = 0, $559 = 0, $56 = 0, $560 = 0, $561 = 0, $562 = 0, $563 = 0;
 var $564 = 0, $565 = 0, $566 = 0, $567 = 0, $568 = 0, $569 = 0, $57 = 0, $570 = 0, $571 = 0, $572 = 0, $573 = 0, $574 = 0, $575 = 0, $576 = 0, $577 = 0, $578 = 0, $579 = 0, $58 = 0, $580 = 0, $581 = 0;
 var $582 = 0, $583 = 0, $584 = 0, $585 = 0, $586 = 0, $587 = 0, $588 = 0, $589 = 0, $59 = 0, $590 = 0, $591 = 0, $592 = 0, $593 = 0, $594 = 0, $595 = 0, $596 = 0, $597 = 0, $598 = 0, $599 = 0, $6 = 0;
 var $60 = 0, $600 = 0, $601 = 0, $602 = 0, $603 = 0, $604 = 0, $605 = 0, $606 = 0, $607 = 0, $608 = 0, $609 = 0, $61 = 0, $610 = 0, $611 = 0, $612 = 0, $613 = 0, $614 = 0, $615 = 0, $616 = 0, $617 = 0;
 var $618 = 0, $619 = 0, $62 = 0, $620 = 0, $621 = 0, $622 = 0, $623 = 0, $624 = 0, $625 = 0, $626 = 0, $627 = 0, $628 = 0, $629 = 0, $63 = 0, $630 = 0, $631 = 0, $632 = 0, $633 = 0, $634 = 0, $635 = 0;
 var $636 = 0, $637 = 0, $638 = 0, $639 = 0, $64 = 0, $640 = 0, $641 = 0, $642 = 0, $643 = 0, $644 = 0, $645 = 0, $646 = 0, $647 = 0, $648 = 0, $649 = 0, $65 = 0, $650 = 0, $651 = 0, $652 = 0, $653 = 0;
 var $654 = 0, $655 = 0, $656 = 0, $657 = 0, $658 = 0, $659 = 0, $66 = 0, $660 = 0, $661 = 0, $662 = 0, $663 = 0, $664 = 0, $665 = 0, $666 = 0, $667 = 0, $668 = 0, $669 = 0, $67 = 0, $670 = 0, $671 = 0;
 var $672 = 0, $673 = 0, $674 = 0, $675 = 0, $676 = 0, $677 = 0, $678 = 0, $679 = 0, $68 = 0, $680 = 0, $681 = 0, $682 = 0, $683 = 0, $684 = 0, $685 = 0, $686 = 0, $687 = 0, $688 = 0, $689 = 0, $69 = 0;
 var $690 = 0, $691 = 0, $692 = 0, $693 = 0, $694 = 0, $695 = 0, $696 = 0, $697 = 0, $698 = 0, $699 = 0, $7 = 0, $70 = 0, $700 = 0, $701 = 0, $702 = 0, $703 = 0, $704 = 0, $705 = 0, $706 = 0, $707 = 0;
 var $708 = 0, $709 = 0, $71 = 0, $710 = 0, $711 = 0, $712 = 0, $713 = 0, $714 = 0, $715 = 0, $716 = 0, $717 = 0, $718 = 0, $719 = 0, $72 = 0, $720 = 0, $721 = 0, $722 = 0, $723 = 0, $724 = 0, $725 = 0;
 var $726 = 0, $727 = 0, $728 = 0, $729 = 0, $73 = 0, $730 = 0, $731 = 0, $732 = 0, $733 = 0, $734 = 0, $735 = 0, $736 = 0, $737 = 0, $738 = 0, $739 = 0, $74 = 0, $740 = 0, $741 = 0, $742 = 0, $743 = 0;
 var $744 = 0, $745 = 0, $746 = 0, $747 = 0, $748 = 0, $749 = 0, $75 = 0, $750 = 0, $751 = 0, $752 = 0, $753 = 0, $754 = 0, $755 = 0, $756 = 0, $757 = 0, $758 = 0, $759 = 0, $76 = 0, $760 = 0, $761 = 0;
 var $762 = 0, $763 = 0, $764 = 0, $765 = 0, $766 = 0, $767 = 0, $768 = 0, $769 = 0, $77 = 0, $770 = 0, $771 = 0, $772 = 0, $773 = 0, $774 = 0, $775 = 0, $776 = 0, $777 = 0, $778 = 0, $779 = 0, $78 = 0;
 var $780 = 0, $781 = 0, $782 = 0, $783 = 0, $784 = 0, $785 = 0, $786 = 0, $787 = 0, $788 = 0, $789 = 0, $79 = 0, $790 = 0, $791 = 0, $792 = 0, $793 = 0, $794 = 0, $795 = 0, $796 = 0, $797 = 0, $798 = 0;
 var $799 = 0, $8 = 0, $80 = 0, $800 = 0, $801 = 0, $802 = 0, $803 = 0, $804 = 0, $805 = 0, $806 = 0, $807 = 0, $808 = 0, $809 = 0, $81 = 0, $810 = 0, $811 = 0, $812 = 0, $813 = 0, $814 = 0, $815 = 0;
 var $816 = 0, $817 = 0, $818 = 0, $819 = 0, $82 = 0, $820 = 0, $821 = 0, $822 = 0, $823 = 0, $824 = 0, $825 = 0, $826 = 0, $827 = 0, $828 = 0, $829 = 0, $83 = 0, $830 = 0, $831 = 0, $832 = 0, $833 = 0;
 var $834 = 0, $835 = 0, $836 = 0, $837 = 0, $838 = 0, $839 = 0, $84 = 0, $840 = 0, $841 = 0, $842 = 0, $843 = 0, $844 = 0, $845 = 0, $846 = 0, $847 = 0, $848 = 0, $849 = 0, $85 = 0, $850 = 0, $851 = 0;
 var $852 = 0, $853 = 0, $854 = 0, $855 = 0, $856 = 0, $857 = 0, $858 = 0, $859 = 0, $86 = 0, $860 = 0, $861 = 0, $862 = 0, $863 = 0, $864 = 0, $865 = 0, $866 = 0, $867 = 0, $868 = 0, $869 = 0, $87 = 0;
 var $870 = 0, $871 = 0, $872 = 0, $873 = 0, $874 = 0, $875 = 0, $876 = 0, $877 = 0, $878 = 0, $879 = 0, $88 = 0, $880 = 0, $881 = 0, $882 = 0, $883 = 0, $884 = 0, $885 = 0, $886 = 0, $887 = 0, $888 = 0;
 var $889 = 0, $89 = 0, $890 = 0, $891 = 0, $892 = 0, $893 = 0, $894 = 0, $895 = 0, $896 = 0, $897 = 0, $898 = 0, $899 = 0, $9 = 0, $90 = 0, $900 = 0, $901 = 0, $902 = 0, $903 = 0, $904 = 0, $905 = 0;
 var $906 = 0, $907 = 0, $908 = 0, $909 = 0, $91 = 0, $910 = 0, $911 = 0, $912 = 0, $913 = 0, $914 = 0, $915 = 0, $916 = 0, $917 = 0, $918 = 0, $919 = 0, $92 = 0, $920 = 0, $921 = 0, $922 = 0, $923 = 0;
 var $924 = 0, $925 = 0, $926 = 0, $927 = 0, $928 = 0, $929 = 0, $93 = 0, $930 = 0, $931 = 0, $932 = 0, $933 = 0, $934 = 0, $935 = 0, $936 = 0, $937 = 0, $938 = 0, $939 = 0, $94 = 0, $940 = 0, $941 = 0;
 var $942 = 0, $943 = 0, $944 = 0, $945 = 0, $946 = 0, $947 = 0, $948 = 0, $949 = 0, $95 = 0, $950 = 0, $951 = 0, $952 = 0, $953 = 0, $954 = 0, $955 = 0, $956 = 0, $957 = 0, $958 = 0, $959 = 0, $96 = 0;
 var $960 = 0, $961 = 0, $962 = 0, $963 = 0, $964 = 0, $965 = 0, $966 = 0, $967 = 0, $968 = 0, $969 = 0, $97 = 0, $970 = 0, $971 = 0, $972 = 0, $973 = 0, $974 = 0, $975 = 0, $976 = 0, $977 = 0, $978 = 0;
 var $979 = 0, $98 = 0, $980 = 0, $981 = 0, $982 = 0, $983 = 0, $984 = 0, $985 = 0, $986 = 0, $987 = 0, $988 = 0, $989 = 0, $99 = 0, $990 = 0, $991 = 0, $992 = 0, $993 = 0, $994 = 0, $995 = 0, $996 = 0;
 var $997 = 0, $998 = 0, $999 = 0, $add$ptr = 0, $add$ptr103 = 0, $add$ptr107 = 0, $add$ptr11 = 0, $add$ptr111 = 0, $add$ptr115 = 0, $add$ptr118 = 0, $add$ptr122 = 0, $add$ptr126 = 0, $add$ptr15 = 0, $add$ptr19 = 0, $add$ptr23 = 0, $add$ptr27 = 0, $add$ptr3 = 0, $add$ptr30 = 0, $add$ptr34 = 0, $add$ptr38 = 0;
 var $add$ptr43 = 0, $add$ptr47 = 0, $add$ptr51 = 0, $add$ptr55 = 0, $add$ptr59 = 0, $add$ptr63 = 0, $add$ptr67 = 0, $add$ptr7 = 0, $add$ptr71 = 0, $add$ptr74 = 0, $add$ptr78 = 0, $add$ptr82 = 0, $add$ptr87 = 0, $add$ptr91 = 0, $add$ptr95 = 0, $add$ptr99 = 0, $arrayidx1001 = 0, $arrayidx1004 = 0, $arrayidx895 = 0, $arrayidx899 = 0;
 var $arrayidx902 = 0, $arrayidx905 = 0, $arrayidx910 = 0, $arrayidx913 = 0, $arrayidx918 = 0, $arrayidx921 = 0, $arrayidx924 = 0, $arrayidx929 = 0, $arrayidx932 = 0, $arrayidx935 = 0, $arrayidx940 = 0, $arrayidx943 = 0, $arrayidx948 = 0, $arrayidx951 = 0, $arrayidx954 = 0, $arrayidx959 = 0, $arrayidx962 = 0, $arrayidx965 = 0, $arrayidx968 = 0, $arrayidx971 = 0;
 var $arrayidx976 = 0, $arrayidx979 = 0, $arrayidx982 = 0, $arrayidx987 = 0, $arrayidx990 = 0, $arrayidx995 = 0, $arrayidx998 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = (_load_3_17($a)|0);
 $1 = (getTempRet0() | 0);
 $2 = $0 & 2097151;
 $add$ptr = ((($a)) + 2|0);
 $3 = (_load_4_18($add$ptr)|0);
 $4 = (getTempRet0() | 0);
 $5 = (_bitshift64Lshr(($3|0),($4|0),5)|0);
 $6 = (getTempRet0() | 0);
 $7 = $5 & 2097151;
 $add$ptr3 = ((($a)) + 5|0);
 $8 = (_load_3_17($add$ptr3)|0);
 $9 = (getTempRet0() | 0);
 $10 = (_bitshift64Lshr(($8|0),($9|0),2)|0);
 $11 = (getTempRet0() | 0);
 $12 = $10 & 2097151;
 $add$ptr7 = ((($a)) + 7|0);
 $13 = (_load_4_18($add$ptr7)|0);
 $14 = (getTempRet0() | 0);
 $15 = (_bitshift64Lshr(($13|0),($14|0),7)|0);
 $16 = (getTempRet0() | 0);
 $17 = $15 & 2097151;
 $add$ptr11 = ((($a)) + 10|0);
 $18 = (_load_4_18($add$ptr11)|0);
 $19 = (getTempRet0() | 0);
 $20 = (_bitshift64Lshr(($18|0),($19|0),4)|0);
 $21 = (getTempRet0() | 0);
 $22 = $20 & 2097151;
 $add$ptr15 = ((($a)) + 13|0);
 $23 = (_load_3_17($add$ptr15)|0);
 $24 = (getTempRet0() | 0);
 $25 = (_bitshift64Lshr(($23|0),($24|0),1)|0);
 $26 = (getTempRet0() | 0);
 $27 = $25 & 2097151;
 $add$ptr19 = ((($a)) + 15|0);
 $28 = (_load_4_18($add$ptr19)|0);
 $29 = (getTempRet0() | 0);
 $30 = (_bitshift64Lshr(($28|0),($29|0),6)|0);
 $31 = (getTempRet0() | 0);
 $32 = $30 & 2097151;
 $add$ptr23 = ((($a)) + 18|0);
 $33 = (_load_3_17($add$ptr23)|0);
 $34 = (getTempRet0() | 0);
 $35 = (_bitshift64Lshr(($33|0),($34|0),3)|0);
 $36 = (getTempRet0() | 0);
 $37 = $35 & 2097151;
 $add$ptr27 = ((($a)) + 21|0);
 $38 = (_load_3_17($add$ptr27)|0);
 $39 = (getTempRet0() | 0);
 $40 = $38 & 2097151;
 $add$ptr30 = ((($a)) + 23|0);
 $41 = (_load_4_18($add$ptr30)|0);
 $42 = (getTempRet0() | 0);
 $43 = (_bitshift64Lshr(($41|0),($42|0),5)|0);
 $44 = (getTempRet0() | 0);
 $45 = $43 & 2097151;
 $add$ptr34 = ((($a)) + 26|0);
 $46 = (_load_3_17($add$ptr34)|0);
 $47 = (getTempRet0() | 0);
 $48 = (_bitshift64Lshr(($46|0),($47|0),2)|0);
 $49 = (getTempRet0() | 0);
 $50 = $48 & 2097151;
 $add$ptr38 = ((($a)) + 28|0);
 $51 = (_load_4_18($add$ptr38)|0);
 $52 = (getTempRet0() | 0);
 $53 = (_bitshift64Lshr(($51|0),($52|0),7)|0);
 $54 = (getTempRet0() | 0);
 $55 = (_load_3_17($b)|0);
 $56 = (getTempRet0() | 0);
 $57 = $55 & 2097151;
 $add$ptr43 = ((($b)) + 2|0);
 $58 = (_load_4_18($add$ptr43)|0);
 $59 = (getTempRet0() | 0);
 $60 = (_bitshift64Lshr(($58|0),($59|0),5)|0);
 $61 = (getTempRet0() | 0);
 $62 = $60 & 2097151;
 $add$ptr47 = ((($b)) + 5|0);
 $63 = (_load_3_17($add$ptr47)|0);
 $64 = (getTempRet0() | 0);
 $65 = (_bitshift64Lshr(($63|0),($64|0),2)|0);
 $66 = (getTempRet0() | 0);
 $67 = $65 & 2097151;
 $add$ptr51 = ((($b)) + 7|0);
 $68 = (_load_4_18($add$ptr51)|0);
 $69 = (getTempRet0() | 0);
 $70 = (_bitshift64Lshr(($68|0),($69|0),7)|0);
 $71 = (getTempRet0() | 0);
 $72 = $70 & 2097151;
 $add$ptr55 = ((($b)) + 10|0);
 $73 = (_load_4_18($add$ptr55)|0);
 $74 = (getTempRet0() | 0);
 $75 = (_bitshift64Lshr(($73|0),($74|0),4)|0);
 $76 = (getTempRet0() | 0);
 $77 = $75 & 2097151;
 $add$ptr59 = ((($b)) + 13|0);
 $78 = (_load_3_17($add$ptr59)|0);
 $79 = (getTempRet0() | 0);
 $80 = (_bitshift64Lshr(($78|0),($79|0),1)|0);
 $81 = (getTempRet0() | 0);
 $82 = $80 & 2097151;
 $add$ptr63 = ((($b)) + 15|0);
 $83 = (_load_4_18($add$ptr63)|0);
 $84 = (getTempRet0() | 0);
 $85 = (_bitshift64Lshr(($83|0),($84|0),6)|0);
 $86 = (getTempRet0() | 0);
 $87 = $85 & 2097151;
 $add$ptr67 = ((($b)) + 18|0);
 $88 = (_load_3_17($add$ptr67)|0);
 $89 = (getTempRet0() | 0);
 $90 = (_bitshift64Lshr(($88|0),($89|0),3)|0);
 $91 = (getTempRet0() | 0);
 $92 = $90 & 2097151;
 $add$ptr71 = ((($b)) + 21|0);
 $93 = (_load_3_17($add$ptr71)|0);
 $94 = (getTempRet0() | 0);
 $95 = $93 & 2097151;
 $add$ptr74 = ((($b)) + 23|0);
 $96 = (_load_4_18($add$ptr74)|0);
 $97 = (getTempRet0() | 0);
 $98 = (_bitshift64Lshr(($96|0),($97|0),5)|0);
 $99 = (getTempRet0() | 0);
 $100 = $98 & 2097151;
 $add$ptr78 = ((($b)) + 26|0);
 $101 = (_load_3_17($add$ptr78)|0);
 $102 = (getTempRet0() | 0);
 $103 = (_bitshift64Lshr(($101|0),($102|0),2)|0);
 $104 = (getTempRet0() | 0);
 $105 = $103 & 2097151;
 $add$ptr82 = ((($b)) + 28|0);
 $106 = (_load_4_18($add$ptr82)|0);
 $107 = (getTempRet0() | 0);
 $108 = (_bitshift64Lshr(($106|0),($107|0),7)|0);
 $109 = (getTempRet0() | 0);
 $110 = (_load_3_17($c)|0);
 $111 = (getTempRet0() | 0);
 $112 = $110 & 2097151;
 $add$ptr87 = ((($c)) + 2|0);
 $113 = (_load_4_18($add$ptr87)|0);
 $114 = (getTempRet0() | 0);
 $115 = (_bitshift64Lshr(($113|0),($114|0),5)|0);
 $116 = (getTempRet0() | 0);
 $117 = $115 & 2097151;
 $add$ptr91 = ((($c)) + 5|0);
 $118 = (_load_3_17($add$ptr91)|0);
 $119 = (getTempRet0() | 0);
 $120 = (_bitshift64Lshr(($118|0),($119|0),2)|0);
 $121 = (getTempRet0() | 0);
 $122 = $120 & 2097151;
 $add$ptr95 = ((($c)) + 7|0);
 $123 = (_load_4_18($add$ptr95)|0);
 $124 = (getTempRet0() | 0);
 $125 = (_bitshift64Lshr(($123|0),($124|0),7)|0);
 $126 = (getTempRet0() | 0);
 $127 = $125 & 2097151;
 $add$ptr99 = ((($c)) + 10|0);
 $128 = (_load_4_18($add$ptr99)|0);
 $129 = (getTempRet0() | 0);
 $130 = (_bitshift64Lshr(($128|0),($129|0),4)|0);
 $131 = (getTempRet0() | 0);
 $132 = $130 & 2097151;
 $add$ptr103 = ((($c)) + 13|0);
 $133 = (_load_3_17($add$ptr103)|0);
 $134 = (getTempRet0() | 0);
 $135 = (_bitshift64Lshr(($133|0),($134|0),1)|0);
 $136 = (getTempRet0() | 0);
 $137 = $135 & 2097151;
 $add$ptr107 = ((($c)) + 15|0);
 $138 = (_load_4_18($add$ptr107)|0);
 $139 = (getTempRet0() | 0);
 $140 = (_bitshift64Lshr(($138|0),($139|0),6)|0);
 $141 = (getTempRet0() | 0);
 $142 = $140 & 2097151;
 $add$ptr111 = ((($c)) + 18|0);
 $143 = (_load_3_17($add$ptr111)|0);
 $144 = (getTempRet0() | 0);
 $145 = (_bitshift64Lshr(($143|0),($144|0),3)|0);
 $146 = (getTempRet0() | 0);
 $147 = $145 & 2097151;
 $add$ptr115 = ((($c)) + 21|0);
 $148 = (_load_3_17($add$ptr115)|0);
 $149 = (getTempRet0() | 0);
 $150 = $148 & 2097151;
 $add$ptr118 = ((($c)) + 23|0);
 $151 = (_load_4_18($add$ptr118)|0);
 $152 = (getTempRet0() | 0);
 $153 = (_bitshift64Lshr(($151|0),($152|0),5)|0);
 $154 = (getTempRet0() | 0);
 $155 = $153 & 2097151;
 $add$ptr122 = ((($c)) + 26|0);
 $156 = (_load_3_17($add$ptr122)|0);
 $157 = (getTempRet0() | 0);
 $158 = (_bitshift64Lshr(($156|0),($157|0),2)|0);
 $159 = (getTempRet0() | 0);
 $160 = $158 & 2097151;
 $add$ptr126 = ((($c)) + 28|0);
 $161 = (_load_4_18($add$ptr126)|0);
 $162 = (getTempRet0() | 0);
 $163 = (_bitshift64Lshr(($161|0),($162|0),7)|0);
 $164 = (getTempRet0() | 0);
 $165 = (___muldi3(($57|0),0,($2|0),0)|0);
 $166 = (getTempRet0() | 0);
 $167 = (_i64Add(($112|0),0,($165|0),($166|0))|0);
 $168 = (getTempRet0() | 0);
 $169 = (___muldi3(($62|0),0,($2|0),0)|0);
 $170 = (getTempRet0() | 0);
 $171 = (___muldi3(($57|0),0,($7|0),0)|0);
 $172 = (getTempRet0() | 0);
 $173 = (___muldi3(($67|0),0,($2|0),0)|0);
 $174 = (getTempRet0() | 0);
 $175 = (___muldi3(($62|0),0,($7|0),0)|0);
 $176 = (getTempRet0() | 0);
 $177 = (___muldi3(($57|0),0,($12|0),0)|0);
 $178 = (getTempRet0() | 0);
 $179 = (_i64Add(($175|0),($176|0),($177|0),($178|0))|0);
 $180 = (getTempRet0() | 0);
 $181 = (_i64Add(($179|0),($180|0),($173|0),($174|0))|0);
 $182 = (getTempRet0() | 0);
 $183 = (_i64Add(($181|0),($182|0),($122|0),0)|0);
 $184 = (getTempRet0() | 0);
 $185 = (___muldi3(($72|0),0,($2|0),0)|0);
 $186 = (getTempRet0() | 0);
 $187 = (___muldi3(($67|0),0,($7|0),0)|0);
 $188 = (getTempRet0() | 0);
 $189 = (___muldi3(($62|0),0,($12|0),0)|0);
 $190 = (getTempRet0() | 0);
 $191 = (___muldi3(($57|0),0,($17|0),0)|0);
 $192 = (getTempRet0() | 0);
 $193 = (___muldi3(($77|0),0,($2|0),0)|0);
 $194 = (getTempRet0() | 0);
 $195 = (___muldi3(($72|0),0,($7|0),0)|0);
 $196 = (getTempRet0() | 0);
 $197 = (___muldi3(($67|0),0,($12|0),0)|0);
 $198 = (getTempRet0() | 0);
 $199 = (___muldi3(($62|0),0,($17|0),0)|0);
 $200 = (getTempRet0() | 0);
 $201 = (___muldi3(($57|0),0,($22|0),0)|0);
 $202 = (getTempRet0() | 0);
 $203 = (_i64Add(($199|0),($200|0),($201|0),($202|0))|0);
 $204 = (getTempRet0() | 0);
 $205 = (_i64Add(($203|0),($204|0),($197|0),($198|0))|0);
 $206 = (getTempRet0() | 0);
 $207 = (_i64Add(($205|0),($206|0),($195|0),($196|0))|0);
 $208 = (getTempRet0() | 0);
 $209 = (_i64Add(($207|0),($208|0),($193|0),($194|0))|0);
 $210 = (getTempRet0() | 0);
 $211 = (_i64Add(($209|0),($210|0),($132|0),0)|0);
 $212 = (getTempRet0() | 0);
 $213 = (___muldi3(($82|0),0,($2|0),0)|0);
 $214 = (getTempRet0() | 0);
 $215 = (___muldi3(($77|0),0,($7|0),0)|0);
 $216 = (getTempRet0() | 0);
 $217 = (___muldi3(($72|0),0,($12|0),0)|0);
 $218 = (getTempRet0() | 0);
 $219 = (___muldi3(($67|0),0,($17|0),0)|0);
 $220 = (getTempRet0() | 0);
 $221 = (___muldi3(($62|0),0,($22|0),0)|0);
 $222 = (getTempRet0() | 0);
 $223 = (___muldi3(($57|0),0,($27|0),0)|0);
 $224 = (getTempRet0() | 0);
 $225 = (___muldi3(($87|0),0,($2|0),0)|0);
 $226 = (getTempRet0() | 0);
 $227 = (___muldi3(($82|0),0,($7|0),0)|0);
 $228 = (getTempRet0() | 0);
 $229 = (___muldi3(($77|0),0,($12|0),0)|0);
 $230 = (getTempRet0() | 0);
 $231 = (___muldi3(($72|0),0,($17|0),0)|0);
 $232 = (getTempRet0() | 0);
 $233 = (___muldi3(($67|0),0,($22|0),0)|0);
 $234 = (getTempRet0() | 0);
 $235 = (___muldi3(($62|0),0,($27|0),0)|0);
 $236 = (getTempRet0() | 0);
 $237 = (___muldi3(($57|0),0,($32|0),0)|0);
 $238 = (getTempRet0() | 0);
 $239 = (_i64Add(($235|0),($236|0),($237|0),($238|0))|0);
 $240 = (getTempRet0() | 0);
 $241 = (_i64Add(($239|0),($240|0),($233|0),($234|0))|0);
 $242 = (getTempRet0() | 0);
 $243 = (_i64Add(($241|0),($242|0),($231|0),($232|0))|0);
 $244 = (getTempRet0() | 0);
 $245 = (_i64Add(($243|0),($244|0),($229|0),($230|0))|0);
 $246 = (getTempRet0() | 0);
 $247 = (_i64Add(($245|0),($246|0),($227|0),($228|0))|0);
 $248 = (getTempRet0() | 0);
 $249 = (_i64Add(($247|0),($248|0),($225|0),($226|0))|0);
 $250 = (getTempRet0() | 0);
 $251 = (_i64Add(($249|0),($250|0),($142|0),0)|0);
 $252 = (getTempRet0() | 0);
 $253 = (___muldi3(($92|0),0,($2|0),0)|0);
 $254 = (getTempRet0() | 0);
 $255 = (___muldi3(($87|0),0,($7|0),0)|0);
 $256 = (getTempRet0() | 0);
 $257 = (___muldi3(($82|0),0,($12|0),0)|0);
 $258 = (getTempRet0() | 0);
 $259 = (___muldi3(($77|0),0,($17|0),0)|0);
 $260 = (getTempRet0() | 0);
 $261 = (___muldi3(($72|0),0,($22|0),0)|0);
 $262 = (getTempRet0() | 0);
 $263 = (___muldi3(($67|0),0,($27|0),0)|0);
 $264 = (getTempRet0() | 0);
 $265 = (___muldi3(($62|0),0,($32|0),0)|0);
 $266 = (getTempRet0() | 0);
 $267 = (___muldi3(($57|0),0,($37|0),0)|0);
 $268 = (getTempRet0() | 0);
 $269 = (___muldi3(($95|0),0,($2|0),0)|0);
 $270 = (getTempRet0() | 0);
 $271 = (___muldi3(($92|0),0,($7|0),0)|0);
 $272 = (getTempRet0() | 0);
 $273 = (___muldi3(($87|0),0,($12|0),0)|0);
 $274 = (getTempRet0() | 0);
 $275 = (___muldi3(($82|0),0,($17|0),0)|0);
 $276 = (getTempRet0() | 0);
 $277 = (___muldi3(($77|0),0,($22|0),0)|0);
 $278 = (getTempRet0() | 0);
 $279 = (___muldi3(($72|0),0,($27|0),0)|0);
 $280 = (getTempRet0() | 0);
 $281 = (___muldi3(($67|0),0,($32|0),0)|0);
 $282 = (getTempRet0() | 0);
 $283 = (___muldi3(($62|0),0,($37|0),0)|0);
 $284 = (getTempRet0() | 0);
 $285 = (___muldi3(($57|0),0,($40|0),0)|0);
 $286 = (getTempRet0() | 0);
 $287 = (_i64Add(($283|0),($284|0),($285|0),($286|0))|0);
 $288 = (getTempRet0() | 0);
 $289 = (_i64Add(($287|0),($288|0),($281|0),($282|0))|0);
 $290 = (getTempRet0() | 0);
 $291 = (_i64Add(($289|0),($290|0),($279|0),($280|0))|0);
 $292 = (getTempRet0() | 0);
 $293 = (_i64Add(($291|0),($292|0),($277|0),($278|0))|0);
 $294 = (getTempRet0() | 0);
 $295 = (_i64Add(($293|0),($294|0),($275|0),($276|0))|0);
 $296 = (getTempRet0() | 0);
 $297 = (_i64Add(($295|0),($296|0),($273|0),($274|0))|0);
 $298 = (getTempRet0() | 0);
 $299 = (_i64Add(($297|0),($298|0),($269|0),($270|0))|0);
 $300 = (getTempRet0() | 0);
 $301 = (_i64Add(($299|0),($300|0),($271|0),($272|0))|0);
 $302 = (getTempRet0() | 0);
 $303 = (_i64Add(($301|0),($302|0),($150|0),0)|0);
 $304 = (getTempRet0() | 0);
 $305 = (___muldi3(($100|0),0,($2|0),0)|0);
 $306 = (getTempRet0() | 0);
 $307 = (___muldi3(($95|0),0,($7|0),0)|0);
 $308 = (getTempRet0() | 0);
 $309 = (___muldi3(($92|0),0,($12|0),0)|0);
 $310 = (getTempRet0() | 0);
 $311 = (___muldi3(($87|0),0,($17|0),0)|0);
 $312 = (getTempRet0() | 0);
 $313 = (___muldi3(($82|0),0,($22|0),0)|0);
 $314 = (getTempRet0() | 0);
 $315 = (___muldi3(($77|0),0,($27|0),0)|0);
 $316 = (getTempRet0() | 0);
 $317 = (___muldi3(($72|0),0,($32|0),0)|0);
 $318 = (getTempRet0() | 0);
 $319 = (___muldi3(($67|0),0,($37|0),0)|0);
 $320 = (getTempRet0() | 0);
 $321 = (___muldi3(($62|0),0,($40|0),0)|0);
 $322 = (getTempRet0() | 0);
 $323 = (___muldi3(($57|0),0,($45|0),0)|0);
 $324 = (getTempRet0() | 0);
 $325 = (___muldi3(($105|0),0,($2|0),0)|0);
 $326 = (getTempRet0() | 0);
 $327 = (___muldi3(($100|0),0,($7|0),0)|0);
 $328 = (getTempRet0() | 0);
 $329 = (___muldi3(($95|0),0,($12|0),0)|0);
 $330 = (getTempRet0() | 0);
 $331 = (___muldi3(($92|0),0,($17|0),0)|0);
 $332 = (getTempRet0() | 0);
 $333 = (___muldi3(($87|0),0,($22|0),0)|0);
 $334 = (getTempRet0() | 0);
 $335 = (___muldi3(($82|0),0,($27|0),0)|0);
 $336 = (getTempRet0() | 0);
 $337 = (___muldi3(($77|0),0,($32|0),0)|0);
 $338 = (getTempRet0() | 0);
 $339 = (___muldi3(($72|0),0,($37|0),0)|0);
 $340 = (getTempRet0() | 0);
 $341 = (___muldi3(($67|0),0,($40|0),0)|0);
 $342 = (getTempRet0() | 0);
 $343 = (___muldi3(($62|0),0,($45|0),0)|0);
 $344 = (getTempRet0() | 0);
 $345 = (___muldi3(($57|0),0,($50|0),0)|0);
 $346 = (getTempRet0() | 0);
 $347 = (_i64Add(($343|0),($344|0),($345|0),($346|0))|0);
 $348 = (getTempRet0() | 0);
 $349 = (_i64Add(($347|0),($348|0),($341|0),($342|0))|0);
 $350 = (getTempRet0() | 0);
 $351 = (_i64Add(($349|0),($350|0),($339|0),($340|0))|0);
 $352 = (getTempRet0() | 0);
 $353 = (_i64Add(($351|0),($352|0),($337|0),($338|0))|0);
 $354 = (getTempRet0() | 0);
 $355 = (_i64Add(($353|0),($354|0),($335|0),($336|0))|0);
 $356 = (getTempRet0() | 0);
 $357 = (_i64Add(($355|0),($356|0),($333|0),($334|0))|0);
 $358 = (getTempRet0() | 0);
 $359 = (_i64Add(($357|0),($358|0),($329|0),($330|0))|0);
 $360 = (getTempRet0() | 0);
 $361 = (_i64Add(($359|0),($360|0),($331|0),($332|0))|0);
 $362 = (getTempRet0() | 0);
 $363 = (_i64Add(($361|0),($362|0),($327|0),($328|0))|0);
 $364 = (getTempRet0() | 0);
 $365 = (_i64Add(($363|0),($364|0),($325|0),($326|0))|0);
 $366 = (getTempRet0() | 0);
 $367 = (_i64Add(($365|0),($366|0),($160|0),0)|0);
 $368 = (getTempRet0() | 0);
 $369 = (___muldi3(($108|0),($109|0),($2|0),0)|0);
 $370 = (getTempRet0() | 0);
 $371 = (___muldi3(($105|0),0,($7|0),0)|0);
 $372 = (getTempRet0() | 0);
 $373 = (___muldi3(($100|0),0,($12|0),0)|0);
 $374 = (getTempRet0() | 0);
 $375 = (___muldi3(($95|0),0,($17|0),0)|0);
 $376 = (getTempRet0() | 0);
 $377 = (___muldi3(($92|0),0,($22|0),0)|0);
 $378 = (getTempRet0() | 0);
 $379 = (___muldi3(($87|0),0,($27|0),0)|0);
 $380 = (getTempRet0() | 0);
 $381 = (___muldi3(($82|0),0,($32|0),0)|0);
 $382 = (getTempRet0() | 0);
 $383 = (___muldi3(($77|0),0,($37|0),0)|0);
 $384 = (getTempRet0() | 0);
 $385 = (___muldi3(($72|0),0,($40|0),0)|0);
 $386 = (getTempRet0() | 0);
 $387 = (___muldi3(($67|0),0,($45|0),0)|0);
 $388 = (getTempRet0() | 0);
 $389 = (___muldi3(($62|0),0,($50|0),0)|0);
 $390 = (getTempRet0() | 0);
 $391 = (___muldi3(($57|0),0,($53|0),($54|0))|0);
 $392 = (getTempRet0() | 0);
 $393 = (___muldi3(($108|0),($109|0),($7|0),0)|0);
 $394 = (getTempRet0() | 0);
 $395 = (___muldi3(($105|0),0,($12|0),0)|0);
 $396 = (getTempRet0() | 0);
 $397 = (___muldi3(($100|0),0,($17|0),0)|0);
 $398 = (getTempRet0() | 0);
 $399 = (___muldi3(($95|0),0,($22|0),0)|0);
 $400 = (getTempRet0() | 0);
 $401 = (___muldi3(($92|0),0,($27|0),0)|0);
 $402 = (getTempRet0() | 0);
 $403 = (___muldi3(($87|0),0,($32|0),0)|0);
 $404 = (getTempRet0() | 0);
 $405 = (___muldi3(($82|0),0,($37|0),0)|0);
 $406 = (getTempRet0() | 0);
 $407 = (___muldi3(($77|0),0,($40|0),0)|0);
 $408 = (getTempRet0() | 0);
 $409 = (___muldi3(($72|0),0,($45|0),0)|0);
 $410 = (getTempRet0() | 0);
 $411 = (___muldi3(($67|0),0,($50|0),0)|0);
 $412 = (getTempRet0() | 0);
 $413 = (___muldi3(($62|0),0,($53|0),($54|0))|0);
 $414 = (getTempRet0() | 0);
 $415 = (_i64Add(($411|0),($412|0),($413|0),($414|0))|0);
 $416 = (getTempRet0() | 0);
 $417 = (_i64Add(($415|0),($416|0),($409|0),($410|0))|0);
 $418 = (getTempRet0() | 0);
 $419 = (_i64Add(($417|0),($418|0),($407|0),($408|0))|0);
 $420 = (getTempRet0() | 0);
 $421 = (_i64Add(($419|0),($420|0),($405|0),($406|0))|0);
 $422 = (getTempRet0() | 0);
 $423 = (_i64Add(($421|0),($422|0),($403|0),($404|0))|0);
 $424 = (getTempRet0() | 0);
 $425 = (_i64Add(($423|0),($424|0),($399|0),($400|0))|0);
 $426 = (getTempRet0() | 0);
 $427 = (_i64Add(($425|0),($426|0),($401|0),($402|0))|0);
 $428 = (getTempRet0() | 0);
 $429 = (_i64Add(($427|0),($428|0),($397|0),($398|0))|0);
 $430 = (getTempRet0() | 0);
 $431 = (_i64Add(($429|0),($430|0),($395|0),($396|0))|0);
 $432 = (getTempRet0() | 0);
 $433 = (_i64Add(($431|0),($432|0),($393|0),($394|0))|0);
 $434 = (getTempRet0() | 0);
 $435 = (___muldi3(($108|0),($109|0),($12|0),0)|0);
 $436 = (getTempRet0() | 0);
 $437 = (___muldi3(($105|0),0,($17|0),0)|0);
 $438 = (getTempRet0() | 0);
 $439 = (___muldi3(($100|0),0,($22|0),0)|0);
 $440 = (getTempRet0() | 0);
 $441 = (___muldi3(($95|0),0,($27|0),0)|0);
 $442 = (getTempRet0() | 0);
 $443 = (___muldi3(($92|0),0,($32|0),0)|0);
 $444 = (getTempRet0() | 0);
 $445 = (___muldi3(($87|0),0,($37|0),0)|0);
 $446 = (getTempRet0() | 0);
 $447 = (___muldi3(($82|0),0,($40|0),0)|0);
 $448 = (getTempRet0() | 0);
 $449 = (___muldi3(($77|0),0,($45|0),0)|0);
 $450 = (getTempRet0() | 0);
 $451 = (___muldi3(($72|0),0,($50|0),0)|0);
 $452 = (getTempRet0() | 0);
 $453 = (___muldi3(($67|0),0,($53|0),($54|0))|0);
 $454 = (getTempRet0() | 0);
 $455 = (___muldi3(($108|0),($109|0),($17|0),0)|0);
 $456 = (getTempRet0() | 0);
 $457 = (___muldi3(($105|0),0,($22|0),0)|0);
 $458 = (getTempRet0() | 0);
 $459 = (___muldi3(($100|0),0,($27|0),0)|0);
 $460 = (getTempRet0() | 0);
 $461 = (___muldi3(($95|0),0,($32|0),0)|0);
 $462 = (getTempRet0() | 0);
 $463 = (___muldi3(($92|0),0,($37|0),0)|0);
 $464 = (getTempRet0() | 0);
 $465 = (___muldi3(($87|0),0,($40|0),0)|0);
 $466 = (getTempRet0() | 0);
 $467 = (___muldi3(($82|0),0,($45|0),0)|0);
 $468 = (getTempRet0() | 0);
 $469 = (___muldi3(($77|0),0,($50|0),0)|0);
 $470 = (getTempRet0() | 0);
 $471 = (___muldi3(($72|0),0,($53|0),($54|0))|0);
 $472 = (getTempRet0() | 0);
 $473 = (_i64Add(($469|0),($470|0),($471|0),($472|0))|0);
 $474 = (getTempRet0() | 0);
 $475 = (_i64Add(($473|0),($474|0),($467|0),($468|0))|0);
 $476 = (getTempRet0() | 0);
 $477 = (_i64Add(($475|0),($476|0),($465|0),($466|0))|0);
 $478 = (getTempRet0() | 0);
 $479 = (_i64Add(($477|0),($478|0),($461|0),($462|0))|0);
 $480 = (getTempRet0() | 0);
 $481 = (_i64Add(($479|0),($480|0),($463|0),($464|0))|0);
 $482 = (getTempRet0() | 0);
 $483 = (_i64Add(($481|0),($482|0),($459|0),($460|0))|0);
 $484 = (getTempRet0() | 0);
 $485 = (_i64Add(($483|0),($484|0),($457|0),($458|0))|0);
 $486 = (getTempRet0() | 0);
 $487 = (_i64Add(($485|0),($486|0),($455|0),($456|0))|0);
 $488 = (getTempRet0() | 0);
 $489 = (___muldi3(($108|0),($109|0),($22|0),0)|0);
 $490 = (getTempRet0() | 0);
 $491 = (___muldi3(($105|0),0,($27|0),0)|0);
 $492 = (getTempRet0() | 0);
 $493 = (___muldi3(($100|0),0,($32|0),0)|0);
 $494 = (getTempRet0() | 0);
 $495 = (___muldi3(($95|0),0,($37|0),0)|0);
 $496 = (getTempRet0() | 0);
 $497 = (___muldi3(($92|0),0,($40|0),0)|0);
 $498 = (getTempRet0() | 0);
 $499 = (___muldi3(($87|0),0,($45|0),0)|0);
 $500 = (getTempRet0() | 0);
 $501 = (___muldi3(($82|0),0,($50|0),0)|0);
 $502 = (getTempRet0() | 0);
 $503 = (___muldi3(($77|0),0,($53|0),($54|0))|0);
 $504 = (getTempRet0() | 0);
 $505 = (___muldi3(($108|0),($109|0),($27|0),0)|0);
 $506 = (getTempRet0() | 0);
 $507 = (___muldi3(($105|0),0,($32|0),0)|0);
 $508 = (getTempRet0() | 0);
 $509 = (___muldi3(($100|0),0,($37|0),0)|0);
 $510 = (getTempRet0() | 0);
 $511 = (___muldi3(($95|0),0,($40|0),0)|0);
 $512 = (getTempRet0() | 0);
 $513 = (___muldi3(($92|0),0,($45|0),0)|0);
 $514 = (getTempRet0() | 0);
 $515 = (___muldi3(($87|0),0,($50|0),0)|0);
 $516 = (getTempRet0() | 0);
 $517 = (___muldi3(($82|0),0,($53|0),($54|0))|0);
 $518 = (getTempRet0() | 0);
 $519 = (_i64Add(($515|0),($516|0),($517|0),($518|0))|0);
 $520 = (getTempRet0() | 0);
 $521 = (_i64Add(($519|0),($520|0),($511|0),($512|0))|0);
 $522 = (getTempRet0() | 0);
 $523 = (_i64Add(($521|0),($522|0),($513|0),($514|0))|0);
 $524 = (getTempRet0() | 0);
 $525 = (_i64Add(($523|0),($524|0),($509|0),($510|0))|0);
 $526 = (getTempRet0() | 0);
 $527 = (_i64Add(($525|0),($526|0),($507|0),($508|0))|0);
 $528 = (getTempRet0() | 0);
 $529 = (_i64Add(($527|0),($528|0),($505|0),($506|0))|0);
 $530 = (getTempRet0() | 0);
 $531 = (___muldi3(($108|0),($109|0),($32|0),0)|0);
 $532 = (getTempRet0() | 0);
 $533 = (___muldi3(($105|0),0,($37|0),0)|0);
 $534 = (getTempRet0() | 0);
 $535 = (___muldi3(($100|0),0,($40|0),0)|0);
 $536 = (getTempRet0() | 0);
 $537 = (___muldi3(($95|0),0,($45|0),0)|0);
 $538 = (getTempRet0() | 0);
 $539 = (___muldi3(($92|0),0,($50|0),0)|0);
 $540 = (getTempRet0() | 0);
 $541 = (___muldi3(($87|0),0,($53|0),($54|0))|0);
 $542 = (getTempRet0() | 0);
 $543 = (___muldi3(($108|0),($109|0),($37|0),0)|0);
 $544 = (getTempRet0() | 0);
 $545 = (___muldi3(($105|0),0,($40|0),0)|0);
 $546 = (getTempRet0() | 0);
 $547 = (___muldi3(($100|0),0,($45|0),0)|0);
 $548 = (getTempRet0() | 0);
 $549 = (___muldi3(($95|0),0,($50|0),0)|0);
 $550 = (getTempRet0() | 0);
 $551 = (___muldi3(($92|0),0,($53|0),($54|0))|0);
 $552 = (getTempRet0() | 0);
 $553 = (_i64Add(($551|0),($552|0),($549|0),($550|0))|0);
 $554 = (getTempRet0() | 0);
 $555 = (_i64Add(($553|0),($554|0),($547|0),($548|0))|0);
 $556 = (getTempRet0() | 0);
 $557 = (_i64Add(($555|0),($556|0),($545|0),($546|0))|0);
 $558 = (getTempRet0() | 0);
 $559 = (_i64Add(($557|0),($558|0),($543|0),($544|0))|0);
 $560 = (getTempRet0() | 0);
 $561 = (___muldi3(($108|0),($109|0),($40|0),0)|0);
 $562 = (getTempRet0() | 0);
 $563 = (___muldi3(($105|0),0,($45|0),0)|0);
 $564 = (getTempRet0() | 0);
 $565 = (___muldi3(($100|0),0,($50|0),0)|0);
 $566 = (getTempRet0() | 0);
 $567 = (___muldi3(($95|0),0,($53|0),($54|0))|0);
 $568 = (getTempRet0() | 0);
 $569 = (___muldi3(($108|0),($109|0),($45|0),0)|0);
 $570 = (getTempRet0() | 0);
 $571 = (___muldi3(($105|0),0,($50|0),0)|0);
 $572 = (getTempRet0() | 0);
 $573 = (___muldi3(($100|0),0,($53|0),($54|0))|0);
 $574 = (getTempRet0() | 0);
 $575 = (_i64Add(($571|0),($572|0),($573|0),($574|0))|0);
 $576 = (getTempRet0() | 0);
 $577 = (_i64Add(($575|0),($576|0),($569|0),($570|0))|0);
 $578 = (getTempRet0() | 0);
 $579 = (___muldi3(($108|0),($109|0),($50|0),0)|0);
 $580 = (getTempRet0() | 0);
 $581 = (___muldi3(($105|0),0,($53|0),($54|0))|0);
 $582 = (getTempRet0() | 0);
 $583 = (_i64Add(($579|0),($580|0),($581|0),($582|0))|0);
 $584 = (getTempRet0() | 0);
 $585 = (___muldi3(($108|0),($109|0),($53|0),($54|0))|0);
 $586 = (getTempRet0() | 0);
 $587 = (_i64Add(($167|0),($168|0),1048576,0)|0);
 $588 = (getTempRet0() | 0);
 $589 = (_bitshift64Lshr(($587|0),($588|0),21)|0);
 $590 = (getTempRet0() | 0);
 $591 = (_i64Add(($169|0),($170|0),($171|0),($172|0))|0);
 $592 = (getTempRet0() | 0);
 $593 = (_i64Add(($591|0),($592|0),($117|0),0)|0);
 $594 = (getTempRet0() | 0);
 $595 = (_i64Add(($593|0),($594|0),($589|0),($590|0))|0);
 $596 = (getTempRet0() | 0);
 $597 = $587 & -2097152;
 $598 = $588 & 4095;
 $599 = (_i64Subtract(($167|0),($168|0),($597|0),($598|0))|0);
 $600 = (getTempRet0() | 0);
 $601 = (_i64Add(($183|0),($184|0),1048576,0)|0);
 $602 = (getTempRet0() | 0);
 $603 = (_bitshift64Lshr(($601|0),($602|0),21)|0);
 $604 = (getTempRet0() | 0);
 $605 = (_i64Add(($189|0),($190|0),($191|0),($192|0))|0);
 $606 = (getTempRet0() | 0);
 $607 = (_i64Add(($605|0),($606|0),($187|0),($188|0))|0);
 $608 = (getTempRet0() | 0);
 $609 = (_i64Add(($607|0),($608|0),($185|0),($186|0))|0);
 $610 = (getTempRet0() | 0);
 $611 = (_i64Add(($609|0),($610|0),($127|0),0)|0);
 $612 = (getTempRet0() | 0);
 $613 = (_i64Add(($611|0),($612|0),($603|0),($604|0))|0);
 $614 = (getTempRet0() | 0);
 $615 = $601 & -2097152;
 $616 = (_i64Add(($211|0),($212|0),1048576,0)|0);
 $617 = (getTempRet0() | 0);
 $618 = (_bitshift64Ashr(($616|0),($617|0),21)|0);
 $619 = (getTempRet0() | 0);
 $620 = (_i64Add(($221|0),($222|0),($223|0),($224|0))|0);
 $621 = (getTempRet0() | 0);
 $622 = (_i64Add(($620|0),($621|0),($219|0),($220|0))|0);
 $623 = (getTempRet0() | 0);
 $624 = (_i64Add(($622|0),($623|0),($217|0),($218|0))|0);
 $625 = (getTempRet0() | 0);
 $626 = (_i64Add(($624|0),($625|0),($215|0),($216|0))|0);
 $627 = (getTempRet0() | 0);
 $628 = (_i64Add(($626|0),($627|0),($213|0),($214|0))|0);
 $629 = (getTempRet0() | 0);
 $630 = (_i64Add(($628|0),($629|0),($137|0),0)|0);
 $631 = (getTempRet0() | 0);
 $632 = (_i64Add(($630|0),($631|0),($618|0),($619|0))|0);
 $633 = (getTempRet0() | 0);
 $634 = $616 & -2097152;
 $635 = (_i64Add(($251|0),($252|0),1048576,0)|0);
 $636 = (getTempRet0() | 0);
 $637 = (_bitshift64Ashr(($635|0),($636|0),21)|0);
 $638 = (getTempRet0() | 0);
 $639 = (_i64Add(($265|0),($266|0),($267|0),($268|0))|0);
 $640 = (getTempRet0() | 0);
 $641 = (_i64Add(($639|0),($640|0),($263|0),($264|0))|0);
 $642 = (getTempRet0() | 0);
 $643 = (_i64Add(($641|0),($642|0),($261|0),($262|0))|0);
 $644 = (getTempRet0() | 0);
 $645 = (_i64Add(($643|0),($644|0),($259|0),($260|0))|0);
 $646 = (getTempRet0() | 0);
 $647 = (_i64Add(($645|0),($646|0),($257|0),($258|0))|0);
 $648 = (getTempRet0() | 0);
 $649 = (_i64Add(($647|0),($648|0),($255|0),($256|0))|0);
 $650 = (getTempRet0() | 0);
 $651 = (_i64Add(($649|0),($650|0),($253|0),($254|0))|0);
 $652 = (getTempRet0() | 0);
 $653 = (_i64Add(($651|0),($652|0),($147|0),0)|0);
 $654 = (getTempRet0() | 0);
 $655 = (_i64Add(($653|0),($654|0),($637|0),($638|0))|0);
 $656 = (getTempRet0() | 0);
 $657 = $635 & -2097152;
 $658 = (_i64Add(($303|0),($304|0),1048576,0)|0);
 $659 = (getTempRet0() | 0);
 $660 = (_bitshift64Ashr(($658|0),($659|0),21)|0);
 $661 = (getTempRet0() | 0);
 $662 = (_i64Add(($321|0),($322|0),($323|0),($324|0))|0);
 $663 = (getTempRet0() | 0);
 $664 = (_i64Add(($662|0),($663|0),($319|0),($320|0))|0);
 $665 = (getTempRet0() | 0);
 $666 = (_i64Add(($664|0),($665|0),($317|0),($318|0))|0);
 $667 = (getTempRet0() | 0);
 $668 = (_i64Add(($666|0),($667|0),($315|0),($316|0))|0);
 $669 = (getTempRet0() | 0);
 $670 = (_i64Add(($668|0),($669|0),($313|0),($314|0))|0);
 $671 = (getTempRet0() | 0);
 $672 = (_i64Add(($670|0),($671|0),($311|0),($312|0))|0);
 $673 = (getTempRet0() | 0);
 $674 = (_i64Add(($672|0),($673|0),($307|0),($308|0))|0);
 $675 = (getTempRet0() | 0);
 $676 = (_i64Add(($674|0),($675|0),($309|0),($310|0))|0);
 $677 = (getTempRet0() | 0);
 $678 = (_i64Add(($676|0),($677|0),($305|0),($306|0))|0);
 $679 = (getTempRet0() | 0);
 $680 = (_i64Add(($678|0),($679|0),($155|0),0)|0);
 $681 = (getTempRet0() | 0);
 $682 = (_i64Add(($680|0),($681|0),($660|0),($661|0))|0);
 $683 = (getTempRet0() | 0);
 $684 = $658 & -2097152;
 $685 = (_i64Add(($367|0),($368|0),1048576,0)|0);
 $686 = (getTempRet0() | 0);
 $687 = (_bitshift64Ashr(($685|0),($686|0),21)|0);
 $688 = (getTempRet0() | 0);
 $689 = (_i64Add(($389|0),($390|0),($391|0),($392|0))|0);
 $690 = (getTempRet0() | 0);
 $691 = (_i64Add(($689|0),($690|0),($387|0),($388|0))|0);
 $692 = (getTempRet0() | 0);
 $693 = (_i64Add(($691|0),($692|0),($385|0),($386|0))|0);
 $694 = (getTempRet0() | 0);
 $695 = (_i64Add(($693|0),($694|0),($383|0),($384|0))|0);
 $696 = (getTempRet0() | 0);
 $697 = (_i64Add(($695|0),($696|0),($381|0),($382|0))|0);
 $698 = (getTempRet0() | 0);
 $699 = (_i64Add(($697|0),($698|0),($379|0),($380|0))|0);
 $700 = (getTempRet0() | 0);
 $701 = (_i64Add(($699|0),($700|0),($375|0),($376|0))|0);
 $702 = (getTempRet0() | 0);
 $703 = (_i64Add(($701|0),($702|0),($377|0),($378|0))|0);
 $704 = (getTempRet0() | 0);
 $705 = (_i64Add(($703|0),($704|0),($373|0),($374|0))|0);
 $706 = (getTempRet0() | 0);
 $707 = (_i64Add(($705|0),($706|0),($369|0),($370|0))|0);
 $708 = (getTempRet0() | 0);
 $709 = (_i64Add(($707|0),($708|0),($371|0),($372|0))|0);
 $710 = (getTempRet0() | 0);
 $711 = (_i64Add(($709|0),($710|0),($163|0),($164|0))|0);
 $712 = (getTempRet0() | 0);
 $713 = (_i64Add(($711|0),($712|0),($687|0),($688|0))|0);
 $714 = (getTempRet0() | 0);
 $715 = $685 & -2097152;
 $716 = (_i64Add(($433|0),($434|0),1048576,0)|0);
 $717 = (getTempRet0() | 0);
 $718 = (_bitshift64Ashr(($716|0),($717|0),21)|0);
 $719 = (getTempRet0() | 0);
 $720 = (_i64Add(($451|0),($452|0),($453|0),($454|0))|0);
 $721 = (getTempRet0() | 0);
 $722 = (_i64Add(($720|0),($721|0),($449|0),($450|0))|0);
 $723 = (getTempRet0() | 0);
 $724 = (_i64Add(($722|0),($723|0),($447|0),($448|0))|0);
 $725 = (getTempRet0() | 0);
 $726 = (_i64Add(($724|0),($725|0),($445|0),($446|0))|0);
 $727 = (getTempRet0() | 0);
 $728 = (_i64Add(($726|0),($727|0),($441|0),($442|0))|0);
 $729 = (getTempRet0() | 0);
 $730 = (_i64Add(($728|0),($729|0),($443|0),($444|0))|0);
 $731 = (getTempRet0() | 0);
 $732 = (_i64Add(($730|0),($731|0),($439|0),($440|0))|0);
 $733 = (getTempRet0() | 0);
 $734 = (_i64Add(($732|0),($733|0),($437|0),($438|0))|0);
 $735 = (getTempRet0() | 0);
 $736 = (_i64Add(($734|0),($735|0),($435|0),($436|0))|0);
 $737 = (getTempRet0() | 0);
 $738 = (_i64Add(($736|0),($737|0),($718|0),($719|0))|0);
 $739 = (getTempRet0() | 0);
 $740 = $716 & -2097152;
 $741 = (_i64Add(($487|0),($488|0),1048576,0)|0);
 $742 = (getTempRet0() | 0);
 $743 = (_bitshift64Ashr(($741|0),($742|0),21)|0);
 $744 = (getTempRet0() | 0);
 $745 = (_i64Add(($501|0),($502|0),($503|0),($504|0))|0);
 $746 = (getTempRet0() | 0);
 $747 = (_i64Add(($745|0),($746|0),($499|0),($500|0))|0);
 $748 = (getTempRet0() | 0);
 $749 = (_i64Add(($747|0),($748|0),($495|0),($496|0))|0);
 $750 = (getTempRet0() | 0);
 $751 = (_i64Add(($749|0),($750|0),($497|0),($498|0))|0);
 $752 = (getTempRet0() | 0);
 $753 = (_i64Add(($751|0),($752|0),($493|0),($494|0))|0);
 $754 = (getTempRet0() | 0);
 $755 = (_i64Add(($753|0),($754|0),($491|0),($492|0))|0);
 $756 = (getTempRet0() | 0);
 $757 = (_i64Add(($755|0),($756|0),($489|0),($490|0))|0);
 $758 = (getTempRet0() | 0);
 $759 = (_i64Add(($757|0),($758|0),($743|0),($744|0))|0);
 $760 = (getTempRet0() | 0);
 $761 = $741 & -2097152;
 $762 = (_i64Add(($529|0),($530|0),1048576,0)|0);
 $763 = (getTempRet0() | 0);
 $764 = (_bitshift64Ashr(($762|0),($763|0),21)|0);
 $765 = (getTempRet0() | 0);
 $766 = (_i64Add(($537|0),($538|0),($541|0),($542|0))|0);
 $767 = (getTempRet0() | 0);
 $768 = (_i64Add(($766|0),($767|0),($539|0),($540|0))|0);
 $769 = (getTempRet0() | 0);
 $770 = (_i64Add(($768|0),($769|0),($535|0),($536|0))|0);
 $771 = (getTempRet0() | 0);
 $772 = (_i64Add(($770|0),($771|0),($533|0),($534|0))|0);
 $773 = (getTempRet0() | 0);
 $774 = (_i64Add(($772|0),($773|0),($531|0),($532|0))|0);
 $775 = (getTempRet0() | 0);
 $776 = (_i64Add(($774|0),($775|0),($764|0),($765|0))|0);
 $777 = (getTempRet0() | 0);
 $778 = $762 & -2097152;
 $779 = (_i64Add(($559|0),($560|0),1048576,0)|0);
 $780 = (getTempRet0() | 0);
 $781 = (_bitshift64Ashr(($779|0),($780|0),21)|0);
 $782 = (getTempRet0() | 0);
 $783 = (_i64Add(($565|0),($566|0),($567|0),($568|0))|0);
 $784 = (getTempRet0() | 0);
 $785 = (_i64Add(($783|0),($784|0),($563|0),($564|0))|0);
 $786 = (getTempRet0() | 0);
 $787 = (_i64Add(($785|0),($786|0),($561|0),($562|0))|0);
 $788 = (getTempRet0() | 0);
 $789 = (_i64Add(($787|0),($788|0),($781|0),($782|0))|0);
 $790 = (getTempRet0() | 0);
 $791 = $779 & -2097152;
 $792 = (_i64Subtract(($559|0),($560|0),($791|0),($780|0))|0);
 $793 = (getTempRet0() | 0);
 $794 = (_i64Add(($577|0),($578|0),1048576,0)|0);
 $795 = (getTempRet0() | 0);
 $796 = (_bitshift64Lshr(($794|0),($795|0),21)|0);
 $797 = (getTempRet0() | 0);
 $798 = (_i64Add(($583|0),($584|0),($796|0),($797|0))|0);
 $799 = (getTempRet0() | 0);
 $800 = $794 & -2097152;
 $801 = $795 & 2147483647;
 $802 = (_i64Subtract(($577|0),($578|0),($800|0),($801|0))|0);
 $803 = (getTempRet0() | 0);
 $804 = (_i64Add(($585|0),($586|0),1048576,0)|0);
 $805 = (getTempRet0() | 0);
 $806 = (_bitshift64Lshr(($804|0),($805|0),21)|0);
 $807 = (getTempRet0() | 0);
 $808 = $804 & -2097152;
 $809 = $805 & 2147483647;
 $810 = (_i64Subtract(($585|0),($586|0),($808|0),($809|0))|0);
 $811 = (getTempRet0() | 0);
 $812 = (_i64Add(($595|0),($596|0),1048576,0)|0);
 $813 = (getTempRet0() | 0);
 $814 = (_bitshift64Lshr(($812|0),($813|0),21)|0);
 $815 = (getTempRet0() | 0);
 $816 = $812 & -2097152;
 $817 = (_i64Subtract(($595|0),($596|0),($816|0),($813|0))|0);
 $818 = (getTempRet0() | 0);
 $819 = (_i64Add(($613|0),($614|0),1048576,0)|0);
 $820 = (getTempRet0() | 0);
 $821 = (_bitshift64Ashr(($819|0),($820|0),21)|0);
 $822 = (getTempRet0() | 0);
 $823 = $819 & -2097152;
 $824 = (_i64Subtract(($613|0),($614|0),($823|0),($820|0))|0);
 $825 = (getTempRet0() | 0);
 $826 = (_i64Add(($632|0),($633|0),1048576,0)|0);
 $827 = (getTempRet0() | 0);
 $828 = (_bitshift64Ashr(($826|0),($827|0),21)|0);
 $829 = (getTempRet0() | 0);
 $830 = $826 & -2097152;
 $831 = (_i64Subtract(($632|0),($633|0),($830|0),($827|0))|0);
 $832 = (getTempRet0() | 0);
 $833 = (_i64Add(($655|0),($656|0),1048576,0)|0);
 $834 = (getTempRet0() | 0);
 $835 = (_bitshift64Ashr(($833|0),($834|0),21)|0);
 $836 = (getTempRet0() | 0);
 $837 = $833 & -2097152;
 $838 = (_i64Add(($682|0),($683|0),1048576,0)|0);
 $839 = (getTempRet0() | 0);
 $840 = (_bitshift64Ashr(($838|0),($839|0),21)|0);
 $841 = (getTempRet0() | 0);
 $842 = $838 & -2097152;
 $843 = (_i64Add(($713|0),($714|0),1048576,0)|0);
 $844 = (getTempRet0() | 0);
 $845 = (_bitshift64Ashr(($843|0),($844|0),21)|0);
 $846 = (getTempRet0() | 0);
 $847 = $843 & -2097152;
 $848 = (_i64Add(($738|0),($739|0),1048576,0)|0);
 $849 = (getTempRet0() | 0);
 $850 = (_bitshift64Ashr(($848|0),($849|0),21)|0);
 $851 = (getTempRet0() | 0);
 $852 = $848 & -2097152;
 $853 = (_i64Add(($759|0),($760|0),1048576,0)|0);
 $854 = (getTempRet0() | 0);
 $855 = (_bitshift64Ashr(($853|0),($854|0),21)|0);
 $856 = (getTempRet0() | 0);
 $857 = $853 & -2097152;
 $858 = (_i64Add(($776|0),($777|0),1048576,0)|0);
 $859 = (getTempRet0() | 0);
 $860 = (_bitshift64Ashr(($858|0),($859|0),21)|0);
 $861 = (getTempRet0() | 0);
 $862 = (_i64Add(($860|0),($861|0),($792|0),($793|0))|0);
 $863 = (getTempRet0() | 0);
 $864 = $858 & -2097152;
 $865 = (_i64Subtract(($776|0),($777|0),($864|0),($859|0))|0);
 $866 = (getTempRet0() | 0);
 $867 = (_i64Add(($789|0),($790|0),1048576,0)|0);
 $868 = (getTempRet0() | 0);
 $869 = (_bitshift64Ashr(($867|0),($868|0),21)|0);
 $870 = (getTempRet0() | 0);
 $871 = (_i64Add(($869|0),($870|0),($802|0),($803|0))|0);
 $872 = (getTempRet0() | 0);
 $873 = $867 & -2097152;
 $874 = (_i64Subtract(($789|0),($790|0),($873|0),($868|0))|0);
 $875 = (getTempRet0() | 0);
 $876 = (_i64Add(($798|0),($799|0),1048576,0)|0);
 $877 = (getTempRet0() | 0);
 $878 = (_bitshift64Lshr(($876|0),($877|0),21)|0);
 $879 = (getTempRet0() | 0);
 $880 = (_i64Add(($878|0),($879|0),($810|0),($811|0))|0);
 $881 = (getTempRet0() | 0);
 $882 = $876 & -2097152;
 $883 = $877 & 2147483647;
 $884 = (_i64Subtract(($798|0),($799|0),($882|0),($883|0))|0);
 $885 = (getTempRet0() | 0);
 $886 = (___muldi3(($806|0),($807|0),666643,0)|0);
 $887 = (getTempRet0() | 0);
 $888 = (___muldi3(($806|0),($807|0),470296,0)|0);
 $889 = (getTempRet0() | 0);
 $890 = (___muldi3(($806|0),($807|0),654183,0)|0);
 $891 = (getTempRet0() | 0);
 $892 = (___muldi3(($806|0),($807|0),-997805,-1)|0);
 $893 = (getTempRet0() | 0);
 $894 = (___muldi3(($806|0),($807|0),136657,0)|0);
 $895 = (getTempRet0() | 0);
 $896 = (___muldi3(($806|0),($807|0),-683901,-1)|0);
 $897 = (getTempRet0() | 0);
 $898 = (_i64Add(($529|0),($530|0),($896|0),($897|0))|0);
 $899 = (getTempRet0() | 0);
 $900 = (_i64Subtract(($898|0),($899|0),($778|0),($763|0))|0);
 $901 = (getTempRet0() | 0);
 $902 = (_i64Add(($900|0),($901|0),($855|0),($856|0))|0);
 $903 = (getTempRet0() | 0);
 $904 = (___muldi3(($880|0),($881|0),666643,0)|0);
 $905 = (getTempRet0() | 0);
 $906 = (___muldi3(($880|0),($881|0),470296,0)|0);
 $907 = (getTempRet0() | 0);
 $908 = (___muldi3(($880|0),($881|0),654183,0)|0);
 $909 = (getTempRet0() | 0);
 $910 = (___muldi3(($880|0),($881|0),-997805,-1)|0);
 $911 = (getTempRet0() | 0);
 $912 = (___muldi3(($880|0),($881|0),136657,0)|0);
 $913 = (getTempRet0() | 0);
 $914 = (___muldi3(($880|0),($881|0),-683901,-1)|0);
 $915 = (getTempRet0() | 0);
 $916 = (___muldi3(($884|0),($885|0),666643,0)|0);
 $917 = (getTempRet0() | 0);
 $918 = (___muldi3(($884|0),($885|0),470296,0)|0);
 $919 = (getTempRet0() | 0);
 $920 = (___muldi3(($884|0),($885|0),654183,0)|0);
 $921 = (getTempRet0() | 0);
 $922 = (___muldi3(($884|0),($885|0),-997805,-1)|0);
 $923 = (getTempRet0() | 0);
 $924 = (___muldi3(($884|0),($885|0),136657,0)|0);
 $925 = (getTempRet0() | 0);
 $926 = (___muldi3(($884|0),($885|0),-683901,-1)|0);
 $927 = (getTempRet0() | 0);
 $928 = (_i64Add(($487|0),($488|0),($892|0),($893|0))|0);
 $929 = (getTempRet0() | 0);
 $930 = (_i64Add(($928|0),($929|0),($912|0),($913|0))|0);
 $931 = (getTempRet0() | 0);
 $932 = (_i64Add(($930|0),($931|0),($926|0),($927|0))|0);
 $933 = (getTempRet0() | 0);
 $934 = (_i64Subtract(($932|0),($933|0),($761|0),($742|0))|0);
 $935 = (getTempRet0() | 0);
 $936 = (_i64Add(($934|0),($935|0),($850|0),($851|0))|0);
 $937 = (getTempRet0() | 0);
 $938 = (___muldi3(($871|0),($872|0),666643,0)|0);
 $939 = (getTempRet0() | 0);
 $940 = (___muldi3(($871|0),($872|0),470296,0)|0);
 $941 = (getTempRet0() | 0);
 $942 = (___muldi3(($871|0),($872|0),654183,0)|0);
 $943 = (getTempRet0() | 0);
 $944 = (___muldi3(($871|0),($872|0),-997805,-1)|0);
 $945 = (getTempRet0() | 0);
 $946 = (___muldi3(($871|0),($872|0),136657,0)|0);
 $947 = (getTempRet0() | 0);
 $948 = (___muldi3(($871|0),($872|0),-683901,-1)|0);
 $949 = (getTempRet0() | 0);
 $950 = (___muldi3(($874|0),($875|0),666643,0)|0);
 $951 = (getTempRet0() | 0);
 $952 = (___muldi3(($874|0),($875|0),470296,0)|0);
 $953 = (getTempRet0() | 0);
 $954 = (___muldi3(($874|0),($875|0),654183,0)|0);
 $955 = (getTempRet0() | 0);
 $956 = (___muldi3(($874|0),($875|0),-997805,-1)|0);
 $957 = (getTempRet0() | 0);
 $958 = (___muldi3(($874|0),($875|0),136657,0)|0);
 $959 = (getTempRet0() | 0);
 $960 = (___muldi3(($874|0),($875|0),-683901,-1)|0);
 $961 = (getTempRet0() | 0);
 $962 = (_i64Add(($908|0),($909|0),($888|0),($889|0))|0);
 $963 = (getTempRet0() | 0);
 $964 = (_i64Add(($962|0),($963|0),($922|0),($923|0))|0);
 $965 = (getTempRet0() | 0);
 $966 = (_i64Add(($964|0),($965|0),($433|0),($434|0))|0);
 $967 = (getTempRet0() | 0);
 $968 = (_i64Add(($966|0),($967|0),($946|0),($947|0))|0);
 $969 = (getTempRet0() | 0);
 $970 = (_i64Add(($968|0),($969|0),($960|0),($961|0))|0);
 $971 = (getTempRet0() | 0);
 $972 = (_i64Subtract(($970|0),($971|0),($740|0),($717|0))|0);
 $973 = (getTempRet0() | 0);
 $974 = (_i64Add(($972|0),($973|0),($845|0),($846|0))|0);
 $975 = (getTempRet0() | 0);
 $976 = (___muldi3(($862|0),($863|0),666643,0)|0);
 $977 = (getTempRet0() | 0);
 $978 = (_i64Add(($251|0),($252|0),($976|0),($977|0))|0);
 $979 = (getTempRet0() | 0);
 $980 = (_i64Add(($978|0),($979|0),($828|0),($829|0))|0);
 $981 = (getTempRet0() | 0);
 $982 = (_i64Subtract(($980|0),($981|0),($657|0),($636|0))|0);
 $983 = (getTempRet0() | 0);
 $984 = (___muldi3(($862|0),($863|0),470296,0)|0);
 $985 = (getTempRet0() | 0);
 $986 = (___muldi3(($862|0),($863|0),654183,0)|0);
 $987 = (getTempRet0() | 0);
 $988 = (_i64Add(($952|0),($953|0),($938|0),($939|0))|0);
 $989 = (getTempRet0() | 0);
 $990 = (_i64Add(($988|0),($989|0),($986|0),($987|0))|0);
 $991 = (getTempRet0() | 0);
 $992 = (_i64Add(($990|0),($991|0),($303|0),($304|0))|0);
 $993 = (getTempRet0() | 0);
 $994 = (_i64Subtract(($992|0),($993|0),($684|0),($659|0))|0);
 $995 = (getTempRet0() | 0);
 $996 = (_i64Add(($994|0),($995|0),($835|0),($836|0))|0);
 $997 = (getTempRet0() | 0);
 $998 = (___muldi3(($862|0),($863|0),-997805,-1)|0);
 $999 = (getTempRet0() | 0);
 $1000 = (___muldi3(($862|0),($863|0),136657,0)|0);
 $1001 = (getTempRet0() | 0);
 $1002 = (_i64Add(($918|0),($919|0),($904|0),($905|0))|0);
 $1003 = (getTempRet0() | 0);
 $1004 = (_i64Add(($1002|0),($1003|0),($942|0),($943|0))|0);
 $1005 = (getTempRet0() | 0);
 $1006 = (_i64Add(($1004|0),($1005|0),($956|0),($957|0))|0);
 $1007 = (getTempRet0() | 0);
 $1008 = (_i64Add(($1006|0),($1007|0),($1000|0),($1001|0))|0);
 $1009 = (getTempRet0() | 0);
 $1010 = (_i64Add(($1008|0),($1009|0),($367|0),($368|0))|0);
 $1011 = (getTempRet0() | 0);
 $1012 = (_i64Add(($1010|0),($1011|0),($840|0),($841|0))|0);
 $1013 = (getTempRet0() | 0);
 $1014 = (_i64Subtract(($1012|0),($1013|0),($715|0),($686|0))|0);
 $1015 = (getTempRet0() | 0);
 $1016 = (___muldi3(($862|0),($863|0),-683901,-1)|0);
 $1017 = (getTempRet0() | 0);
 $1018 = (_i64Add(($982|0),($983|0),1048576,0)|0);
 $1019 = (getTempRet0() | 0);
 $1020 = (_bitshift64Ashr(($1018|0),($1019|0),21)|0);
 $1021 = (getTempRet0() | 0);
 $1022 = (_i64Add(($984|0),($985|0),($950|0),($951|0))|0);
 $1023 = (getTempRet0() | 0);
 $1024 = (_i64Add(($1022|0),($1023|0),($655|0),($656|0))|0);
 $1025 = (getTempRet0() | 0);
 $1026 = (_i64Subtract(($1024|0),($1025|0),($837|0),($834|0))|0);
 $1027 = (getTempRet0() | 0);
 $1028 = (_i64Add(($1026|0),($1027|0),($1020|0),($1021|0))|0);
 $1029 = (getTempRet0() | 0);
 $1030 = $1018 & -2097152;
 $1031 = (_i64Add(($996|0),($997|0),1048576,0)|0);
 $1032 = (getTempRet0() | 0);
 $1033 = (_bitshift64Ashr(($1031|0),($1032|0),21)|0);
 $1034 = (getTempRet0() | 0);
 $1035 = (_i64Add(($940|0),($941|0),($916|0),($917|0))|0);
 $1036 = (getTempRet0() | 0);
 $1037 = (_i64Add(($1035|0),($1036|0),($954|0),($955|0))|0);
 $1038 = (getTempRet0() | 0);
 $1039 = (_i64Add(($1037|0),($1038|0),($998|0),($999|0))|0);
 $1040 = (getTempRet0() | 0);
 $1041 = (_i64Add(($1039|0),($1040|0),($682|0),($683|0))|0);
 $1042 = (getTempRet0() | 0);
 $1043 = (_i64Subtract(($1041|0),($1042|0),($842|0),($839|0))|0);
 $1044 = (getTempRet0() | 0);
 $1045 = (_i64Add(($1043|0),($1044|0),($1033|0),($1034|0))|0);
 $1046 = (getTempRet0() | 0);
 $1047 = $1031 & -2097152;
 $1048 = (_i64Add(($1014|0),($1015|0),1048576,0)|0);
 $1049 = (getTempRet0() | 0);
 $1050 = (_bitshift64Ashr(($1048|0),($1049|0),21)|0);
 $1051 = (getTempRet0() | 0);
 $1052 = (_i64Add(($906|0),($907|0),($886|0),($887|0))|0);
 $1053 = (getTempRet0() | 0);
 $1054 = (_i64Add(($1052|0),($1053|0),($920|0),($921|0))|0);
 $1055 = (getTempRet0() | 0);
 $1056 = (_i64Add(($1054|0),($1055|0),($944|0),($945|0))|0);
 $1057 = (getTempRet0() | 0);
 $1058 = (_i64Add(($1056|0),($1057|0),($958|0),($959|0))|0);
 $1059 = (getTempRet0() | 0);
 $1060 = (_i64Add(($1058|0),($1059|0),($1016|0),($1017|0))|0);
 $1061 = (getTempRet0() | 0);
 $1062 = (_i64Add(($1060|0),($1061|0),($713|0),($714|0))|0);
 $1063 = (getTempRet0() | 0);
 $1064 = (_i64Subtract(($1062|0),($1063|0),($847|0),($844|0))|0);
 $1065 = (getTempRet0() | 0);
 $1066 = (_i64Add(($1064|0),($1065|0),($1050|0),($1051|0))|0);
 $1067 = (getTempRet0() | 0);
 $1068 = $1048 & -2097152;
 $1069 = (_i64Add(($974|0),($975|0),1048576,0)|0);
 $1070 = (getTempRet0() | 0);
 $1071 = (_bitshift64Ashr(($1069|0),($1070|0),21)|0);
 $1072 = (getTempRet0() | 0);
 $1073 = (_i64Add(($910|0),($911|0),($890|0),($891|0))|0);
 $1074 = (getTempRet0() | 0);
 $1075 = (_i64Add(($1073|0),($1074|0),($924|0),($925|0))|0);
 $1076 = (getTempRet0() | 0);
 $1077 = (_i64Add(($1075|0),($1076|0),($948|0),($949|0))|0);
 $1078 = (getTempRet0() | 0);
 $1079 = (_i64Add(($1077|0),($1078|0),($738|0),($739|0))|0);
 $1080 = (getTempRet0() | 0);
 $1081 = (_i64Subtract(($1079|0),($1080|0),($852|0),($849|0))|0);
 $1082 = (getTempRet0() | 0);
 $1083 = (_i64Add(($1081|0),($1082|0),($1071|0),($1072|0))|0);
 $1084 = (getTempRet0() | 0);
 $1085 = $1069 & -2097152;
 $1086 = (_i64Subtract(($974|0),($975|0),($1085|0),($1070|0))|0);
 $1087 = (getTempRet0() | 0);
 $1088 = (_i64Add(($936|0),($937|0),1048576,0)|0);
 $1089 = (getTempRet0() | 0);
 $1090 = (_bitshift64Ashr(($1088|0),($1089|0),21)|0);
 $1091 = (getTempRet0() | 0);
 $1092 = (_i64Add(($914|0),($915|0),($894|0),($895|0))|0);
 $1093 = (getTempRet0() | 0);
 $1094 = (_i64Add(($1092|0),($1093|0),($759|0),($760|0))|0);
 $1095 = (getTempRet0() | 0);
 $1096 = (_i64Subtract(($1094|0),($1095|0),($857|0),($854|0))|0);
 $1097 = (getTempRet0() | 0);
 $1098 = (_i64Add(($1096|0),($1097|0),($1090|0),($1091|0))|0);
 $1099 = (getTempRet0() | 0);
 $1100 = $1088 & -2097152;
 $1101 = (_i64Subtract(($936|0),($937|0),($1100|0),($1089|0))|0);
 $1102 = (getTempRet0() | 0);
 $1103 = (_i64Add(($902|0),($903|0),1048576,0)|0);
 $1104 = (getTempRet0() | 0);
 $1105 = (_bitshift64Ashr(($1103|0),($1104|0),21)|0);
 $1106 = (getTempRet0() | 0);
 $1107 = (_i64Add(($1105|0),($1106|0),($865|0),($866|0))|0);
 $1108 = (getTempRet0() | 0);
 $1109 = $1103 & -2097152;
 $1110 = (_i64Subtract(($902|0),($903|0),($1109|0),($1104|0))|0);
 $1111 = (getTempRet0() | 0);
 $1112 = (_i64Add(($1028|0),($1029|0),1048576,0)|0);
 $1113 = (getTempRet0() | 0);
 $1114 = (_bitshift64Ashr(($1112|0),($1113|0),21)|0);
 $1115 = (getTempRet0() | 0);
 $1116 = $1112 & -2097152;
 $1117 = (_i64Add(($1045|0),($1046|0),1048576,0)|0);
 $1118 = (getTempRet0() | 0);
 $1119 = (_bitshift64Ashr(($1117|0),($1118|0),21)|0);
 $1120 = (getTempRet0() | 0);
 $1121 = $1117 & -2097152;
 $1122 = (_i64Add(($1066|0),($1067|0),1048576,0)|0);
 $1123 = (getTempRet0() | 0);
 $1124 = (_bitshift64Ashr(($1122|0),($1123|0),21)|0);
 $1125 = (getTempRet0() | 0);
 $1126 = (_i64Add(($1124|0),($1125|0),($1086|0),($1087|0))|0);
 $1127 = (getTempRet0() | 0);
 $1128 = $1122 & -2097152;
 $1129 = (_i64Subtract(($1066|0),($1067|0),($1128|0),($1123|0))|0);
 $1130 = (getTempRet0() | 0);
 $1131 = (_i64Add(($1083|0),($1084|0),1048576,0)|0);
 $1132 = (getTempRet0() | 0);
 $1133 = (_bitshift64Ashr(($1131|0),($1132|0),21)|0);
 $1134 = (getTempRet0() | 0);
 $1135 = (_i64Add(($1133|0),($1134|0),($1101|0),($1102|0))|0);
 $1136 = (getTempRet0() | 0);
 $1137 = $1131 & -2097152;
 $1138 = (_i64Subtract(($1083|0),($1084|0),($1137|0),($1132|0))|0);
 $1139 = (getTempRet0() | 0);
 $1140 = (_i64Add(($1098|0),($1099|0),1048576,0)|0);
 $1141 = (getTempRet0() | 0);
 $1142 = (_bitshift64Ashr(($1140|0),($1141|0),21)|0);
 $1143 = (getTempRet0() | 0);
 $1144 = (_i64Add(($1142|0),($1143|0),($1110|0),($1111|0))|0);
 $1145 = (getTempRet0() | 0);
 $1146 = $1140 & -2097152;
 $1147 = (_i64Subtract(($1098|0),($1099|0),($1146|0),($1141|0))|0);
 $1148 = (getTempRet0() | 0);
 $1149 = (___muldi3(($1107|0),($1108|0),666643,0)|0);
 $1150 = (getTempRet0() | 0);
 $1151 = (_i64Add(($831|0),($832|0),($1149|0),($1150|0))|0);
 $1152 = (getTempRet0() | 0);
 $1153 = (___muldi3(($1107|0),($1108|0),470296,0)|0);
 $1154 = (getTempRet0() | 0);
 $1155 = (___muldi3(($1107|0),($1108|0),654183,0)|0);
 $1156 = (getTempRet0() | 0);
 $1157 = (___muldi3(($1107|0),($1108|0),-997805,-1)|0);
 $1158 = (getTempRet0() | 0);
 $1159 = (___muldi3(($1107|0),($1108|0),136657,0)|0);
 $1160 = (getTempRet0() | 0);
 $1161 = (___muldi3(($1107|0),($1108|0),-683901,-1)|0);
 $1162 = (getTempRet0() | 0);
 $1163 = (_i64Add(($1014|0),($1015|0),($1161|0),($1162|0))|0);
 $1164 = (getTempRet0() | 0);
 $1165 = (_i64Add(($1163|0),($1164|0),($1119|0),($1120|0))|0);
 $1166 = (getTempRet0() | 0);
 $1167 = (_i64Subtract(($1165|0),($1166|0),($1068|0),($1049|0))|0);
 $1168 = (getTempRet0() | 0);
 $1169 = (___muldi3(($1144|0),($1145|0),666643,0)|0);
 $1170 = (getTempRet0() | 0);
 $1171 = (___muldi3(($1144|0),($1145|0),470296,0)|0);
 $1172 = (getTempRet0() | 0);
 $1173 = (_i64Add(($1151|0),($1152|0),($1171|0),($1172|0))|0);
 $1174 = (getTempRet0() | 0);
 $1175 = (___muldi3(($1144|0),($1145|0),654183,0)|0);
 $1176 = (getTempRet0() | 0);
 $1177 = (___muldi3(($1144|0),($1145|0),-997805,-1)|0);
 $1178 = (getTempRet0() | 0);
 $1179 = (___muldi3(($1144|0),($1145|0),136657,0)|0);
 $1180 = (getTempRet0() | 0);
 $1181 = (___muldi3(($1144|0),($1145|0),-683901,-1)|0);
 $1182 = (getTempRet0() | 0);
 $1183 = (___muldi3(($1147|0),($1148|0),666643,0)|0);
 $1184 = (getTempRet0() | 0);
 $1185 = (_i64Add(($824|0),($825|0),($1183|0),($1184|0))|0);
 $1186 = (getTempRet0() | 0);
 $1187 = (___muldi3(($1147|0),($1148|0),470296,0)|0);
 $1188 = (getTempRet0() | 0);
 $1189 = (___muldi3(($1147|0),($1148|0),654183,0)|0);
 $1190 = (getTempRet0() | 0);
 $1191 = (_i64Add(($1173|0),($1174|0),($1189|0),($1190|0))|0);
 $1192 = (getTempRet0() | 0);
 $1193 = (___muldi3(($1147|0),($1148|0),-997805,-1)|0);
 $1194 = (getTempRet0() | 0);
 $1195 = (___muldi3(($1147|0),($1148|0),136657,0)|0);
 $1196 = (getTempRet0() | 0);
 $1197 = (___muldi3(($1147|0),($1148|0),-683901,-1)|0);
 $1198 = (getTempRet0() | 0);
 $1199 = (_i64Add(($996|0),($997|0),($1157|0),($1158|0))|0);
 $1200 = (getTempRet0() | 0);
 $1201 = (_i64Add(($1199|0),($1200|0),($1114|0),($1115|0))|0);
 $1202 = (getTempRet0() | 0);
 $1203 = (_i64Subtract(($1201|0),($1202|0),($1047|0),($1032|0))|0);
 $1204 = (getTempRet0() | 0);
 $1205 = (_i64Add(($1203|0),($1204|0),($1179|0),($1180|0))|0);
 $1206 = (getTempRet0() | 0);
 $1207 = (_i64Add(($1205|0),($1206|0),($1197|0),($1198|0))|0);
 $1208 = (getTempRet0() | 0);
 $1209 = (___muldi3(($1135|0),($1136|0),666643,0)|0);
 $1210 = (getTempRet0() | 0);
 $1211 = (___muldi3(($1135|0),($1136|0),470296,0)|0);
 $1212 = (getTempRet0() | 0);
 $1213 = (___muldi3(($1135|0),($1136|0),654183,0)|0);
 $1214 = (getTempRet0() | 0);
 $1215 = (___muldi3(($1135|0),($1136|0),-997805,-1)|0);
 $1216 = (getTempRet0() | 0);
 $1217 = (___muldi3(($1135|0),($1136|0),136657,0)|0);
 $1218 = (getTempRet0() | 0);
 $1219 = (___muldi3(($1135|0),($1136|0),-683901,-1)|0);
 $1220 = (getTempRet0() | 0);
 $1221 = (___muldi3(($1138|0),($1139|0),666643,0)|0);
 $1222 = (getTempRet0() | 0);
 $1223 = (___muldi3(($1138|0),($1139|0),470296,0)|0);
 $1224 = (getTempRet0() | 0);
 $1225 = (___muldi3(($1138|0),($1139|0),654183,0)|0);
 $1226 = (getTempRet0() | 0);
 $1227 = (___muldi3(($1138|0),($1139|0),-997805,-1)|0);
 $1228 = (getTempRet0() | 0);
 $1229 = (___muldi3(($1138|0),($1139|0),136657,0)|0);
 $1230 = (getTempRet0() | 0);
 $1231 = (___muldi3(($1138|0),($1139|0),-683901,-1)|0);
 $1232 = (getTempRet0() | 0);
 $1233 = (_i64Add(($1153|0),($1154|0),($982|0),($983|0))|0);
 $1234 = (getTempRet0() | 0);
 $1235 = (_i64Subtract(($1233|0),($1234|0),($1030|0),($1019|0))|0);
 $1236 = (getTempRet0() | 0);
 $1237 = (_i64Add(($1235|0),($1236|0),($1175|0),($1176|0))|0);
 $1238 = (getTempRet0() | 0);
 $1239 = (_i64Add(($1237|0),($1238|0),($1193|0),($1194|0))|0);
 $1240 = (getTempRet0() | 0);
 $1241 = (_i64Add(($1239|0),($1240|0),($1217|0),($1218|0))|0);
 $1242 = (getTempRet0() | 0);
 $1243 = (_i64Add(($1241|0),($1242|0),($1231|0),($1232|0))|0);
 $1244 = (getTempRet0() | 0);
 $1245 = (___muldi3(($1126|0),($1127|0),666643,0)|0);
 $1246 = (getTempRet0() | 0);
 $1247 = (_i64Add(($1245|0),($1246|0),($599|0),($600|0))|0);
 $1248 = (getTempRet0() | 0);
 $1249 = (___muldi3(($1126|0),($1127|0),470296,0)|0);
 $1250 = (getTempRet0() | 0);
 $1251 = (___muldi3(($1126|0),($1127|0),654183,0)|0);
 $1252 = (getTempRet0() | 0);
 $1253 = (_i64Add(($814|0),($815|0),($183|0),($184|0))|0);
 $1254 = (getTempRet0() | 0);
 $1255 = (_i64Subtract(($1253|0),($1254|0),($615|0),($602|0))|0);
 $1256 = (getTempRet0() | 0);
 $1257 = (_i64Add(($1255|0),($1256|0),($1251|0),($1252|0))|0);
 $1258 = (getTempRet0() | 0);
 $1259 = (_i64Add(($1257|0),($1258|0),($1209|0),($1210|0))|0);
 $1260 = (getTempRet0() | 0);
 $1261 = (_i64Add(($1259|0),($1260|0),($1223|0),($1224|0))|0);
 $1262 = (getTempRet0() | 0);
 $1263 = (___muldi3(($1126|0),($1127|0),-997805,-1)|0);
 $1264 = (getTempRet0() | 0);
 $1265 = (___muldi3(($1126|0),($1127|0),136657,0)|0);
 $1266 = (getTempRet0() | 0);
 $1267 = (_i64Add(($821|0),($822|0),($211|0),($212|0))|0);
 $1268 = (getTempRet0() | 0);
 $1269 = (_i64Subtract(($1267|0),($1268|0),($634|0),($617|0))|0);
 $1270 = (getTempRet0() | 0);
 $1271 = (_i64Add(($1269|0),($1270|0),($1169|0),($1170|0))|0);
 $1272 = (getTempRet0() | 0);
 $1273 = (_i64Add(($1271|0),($1272|0),($1187|0),($1188|0))|0);
 $1274 = (getTempRet0() | 0);
 $1275 = (_i64Add(($1273|0),($1274|0),($1265|0),($1266|0))|0);
 $1276 = (getTempRet0() | 0);
 $1277 = (_i64Add(($1275|0),($1276|0),($1213|0),($1214|0))|0);
 $1278 = (getTempRet0() | 0);
 $1279 = (_i64Add(($1277|0),($1278|0),($1227|0),($1228|0))|0);
 $1280 = (getTempRet0() | 0);
 $1281 = (___muldi3(($1126|0),($1127|0),-683901,-1)|0);
 $1282 = (getTempRet0() | 0);
 $1283 = (_i64Add(($1247|0),($1248|0),1048576,0)|0);
 $1284 = (getTempRet0() | 0);
 $1285 = (_bitshift64Ashr(($1283|0),($1284|0),21)|0);
 $1286 = (getTempRet0() | 0);
 $1287 = (_i64Add(($817|0),($818|0),($1249|0),($1250|0))|0);
 $1288 = (getTempRet0() | 0);
 $1289 = (_i64Add(($1287|0),($1288|0),($1221|0),($1222|0))|0);
 $1290 = (getTempRet0() | 0);
 $1291 = (_i64Add(($1289|0),($1290|0),($1285|0),($1286|0))|0);
 $1292 = (getTempRet0() | 0);
 $1293 = $1283 & -2097152;
 $1294 = (_i64Subtract(($1247|0),($1248|0),($1293|0),($1284|0))|0);
 $1295 = (getTempRet0() | 0);
 $1296 = (_i64Add(($1261|0),($1262|0),1048576,0)|0);
 $1297 = (getTempRet0() | 0);
 $1298 = (_bitshift64Ashr(($1296|0),($1297|0),21)|0);
 $1299 = (getTempRet0() | 0);
 $1300 = (_i64Add(($1185|0),($1186|0),($1263|0),($1264|0))|0);
 $1301 = (getTempRet0() | 0);
 $1302 = (_i64Add(($1300|0),($1301|0),($1211|0),($1212|0))|0);
 $1303 = (getTempRet0() | 0);
 $1304 = (_i64Add(($1302|0),($1303|0),($1225|0),($1226|0))|0);
 $1305 = (getTempRet0() | 0);
 $1306 = (_i64Add(($1304|0),($1305|0),($1298|0),($1299|0))|0);
 $1307 = (getTempRet0() | 0);
 $1308 = $1296 & -2097152;
 $1309 = (_i64Add(($1279|0),($1280|0),1048576,0)|0);
 $1310 = (getTempRet0() | 0);
 $1311 = (_bitshift64Ashr(($1309|0),($1310|0),21)|0);
 $1312 = (getTempRet0() | 0);
 $1313 = (_i64Add(($1191|0),($1192|0),($1281|0),($1282|0))|0);
 $1314 = (getTempRet0() | 0);
 $1315 = (_i64Add(($1313|0),($1314|0),($1215|0),($1216|0))|0);
 $1316 = (getTempRet0() | 0);
 $1317 = (_i64Add(($1315|0),($1316|0),($1229|0),($1230|0))|0);
 $1318 = (getTempRet0() | 0);
 $1319 = (_i64Add(($1317|0),($1318|0),($1311|0),($1312|0))|0);
 $1320 = (getTempRet0() | 0);
 $1321 = $1309 & -2097152;
 $1322 = (_i64Add(($1243|0),($1244|0),1048576,0)|0);
 $1323 = (getTempRet0() | 0);
 $1324 = (_bitshift64Ashr(($1322|0),($1323|0),21)|0);
 $1325 = (getTempRet0() | 0);
 $1326 = (_i64Add(($1028|0),($1029|0),($1155|0),($1156|0))|0);
 $1327 = (getTempRet0() | 0);
 $1328 = (_i64Subtract(($1326|0),($1327|0),($1116|0),($1113|0))|0);
 $1329 = (getTempRet0() | 0);
 $1330 = (_i64Add(($1328|0),($1329|0),($1177|0),($1178|0))|0);
 $1331 = (getTempRet0() | 0);
 $1332 = (_i64Add(($1330|0),($1331|0),($1195|0),($1196|0))|0);
 $1333 = (getTempRet0() | 0);
 $1334 = (_i64Add(($1332|0),($1333|0),($1219|0),($1220|0))|0);
 $1335 = (getTempRet0() | 0);
 $1336 = (_i64Add(($1334|0),($1335|0),($1324|0),($1325|0))|0);
 $1337 = (getTempRet0() | 0);
 $1338 = $1322 & -2097152;
 $1339 = (_i64Subtract(($1243|0),($1244|0),($1338|0),($1323|0))|0);
 $1340 = (getTempRet0() | 0);
 $1341 = (_i64Add(($1207|0),($1208|0),1048576,0)|0);
 $1342 = (getTempRet0() | 0);
 $1343 = (_bitshift64Ashr(($1341|0),($1342|0),21)|0);
 $1344 = (getTempRet0() | 0);
 $1345 = (_i64Add(($1181|0),($1182|0),($1159|0),($1160|0))|0);
 $1346 = (getTempRet0() | 0);
 $1347 = (_i64Add(($1345|0),($1346|0),($1045|0),($1046|0))|0);
 $1348 = (getTempRet0() | 0);
 $1349 = (_i64Subtract(($1347|0),($1348|0),($1121|0),($1118|0))|0);
 $1350 = (getTempRet0() | 0);
 $1351 = (_i64Add(($1349|0),($1350|0),($1343|0),($1344|0))|0);
 $1352 = (getTempRet0() | 0);
 $1353 = $1341 & -2097152;
 $1354 = (_i64Subtract(($1207|0),($1208|0),($1353|0),($1342|0))|0);
 $1355 = (getTempRet0() | 0);
 $1356 = (_i64Add(($1167|0),($1168|0),1048576,0)|0);
 $1357 = (getTempRet0() | 0);
 $1358 = (_bitshift64Ashr(($1356|0),($1357|0),21)|0);
 $1359 = (getTempRet0() | 0);
 $1360 = (_i64Add(($1129|0),($1130|0),($1358|0),($1359|0))|0);
 $1361 = (getTempRet0() | 0);
 $1362 = $1356 & -2097152;
 $1363 = (_i64Add(($1291|0),($1292|0),1048576,0)|0);
 $1364 = (getTempRet0() | 0);
 $1365 = (_bitshift64Ashr(($1363|0),($1364|0),21)|0);
 $1366 = (getTempRet0() | 0);
 $1367 = $1363 & -2097152;
 $1368 = (_i64Add(($1306|0),($1307|0),1048576,0)|0);
 $1369 = (getTempRet0() | 0);
 $1370 = (_bitshift64Ashr(($1368|0),($1369|0),21)|0);
 $1371 = (getTempRet0() | 0);
 $1372 = $1368 & -2097152;
 $1373 = (_i64Add(($1319|0),($1320|0),1048576,0)|0);
 $1374 = (getTempRet0() | 0);
 $1375 = (_bitshift64Ashr(($1373|0),($1374|0),21)|0);
 $1376 = (getTempRet0() | 0);
 $1377 = (_i64Add(($1339|0),($1340|0),($1375|0),($1376|0))|0);
 $1378 = (getTempRet0() | 0);
 $1379 = $1373 & -2097152;
 $1380 = (_i64Add(($1336|0),($1337|0),1048576,0)|0);
 $1381 = (getTempRet0() | 0);
 $1382 = (_bitshift64Ashr(($1380|0),($1381|0),21)|0);
 $1383 = (getTempRet0() | 0);
 $1384 = (_i64Add(($1354|0),($1355|0),($1382|0),($1383|0))|0);
 $1385 = (getTempRet0() | 0);
 $1386 = $1380 & -2097152;
 $1387 = (_i64Subtract(($1336|0),($1337|0),($1386|0),($1381|0))|0);
 $1388 = (getTempRet0() | 0);
 $1389 = (_i64Add(($1351|0),($1352|0),1048576,0)|0);
 $1390 = (getTempRet0() | 0);
 $1391 = (_bitshift64Ashr(($1389|0),($1390|0),21)|0);
 $1392 = (getTempRet0() | 0);
 $1393 = $1389 & -2097152;
 $1394 = (_i64Subtract(($1351|0),($1352|0),($1393|0),($1390|0))|0);
 $1395 = (getTempRet0() | 0);
 $1396 = (_i64Add(($1360|0),($1361|0),1048576,0)|0);
 $1397 = (getTempRet0() | 0);
 $1398 = (_bitshift64Ashr(($1396|0),($1397|0),21)|0);
 $1399 = (getTempRet0() | 0);
 $1400 = $1396 & -2097152;
 $1401 = (_i64Subtract(($1360|0),($1361|0),($1400|0),($1397|0))|0);
 $1402 = (getTempRet0() | 0);
 $1403 = (___muldi3(($1398|0),($1399|0),666643,0)|0);
 $1404 = (getTempRet0() | 0);
 $1405 = (_i64Add(($1294|0),($1295|0),($1403|0),($1404|0))|0);
 $1406 = (getTempRet0() | 0);
 $1407 = (___muldi3(($1398|0),($1399|0),470296,0)|0);
 $1408 = (getTempRet0() | 0);
 $1409 = (___muldi3(($1398|0),($1399|0),654183,0)|0);
 $1410 = (getTempRet0() | 0);
 $1411 = (___muldi3(($1398|0),($1399|0),-997805,-1)|0);
 $1412 = (getTempRet0() | 0);
 $1413 = (___muldi3(($1398|0),($1399|0),136657,0)|0);
 $1414 = (getTempRet0() | 0);
 $1415 = (___muldi3(($1398|0),($1399|0),-683901,-1)|0);
 $1416 = (getTempRet0() | 0);
 $1417 = (_bitshift64Ashr(($1405|0),($1406|0),21)|0);
 $1418 = (getTempRet0() | 0);
 $1419 = (_i64Add(($1291|0),($1292|0),($1407|0),($1408|0))|0);
 $1420 = (getTempRet0() | 0);
 $1421 = (_i64Subtract(($1419|0),($1420|0),($1367|0),($1364|0))|0);
 $1422 = (getTempRet0() | 0);
 $1423 = (_i64Add(($1421|0),($1422|0),($1417|0),($1418|0))|0);
 $1424 = (getTempRet0() | 0);
 $1425 = $1405 & 2097151;
 $1426 = (_bitshift64Ashr(($1423|0),($1424|0),21)|0);
 $1427 = (getTempRet0() | 0);
 $1428 = (_i64Add(($1261|0),($1262|0),($1409|0),($1410|0))|0);
 $1429 = (getTempRet0() | 0);
 $1430 = (_i64Subtract(($1428|0),($1429|0),($1308|0),($1297|0))|0);
 $1431 = (getTempRet0() | 0);
 $1432 = (_i64Add(($1430|0),($1431|0),($1365|0),($1366|0))|0);
 $1433 = (getTempRet0() | 0);
 $1434 = (_i64Add(($1432|0),($1433|0),($1426|0),($1427|0))|0);
 $1435 = (getTempRet0() | 0);
 $1436 = $1423 & 2097151;
 $1437 = (_bitshift64Ashr(($1434|0),($1435|0),21)|0);
 $1438 = (getTempRet0() | 0);
 $1439 = (_i64Add(($1306|0),($1307|0),($1411|0),($1412|0))|0);
 $1440 = (getTempRet0() | 0);
 $1441 = (_i64Subtract(($1439|0),($1440|0),($1372|0),($1369|0))|0);
 $1442 = (getTempRet0() | 0);
 $1443 = (_i64Add(($1441|0),($1442|0),($1437|0),($1438|0))|0);
 $1444 = (getTempRet0() | 0);
 $1445 = $1434 & 2097151;
 $1446 = (_bitshift64Ashr(($1443|0),($1444|0),21)|0);
 $1447 = (getTempRet0() | 0);
 $1448 = (_i64Add(($1279|0),($1280|0),($1413|0),($1414|0))|0);
 $1449 = (getTempRet0() | 0);
 $1450 = (_i64Subtract(($1448|0),($1449|0),($1321|0),($1310|0))|0);
 $1451 = (getTempRet0() | 0);
 $1452 = (_i64Add(($1450|0),($1451|0),($1370|0),($1371|0))|0);
 $1453 = (getTempRet0() | 0);
 $1454 = (_i64Add(($1452|0),($1453|0),($1446|0),($1447|0))|0);
 $1455 = (getTempRet0() | 0);
 $1456 = $1443 & 2097151;
 $1457 = (_bitshift64Ashr(($1454|0),($1455|0),21)|0);
 $1458 = (getTempRet0() | 0);
 $1459 = (_i64Add(($1319|0),($1320|0),($1415|0),($1416|0))|0);
 $1460 = (getTempRet0() | 0);
 $1461 = (_i64Subtract(($1459|0),($1460|0),($1379|0),($1374|0))|0);
 $1462 = (getTempRet0() | 0);
 $1463 = (_i64Add(($1461|0),($1462|0),($1457|0),($1458|0))|0);
 $1464 = (getTempRet0() | 0);
 $1465 = $1454 & 2097151;
 $1466 = (_bitshift64Ashr(($1463|0),($1464|0),21)|0);
 $1467 = (getTempRet0() | 0);
 $1468 = (_i64Add(($1377|0),($1378|0),($1466|0),($1467|0))|0);
 $1469 = (getTempRet0() | 0);
 $1470 = $1463 & 2097151;
 $1471 = (_bitshift64Ashr(($1468|0),($1469|0),21)|0);
 $1472 = (getTempRet0() | 0);
 $1473 = (_i64Add(($1471|0),($1472|0),($1387|0),($1388|0))|0);
 $1474 = (getTempRet0() | 0);
 $1475 = $1468 & 2097151;
 $1476 = (_bitshift64Ashr(($1473|0),($1474|0),21)|0);
 $1477 = (getTempRet0() | 0);
 $1478 = (_i64Add(($1384|0),($1385|0),($1476|0),($1477|0))|0);
 $1479 = (getTempRet0() | 0);
 $1480 = $1473 & 2097151;
 $1481 = (_bitshift64Ashr(($1478|0),($1479|0),21)|0);
 $1482 = (getTempRet0() | 0);
 $1483 = (_i64Add(($1481|0),($1482|0),($1394|0),($1395|0))|0);
 $1484 = (getTempRet0() | 0);
 $1485 = $1478 & 2097151;
 $1486 = (_bitshift64Ashr(($1483|0),($1484|0),21)|0);
 $1487 = (getTempRet0() | 0);
 $1488 = (_i64Add(($1391|0),($1392|0),($1167|0),($1168|0))|0);
 $1489 = (getTempRet0() | 0);
 $1490 = (_i64Subtract(($1488|0),($1489|0),($1362|0),($1357|0))|0);
 $1491 = (getTempRet0() | 0);
 $1492 = (_i64Add(($1490|0),($1491|0),($1486|0),($1487|0))|0);
 $1493 = (getTempRet0() | 0);
 $1494 = $1483 & 2097151;
 $1495 = (_bitshift64Ashr(($1492|0),($1493|0),21)|0);
 $1496 = (getTempRet0() | 0);
 $1497 = (_i64Add(($1495|0),($1496|0),($1401|0),($1402|0))|0);
 $1498 = (getTempRet0() | 0);
 $1499 = $1492 & 2097151;
 $1500 = (_bitshift64Ashr(($1497|0),($1498|0),21)|0);
 $1501 = (getTempRet0() | 0);
 $1502 = $1497 & 2097151;
 $1503 = (___muldi3(($1500|0),($1501|0),666643,0)|0);
 $1504 = (getTempRet0() | 0);
 $1505 = (_i64Add(($1503|0),($1504|0),($1425|0),0)|0);
 $1506 = (getTempRet0() | 0);
 $1507 = (___muldi3(($1500|0),($1501|0),470296,0)|0);
 $1508 = (getTempRet0() | 0);
 $1509 = (_i64Add(($1507|0),($1508|0),($1436|0),0)|0);
 $1510 = (getTempRet0() | 0);
 $1511 = (___muldi3(($1500|0),($1501|0),654183,0)|0);
 $1512 = (getTempRet0() | 0);
 $1513 = (_i64Add(($1511|0),($1512|0),($1445|0),0)|0);
 $1514 = (getTempRet0() | 0);
 $1515 = (___muldi3(($1500|0),($1501|0),-997805,-1)|0);
 $1516 = (getTempRet0() | 0);
 $1517 = (_i64Add(($1515|0),($1516|0),($1456|0),0)|0);
 $1518 = (getTempRet0() | 0);
 $1519 = (___muldi3(($1500|0),($1501|0),136657,0)|0);
 $1520 = (getTempRet0() | 0);
 $1521 = (_i64Add(($1519|0),($1520|0),($1465|0),0)|0);
 $1522 = (getTempRet0() | 0);
 $1523 = (___muldi3(($1500|0),($1501|0),-683901,-1)|0);
 $1524 = (getTempRet0() | 0);
 $1525 = (_i64Add(($1523|0),($1524|0),($1470|0),0)|0);
 $1526 = (getTempRet0() | 0);
 $1527 = (_bitshift64Ashr(($1505|0),($1506|0),21)|0);
 $1528 = (getTempRet0() | 0);
 $1529 = (_i64Add(($1509|0),($1510|0),($1527|0),($1528|0))|0);
 $1530 = (getTempRet0() | 0);
 $1531 = (_bitshift64Ashr(($1529|0),($1530|0),21)|0);
 $1532 = (getTempRet0() | 0);
 $1533 = (_i64Add(($1513|0),($1514|0),($1531|0),($1532|0))|0);
 $1534 = (getTempRet0() | 0);
 $1535 = $1529 & 2097151;
 $1536 = (_bitshift64Ashr(($1533|0),($1534|0),21)|0);
 $1537 = (getTempRet0() | 0);
 $1538 = (_i64Add(($1517|0),($1518|0),($1536|0),($1537|0))|0);
 $1539 = (getTempRet0() | 0);
 $1540 = $1533 & 2097151;
 $1541 = (_bitshift64Ashr(($1538|0),($1539|0),21)|0);
 $1542 = (getTempRet0() | 0);
 $1543 = (_i64Add(($1521|0),($1522|0),($1541|0),($1542|0))|0);
 $1544 = (getTempRet0() | 0);
 $1545 = $1538 & 2097151;
 $1546 = (_bitshift64Ashr(($1543|0),($1544|0),21)|0);
 $1547 = (getTempRet0() | 0);
 $1548 = (_i64Add(($1525|0),($1526|0),($1546|0),($1547|0))|0);
 $1549 = (getTempRet0() | 0);
 $1550 = $1543 & 2097151;
 $1551 = (_bitshift64Ashr(($1548|0),($1549|0),21)|0);
 $1552 = (getTempRet0() | 0);
 $1553 = (_i64Add(($1551|0),($1552|0),($1475|0),0)|0);
 $1554 = (getTempRet0() | 0);
 $1555 = $1548 & 2097151;
 $1556 = (_bitshift64Ashr(($1553|0),($1554|0),21)|0);
 $1557 = (getTempRet0() | 0);
 $1558 = (_i64Add(($1556|0),($1557|0),($1480|0),0)|0);
 $1559 = (getTempRet0() | 0);
 $1560 = $1553 & 2097151;
 $1561 = (_bitshift64Ashr(($1558|0),($1559|0),21)|0);
 $1562 = (getTempRet0() | 0);
 $1563 = (_i64Add(($1561|0),($1562|0),($1485|0),0)|0);
 $1564 = (getTempRet0() | 0);
 $1565 = (_bitshift64Ashr(($1563|0),($1564|0),21)|0);
 $1566 = (getTempRet0() | 0);
 $1567 = (_i64Add(($1565|0),($1566|0),($1494|0),0)|0);
 $1568 = (getTempRet0() | 0);
 $1569 = (_bitshift64Ashr(($1567|0),($1568|0),21)|0);
 $1570 = (getTempRet0() | 0);
 $1571 = (_i64Add(($1569|0),($1570|0),($1499|0),0)|0);
 $1572 = (getTempRet0() | 0);
 $1573 = $1567 & 2097151;
 $1574 = (_bitshift64Ashr(($1571|0),($1572|0),21)|0);
 $1575 = (getTempRet0() | 0);
 $1576 = (_i64Add(($1574|0),($1575|0),($1502|0),0)|0);
 $1577 = (getTempRet0() | 0);
 $1578 = $1571 & 2097151;
 $1579 = $1505&255;
 HEAP8[$s>>0] = $1579;
 $1580 = (_bitshift64Lshr(($1505|0),($1506|0),8)|0);
 $1581 = (getTempRet0() | 0);
 $1582 = $1580&255;
 $arrayidx895 = ((($s)) + 1|0);
 HEAP8[$arrayidx895>>0] = $1582;
 $1583 = (_bitshift64Lshr(($1505|0),($1506|0),16)|0);
 $1584 = (getTempRet0() | 0);
 $1585 = $1583 & 31;
 $1586 = (_bitshift64Shl(($1535|0),0,5)|0);
 $1587 = (getTempRet0() | 0);
 $1588 = $1586 | $1585;
 $1589 = $1588&255;
 $arrayidx899 = ((($s)) + 2|0);
 HEAP8[$arrayidx899>>0] = $1589;
 $1590 = (_bitshift64Lshr(($1529|0),($1530|0),3)|0);
 $1591 = (getTempRet0() | 0);
 $1592 = $1590&255;
 $arrayidx902 = ((($s)) + 3|0);
 HEAP8[$arrayidx902>>0] = $1592;
 $1593 = (_bitshift64Lshr(($1529|0),($1530|0),11)|0);
 $1594 = (getTempRet0() | 0);
 $1595 = $1593&255;
 $arrayidx905 = ((($s)) + 4|0);
 HEAP8[$arrayidx905>>0] = $1595;
 $1596 = (_bitshift64Lshr(($1535|0),0,19)|0);
 $1597 = (getTempRet0() | 0);
 $1598 = (_bitshift64Shl(($1540|0),0,2)|0);
 $1599 = (getTempRet0() | 0);
 $1600 = $1598 | $1596;
 $1599 | $1597;
 $1601 = $1600&255;
 $arrayidx910 = ((($s)) + 5|0);
 HEAP8[$arrayidx910>>0] = $1601;
 $1602 = (_bitshift64Lshr(($1533|0),($1534|0),6)|0);
 $1603 = (getTempRet0() | 0);
 $1604 = $1602&255;
 $arrayidx913 = ((($s)) + 6|0);
 HEAP8[$arrayidx913>>0] = $1604;
 $1605 = (_bitshift64Lshr(($1540|0),0,14)|0);
 $1606 = (getTempRet0() | 0);
 $1607 = (_bitshift64Shl(($1545|0),0,7)|0);
 $1608 = (getTempRet0() | 0);
 $1609 = $1607 | $1605;
 $1608 | $1606;
 $1610 = $1609&255;
 $arrayidx918 = ((($s)) + 7|0);
 HEAP8[$arrayidx918>>0] = $1610;
 $1611 = (_bitshift64Lshr(($1538|0),($1539|0),1)|0);
 $1612 = (getTempRet0() | 0);
 $1613 = $1611&255;
 $arrayidx921 = ((($s)) + 8|0);
 HEAP8[$arrayidx921>>0] = $1613;
 $1614 = (_bitshift64Lshr(($1538|0),($1539|0),9)|0);
 $1615 = (getTempRet0() | 0);
 $1616 = $1614&255;
 $arrayidx924 = ((($s)) + 9|0);
 HEAP8[$arrayidx924>>0] = $1616;
 $1617 = (_bitshift64Lshr(($1545|0),0,17)|0);
 $1618 = (getTempRet0() | 0);
 $1619 = (_bitshift64Shl(($1550|0),0,4)|0);
 $1620 = (getTempRet0() | 0);
 $1621 = $1619 | $1617;
 $1620 | $1618;
 $1622 = $1621&255;
 $arrayidx929 = ((($s)) + 10|0);
 HEAP8[$arrayidx929>>0] = $1622;
 $1623 = (_bitshift64Lshr(($1543|0),($1544|0),4)|0);
 $1624 = (getTempRet0() | 0);
 $1625 = $1623&255;
 $arrayidx932 = ((($s)) + 11|0);
 HEAP8[$arrayidx932>>0] = $1625;
 $1626 = (_bitshift64Lshr(($1543|0),($1544|0),12)|0);
 $1627 = (getTempRet0() | 0);
 $1628 = $1626&255;
 $arrayidx935 = ((($s)) + 12|0);
 HEAP8[$arrayidx935>>0] = $1628;
 $1629 = (_bitshift64Lshr(($1550|0),0,20)|0);
 $1630 = (getTempRet0() | 0);
 $1631 = (_bitshift64Shl(($1555|0),0,1)|0);
 $1632 = (getTempRet0() | 0);
 $1633 = $1631 | $1629;
 $1632 | $1630;
 $1634 = $1633&255;
 $arrayidx940 = ((($s)) + 13|0);
 HEAP8[$arrayidx940>>0] = $1634;
 $1635 = (_bitshift64Lshr(($1548|0),($1549|0),7)|0);
 $1636 = (getTempRet0() | 0);
 $1637 = $1635&255;
 $arrayidx943 = ((($s)) + 14|0);
 HEAP8[$arrayidx943>>0] = $1637;
 $1638 = (_bitshift64Lshr(($1555|0),0,15)|0);
 $1639 = (getTempRet0() | 0);
 $1640 = (_bitshift64Shl(($1560|0),0,6)|0);
 $1641 = (getTempRet0() | 0);
 $1642 = $1640 | $1638;
 $1641 | $1639;
 $1643 = $1642&255;
 $arrayidx948 = ((($s)) + 15|0);
 HEAP8[$arrayidx948>>0] = $1643;
 $1644 = (_bitshift64Lshr(($1553|0),($1554|0),2)|0);
 $1645 = (getTempRet0() | 0);
 $1646 = $1644&255;
 $arrayidx951 = ((($s)) + 16|0);
 HEAP8[$arrayidx951>>0] = $1646;
 $1647 = (_bitshift64Lshr(($1553|0),($1554|0),10)|0);
 $1648 = (getTempRet0() | 0);
 $1649 = $1647&255;
 $arrayidx954 = ((($s)) + 17|0);
 HEAP8[$arrayidx954>>0] = $1649;
 $1650 = (_bitshift64Lshr(($1560|0),0,18)|0);
 $1651 = (getTempRet0() | 0);
 $1652 = (_bitshift64Shl(($1558|0),($1559|0),3)|0);
 $1653 = (getTempRet0() | 0);
 $1654 = $1652 | $1650;
 $1653 | $1651;
 $1655 = $1654&255;
 $arrayidx959 = ((($s)) + 18|0);
 HEAP8[$arrayidx959>>0] = $1655;
 $1656 = (_bitshift64Lshr(($1558|0),($1559|0),5)|0);
 $1657 = (getTempRet0() | 0);
 $1658 = $1656&255;
 $arrayidx962 = ((($s)) + 19|0);
 HEAP8[$arrayidx962>>0] = $1658;
 $1659 = (_bitshift64Lshr(($1558|0),($1559|0),13)|0);
 $1660 = (getTempRet0() | 0);
 $1661 = $1659&255;
 $arrayidx965 = ((($s)) + 20|0);
 HEAP8[$arrayidx965>>0] = $1661;
 $1662 = $1563&255;
 $arrayidx968 = ((($s)) + 21|0);
 HEAP8[$arrayidx968>>0] = $1662;
 $1663 = (_bitshift64Lshr(($1563|0),($1564|0),8)|0);
 $1664 = (getTempRet0() | 0);
 $1665 = $1663&255;
 $arrayidx971 = ((($s)) + 22|0);
 HEAP8[$arrayidx971>>0] = $1665;
 $1666 = (_bitshift64Lshr(($1563|0),($1564|0),16)|0);
 $1667 = (getTempRet0() | 0);
 $1668 = $1666 & 31;
 $1669 = (_bitshift64Shl(($1573|0),0,5)|0);
 $1670 = (getTempRet0() | 0);
 $1671 = $1669 | $1668;
 $1672 = $1671&255;
 $arrayidx976 = ((($s)) + 23|0);
 HEAP8[$arrayidx976>>0] = $1672;
 $1673 = (_bitshift64Lshr(($1567|0),($1568|0),3)|0);
 $1674 = (getTempRet0() | 0);
 $1675 = $1673&255;
 $arrayidx979 = ((($s)) + 24|0);
 HEAP8[$arrayidx979>>0] = $1675;
 $1676 = (_bitshift64Lshr(($1567|0),($1568|0),11)|0);
 $1677 = (getTempRet0() | 0);
 $1678 = $1676&255;
 $arrayidx982 = ((($s)) + 25|0);
 HEAP8[$arrayidx982>>0] = $1678;
 $1679 = (_bitshift64Lshr(($1573|0),0,19)|0);
 $1680 = (getTempRet0() | 0);
 $1681 = (_bitshift64Shl(($1578|0),0,2)|0);
 $1682 = (getTempRet0() | 0);
 $1683 = $1681 | $1679;
 $1682 | $1680;
 $1684 = $1683&255;
 $arrayidx987 = ((($s)) + 26|0);
 HEAP8[$arrayidx987>>0] = $1684;
 $1685 = (_bitshift64Lshr(($1571|0),($1572|0),6)|0);
 $1686 = (getTempRet0() | 0);
 $1687 = $1685&255;
 $arrayidx990 = ((($s)) + 27|0);
 HEAP8[$arrayidx990>>0] = $1687;
 $1688 = (_bitshift64Lshr(($1578|0),0,14)|0);
 $1689 = (getTempRet0() | 0);
 $1690 = (_bitshift64Shl(($1576|0),($1577|0),7)|0);
 $1691 = (getTempRet0() | 0);
 $1692 = $1690 | $1688;
 $1691 | $1689;
 $1693 = $1692&255;
 $arrayidx995 = ((($s)) + 28|0);
 HEAP8[$arrayidx995>>0] = $1693;
 $1694 = (_bitshift64Lshr(($1576|0),($1577|0),1)|0);
 $1695 = (getTempRet0() | 0);
 $1696 = $1694&255;
 $arrayidx998 = ((($s)) + 29|0);
 HEAP8[$arrayidx998>>0] = $1696;
 $1697 = (_bitshift64Lshr(($1576|0),($1577|0),9)|0);
 $1698 = (getTempRet0() | 0);
 $1699 = $1697&255;
 $arrayidx1001 = ((($s)) + 30|0);
 HEAP8[$arrayidx1001>>0] = $1699;
 $1700 = (_bitshift64Ashr(($1576|0),($1577|0),17)|0);
 $1701 = (getTempRet0() | 0);
 $1702 = $1700&255;
 $arrayidx1004 = ((($s)) + 31|0);
 HEAP8[$arrayidx1004>>0] = $1702;
 return;
}
function _sha512_init($md) {
 $md = $md|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $arrayidx = 0, $arrayidx10 = 0, $arrayidx12 = 0, $arrayidx14 = 0;
 var $arrayidx2 = 0, $arrayidx4 = 0, $arrayidx6 = 0, $arrayidx8 = 0, $cmp = 0, $curlen = 0, $retval$0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $cmp = ($md|0)==(0|0);
 if ($cmp) {
  $retval$0 = 1;
  return ($retval$0|0);
 }
 $curlen = ((($md)) + 72|0);
 HEAP32[$curlen>>2] = 0;
 $0 = $md;
 $1 = $0;
 HEAP32[$1>>2] = 0;
 $2 = (($0) + 4)|0;
 $3 = $2;
 HEAP32[$3>>2] = 0;
 $arrayidx = ((($md)) + 8|0);
 $4 = $arrayidx;
 $5 = $4;
 HEAP32[$5>>2] = -205731576;
 $6 = (($4) + 4)|0;
 $7 = $6;
 HEAP32[$7>>2] = 1779033703;
 $arrayidx2 = ((($md)) + 16|0);
 $8 = $arrayidx2;
 $9 = $8;
 HEAP32[$9>>2] = -2067093701;
 $10 = (($8) + 4)|0;
 $11 = $10;
 HEAP32[$11>>2] = -1150833019;
 $arrayidx4 = ((($md)) + 24|0);
 $12 = $arrayidx4;
 $13 = $12;
 HEAP32[$13>>2] = -23791573;
 $14 = (($12) + 4)|0;
 $15 = $14;
 HEAP32[$15>>2] = 1013904242;
 $arrayidx6 = ((($md)) + 32|0);
 $16 = $arrayidx6;
 $17 = $16;
 HEAP32[$17>>2] = 1595750129;
 $18 = (($16) + 4)|0;
 $19 = $18;
 HEAP32[$19>>2] = -1521486534;
 $arrayidx8 = ((($md)) + 40|0);
 $20 = $arrayidx8;
 $21 = $20;
 HEAP32[$21>>2] = -1377402159;
 $22 = (($20) + 4)|0;
 $23 = $22;
 HEAP32[$23>>2] = 1359893119;
 $arrayidx10 = ((($md)) + 48|0);
 $24 = $arrayidx10;
 $25 = $24;
 HEAP32[$25>>2] = 725511199;
 $26 = (($24) + 4)|0;
 $27 = $26;
 HEAP32[$27>>2] = -1694144372;
 $arrayidx12 = ((($md)) + 56|0);
 $28 = $arrayidx12;
 $29 = $28;
 HEAP32[$29>>2] = -79577749;
 $30 = (($28) + 4)|0;
 $31 = $30;
 HEAP32[$31>>2] = 528734635;
 $arrayidx14 = ((($md)) + 64|0);
 $32 = $arrayidx14;
 $33 = $32;
 HEAP32[$33>>2] = 327033209;
 $34 = (($32) + 4)|0;
 $35 = $34;
 HEAP32[$35>>2] = 1541459225;
 $retval$0 = 0;
 return ($retval$0|0);
}
function _sha512_update($md,$in,$inlen) {
 $md = $md|0;
 $in = $in|0;
 $inlen = $inlen|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $3 = 0, $4 = 0, $5 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $add$ptr = 0, $add$ptr26 = 0, $add22 = 0, $add25 = 0, $arraydecay = 0, $arrayidx = 0, $arrayidx23 = 0, $cmp = 0, $cmp1 = 0, $cmp10 = 0, $cmp17 = 0;
 var $cmp20 = 0, $cmp2035 = 0, $cmp29 = 0, $cmp4 = 0, $cmp7 = 0, $cmp737 = 0, $cmp9 = 0, $curlen = 0, $i$036 = 0, $in$addr$038 = 0, $in$addr$1 = 0, $inc = 0, $inlen$addr$0$sub16 = 0, $inlen$addr$039 = 0, $inlen$addr$1 = 0, $or$cond = 0, $or$cond34 = 0, $retval$0 = 0, $sub = 0, $sub16 = 0;
 var $sub27 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $cmp = ($md|0)==(0|0);
 $cmp1 = ($in|0)==(0|0);
 $or$cond34 = $cmp | $cmp1;
 if ($or$cond34) {
  $retval$0 = 1;
  return ($retval$0|0);
 }
 $curlen = ((($md)) + 72|0);
 $0 = HEAP32[$curlen>>2]|0;
 $cmp4 = ($0>>>0)>(128);
 if ($cmp4) {
  $retval$0 = 1;
  return ($retval$0|0);
 }
 $cmp737 = ($inlen|0)==(0);
 if ($cmp737) {
  $retval$0 = 0;
  return ($retval$0|0);
 }
 $arraydecay = ((($md)) + 76|0);
 $in$addr$038 = $in;$inlen$addr$039 = $inlen;
 while(1) {
  $1 = HEAP32[$curlen>>2]|0;
  $cmp9 = ($1|0)==(0);
  $cmp10 = ($inlen$addr$039>>>0)>(127);
  $or$cond = $cmp10 & $cmp9;
  if ($or$cond) {
   _sha512_compress($md,$in$addr$038);
   $2 = $md;
   $3 = $2;
   $4 = HEAP32[$3>>2]|0;
   $5 = (($2) + 4)|0;
   $6 = $5;
   $7 = HEAP32[$6>>2]|0;
   $8 = (_i64Add(($4|0),($7|0),1024,0)|0);
   $9 = (getTempRet0() | 0);
   $10 = $md;
   $11 = $10;
   HEAP32[$11>>2] = $8;
   $12 = (($10) + 4)|0;
   $13 = $12;
   HEAP32[$13>>2] = $9;
   $add$ptr = ((($in$addr$038)) + 128|0);
   $sub = (($inlen$addr$039) + -128)|0;
   $in$addr$1 = $add$ptr;$inlen$addr$1 = $sub;
  } else {
   $sub16 = (128 - ($1))|0;
   $cmp17 = ($inlen$addr$039>>>0)<($sub16>>>0);
   $inlen$addr$0$sub16 = $cmp17 ? $inlen$addr$039 : $sub16;
   $cmp2035 = ($inlen$addr$0$sub16|0)==(0);
   if (!($cmp2035)) {
    $i$036 = 0;
    while(1) {
     $arrayidx = (($in$addr$038) + ($i$036)|0);
     $14 = HEAP8[$arrayidx>>0]|0;
     $15 = HEAP32[$curlen>>2]|0;
     $add22 = (($15) + ($i$036))|0;
     $arrayidx23 = (((($md)) + 76|0) + ($add22)|0);
     HEAP8[$arrayidx23>>0] = $14;
     $inc = (($i$036) + 1)|0;
     $cmp20 = ($inc>>>0)<($inlen$addr$0$sub16>>>0);
     if ($cmp20) {
      $i$036 = $inc;
     } else {
      break;
     }
    }
   }
   $16 = HEAP32[$curlen>>2]|0;
   $add25 = (($16) + ($inlen$addr$0$sub16))|0;
   HEAP32[$curlen>>2] = $add25;
   $add$ptr26 = (($in$addr$038) + ($inlen$addr$0$sub16)|0);
   $sub27 = (($inlen$addr$039) - ($inlen$addr$0$sub16))|0;
   $cmp29 = ($add25|0)==(128);
   if ($cmp29) {
    _sha512_compress($md,$arraydecay);
    $17 = $md;
    $18 = $17;
    $19 = HEAP32[$18>>2]|0;
    $20 = (($17) + 4)|0;
    $21 = $20;
    $22 = HEAP32[$21>>2]|0;
    $23 = (_i64Add(($19|0),($22|0),1024,0)|0);
    $24 = (getTempRet0() | 0);
    $25 = $md;
    $26 = $25;
    HEAP32[$26>>2] = $23;
    $27 = (($25) + 4)|0;
    $28 = $27;
    HEAP32[$28>>2] = $24;
    HEAP32[$curlen>>2] = 0;
    $in$addr$1 = $add$ptr26;$inlen$addr$1 = $sub27;
   } else {
    $in$addr$1 = $add$ptr26;$inlen$addr$1 = $sub27;
   }
  }
  $cmp7 = ($inlen$addr$1|0)==(0);
  if ($cmp7) {
   $retval$0 = 0;
   break;
  } else {
   $in$addr$038 = $in$addr$1;$inlen$addr$039 = $inlen$addr$1;
  }
 }
 return ($retval$0|0);
}
function _sha512_compress($md,$buf) {
 $md = $md|0;
 $buf = $buf|0;
 var $0 = 0, $1 = 0, $10 = 0, $100 = 0, $1000 = 0, $1001 = 0, $1002 = 0, $1003 = 0, $1004 = 0, $1005 = 0, $1006 = 0, $1007 = 0, $1008 = 0, $1009 = 0, $101 = 0, $1010 = 0, $1011 = 0, $1012 = 0, $1013 = 0, $1014 = 0;
 var $1015 = 0, $1016 = 0, $1017 = 0, $1018 = 0, $1019 = 0, $102 = 0, $1020 = 0, $1021 = 0, $1022 = 0, $1023 = 0, $1024 = 0, $1025 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0;
 var $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0, $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0;
 var $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0, $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0, $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0;
 var $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0, $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0, $160 = 0, $161 = 0, $162 = 0, $163 = 0, $164 = 0;
 var $165 = 0, $166 = 0, $167 = 0, $168 = 0, $169 = 0, $17 = 0, $170 = 0, $171 = 0, $172 = 0, $173 = 0, $174 = 0, $175 = 0, $176 = 0, $177 = 0, $178 = 0, $179 = 0, $18 = 0, $180 = 0, $181 = 0, $182 = 0;
 var $183 = 0, $184 = 0, $185 = 0, $186 = 0, $187 = 0, $188 = 0, $189 = 0, $19 = 0, $190 = 0, $191 = 0, $192 = 0, $193 = 0, $194 = 0, $195 = 0, $196 = 0, $197 = 0, $198 = 0, $199 = 0, $2 = 0, $20 = 0;
 var $200 = 0, $201 = 0, $202 = 0, $203 = 0, $204 = 0, $205 = 0, $206 = 0, $207 = 0, $208 = 0, $209 = 0, $21 = 0, $210 = 0, $211 = 0, $212 = 0, $213 = 0, $214 = 0, $215 = 0, $216 = 0, $217 = 0, $218 = 0;
 var $219 = 0, $22 = 0, $220 = 0, $221 = 0, $222 = 0, $223 = 0, $224 = 0, $225 = 0, $226 = 0, $227 = 0, $228 = 0, $229 = 0, $23 = 0, $230 = 0, $231 = 0, $232 = 0, $233 = 0, $234 = 0, $235 = 0, $236 = 0;
 var $237 = 0, $238 = 0, $239 = 0, $24 = 0, $240 = 0, $241 = 0, $242 = 0, $243 = 0, $244 = 0, $245 = 0, $246 = 0, $247 = 0, $248 = 0, $249 = 0, $25 = 0, $250 = 0, $251 = 0, $252 = 0, $253 = 0, $254 = 0;
 var $255 = 0, $256 = 0, $257 = 0, $258 = 0, $259 = 0, $26 = 0, $260 = 0, $261 = 0, $262 = 0, $263 = 0, $264 = 0, $265 = 0, $266 = 0, $267 = 0, $268 = 0, $269 = 0, $27 = 0, $270 = 0, $271 = 0, $272 = 0;
 var $273 = 0, $274 = 0, $275 = 0, $276 = 0, $277 = 0, $278 = 0, $279 = 0, $28 = 0, $280 = 0, $281 = 0, $282 = 0, $283 = 0, $284 = 0, $285 = 0, $286 = 0, $287 = 0, $288 = 0, $289 = 0, $29 = 0, $290 = 0;
 var $291 = 0, $292 = 0, $293 = 0, $294 = 0, $295 = 0, $296 = 0, $297 = 0, $298 = 0, $299 = 0, $3 = 0, $30 = 0, $300 = 0, $301 = 0, $302 = 0, $303 = 0, $304 = 0, $305 = 0, $306 = 0, $307 = 0, $308 = 0;
 var $309 = 0, $31 = 0, $310 = 0, $311 = 0, $312 = 0, $313 = 0, $314 = 0, $315 = 0, $316 = 0, $317 = 0, $318 = 0, $319 = 0, $32 = 0, $320 = 0, $321 = 0, $322 = 0, $323 = 0, $324 = 0, $325 = 0, $326 = 0;
 var $327 = 0, $328 = 0, $329 = 0, $33 = 0, $330 = 0, $331 = 0, $332 = 0, $333 = 0, $334 = 0, $335 = 0, $336 = 0, $337 = 0, $338 = 0, $339 = 0, $34 = 0, $340 = 0, $341 = 0, $342 = 0, $343 = 0, $344 = 0;
 var $345 = 0, $346 = 0, $347 = 0, $348 = 0, $349 = 0, $35 = 0, $350 = 0, $351 = 0, $352 = 0, $353 = 0, $354 = 0, $355 = 0, $356 = 0, $357 = 0, $358 = 0, $359 = 0, $36 = 0, $360 = 0, $361 = 0, $362 = 0;
 var $363 = 0, $364 = 0, $365 = 0, $366 = 0, $367 = 0, $368 = 0, $369 = 0, $37 = 0, $370 = 0, $371 = 0, $372 = 0, $373 = 0, $374 = 0, $375 = 0, $376 = 0, $377 = 0, $378 = 0, $379 = 0, $38 = 0, $380 = 0;
 var $381 = 0, $382 = 0, $383 = 0, $384 = 0, $385 = 0, $386 = 0, $387 = 0, $388 = 0, $389 = 0, $39 = 0, $390 = 0, $391 = 0, $392 = 0, $393 = 0, $394 = 0, $395 = 0, $396 = 0, $397 = 0, $398 = 0, $399 = 0;
 var $4 = 0, $40 = 0, $400 = 0, $401 = 0, $402 = 0, $403 = 0, $404 = 0, $405 = 0, $406 = 0, $407 = 0, $408 = 0, $409 = 0, $41 = 0, $410 = 0, $411 = 0, $412 = 0, $413 = 0, $414 = 0, $415 = 0, $416 = 0;
 var $417 = 0, $418 = 0, $419 = 0, $42 = 0, $420 = 0, $421 = 0, $422 = 0, $423 = 0, $424 = 0, $425 = 0, $426 = 0, $427 = 0, $428 = 0, $429 = 0, $43 = 0, $430 = 0, $431 = 0, $432 = 0, $433 = 0, $434 = 0;
 var $435 = 0, $436 = 0, $437 = 0, $438 = 0, $439 = 0, $44 = 0, $440 = 0, $441 = 0, $442 = 0, $443 = 0, $444 = 0, $445 = 0, $446 = 0, $447 = 0, $448 = 0, $449 = 0, $45 = 0, $450 = 0, $451 = 0, $452 = 0;
 var $453 = 0, $454 = 0, $455 = 0, $456 = 0, $457 = 0, $458 = 0, $459 = 0, $46 = 0, $460 = 0, $461 = 0, $462 = 0, $463 = 0, $464 = 0, $465 = 0, $466 = 0, $467 = 0, $468 = 0, $469 = 0, $47 = 0, $470 = 0;
 var $471 = 0, $472 = 0, $473 = 0, $474 = 0, $475 = 0, $476 = 0, $477 = 0, $478 = 0, $479 = 0, $48 = 0, $480 = 0, $481 = 0, $482 = 0, $483 = 0, $484 = 0, $485 = 0, $486 = 0, $487 = 0, $488 = 0, $489 = 0;
 var $49 = 0, $490 = 0, $491 = 0, $492 = 0, $493 = 0, $494 = 0, $495 = 0, $496 = 0, $497 = 0, $498 = 0, $499 = 0, $5 = 0, $50 = 0, $500 = 0, $501 = 0, $502 = 0, $503 = 0, $504 = 0, $505 = 0, $506 = 0;
 var $507 = 0, $508 = 0, $509 = 0, $51 = 0, $510 = 0, $511 = 0, $512 = 0, $513 = 0, $514 = 0, $515 = 0, $516 = 0, $517 = 0, $518 = 0, $519 = 0, $52 = 0, $520 = 0, $521 = 0, $522 = 0, $523 = 0, $524 = 0;
 var $525 = 0, $526 = 0, $527 = 0, $528 = 0, $529 = 0, $53 = 0, $530 = 0, $531 = 0, $532 = 0, $533 = 0, $534 = 0, $535 = 0, $536 = 0, $537 = 0, $538 = 0, $539 = 0, $54 = 0, $540 = 0, $541 = 0, $542 = 0;
 var $543 = 0, $544 = 0, $545 = 0, $546 = 0, $547 = 0, $548 = 0, $549 = 0, $55 = 0, $550 = 0, $551 = 0, $552 = 0, $553 = 0, $554 = 0, $555 = 0, $556 = 0, $557 = 0, $558 = 0, $559 = 0, $56 = 0, $560 = 0;
 var $561 = 0, $562 = 0, $563 = 0, $564 = 0, $565 = 0, $566 = 0, $567 = 0, $568 = 0, $569 = 0, $57 = 0, $570 = 0, $571 = 0, $572 = 0, $573 = 0, $574 = 0, $575 = 0, $576 = 0, $577 = 0, $578 = 0, $579 = 0;
 var $58 = 0, $580 = 0, $581 = 0, $582 = 0, $583 = 0, $584 = 0, $585 = 0, $586 = 0, $587 = 0, $588 = 0, $589 = 0, $59 = 0, $590 = 0, $591 = 0, $592 = 0, $593 = 0, $594 = 0, $595 = 0, $596 = 0, $597 = 0;
 var $598 = 0, $599 = 0, $6 = 0, $60 = 0, $600 = 0, $601 = 0, $602 = 0, $603 = 0, $604 = 0, $605 = 0, $606 = 0, $607 = 0, $608 = 0, $609 = 0, $61 = 0, $610 = 0, $611 = 0, $612 = 0, $613 = 0, $614 = 0;
 var $615 = 0, $616 = 0, $617 = 0, $618 = 0, $619 = 0, $62 = 0, $620 = 0, $621 = 0, $622 = 0, $623 = 0, $624 = 0, $625 = 0, $626 = 0, $627 = 0, $628 = 0, $629 = 0, $63 = 0, $630 = 0, $631 = 0, $632 = 0;
 var $633 = 0, $634 = 0, $635 = 0, $636 = 0, $637 = 0, $638 = 0, $639 = 0, $64 = 0, $640 = 0, $641 = 0, $642 = 0, $643 = 0, $644 = 0, $645 = 0, $646 = 0, $647 = 0, $648 = 0, $649 = 0, $65 = 0, $650 = 0;
 var $651 = 0, $652 = 0, $653 = 0, $654 = 0, $655 = 0, $656 = 0, $657 = 0, $658 = 0, $659 = 0, $66 = 0, $660 = 0, $661 = 0, $662 = 0, $663 = 0, $664 = 0, $665 = 0, $666 = 0, $667 = 0, $668 = 0, $669 = 0;
 var $67 = 0, $670 = 0, $671 = 0, $672 = 0, $673 = 0, $674 = 0, $675 = 0, $676 = 0, $677 = 0, $678 = 0, $679 = 0, $68 = 0, $680 = 0, $681 = 0, $682 = 0, $683 = 0, $684 = 0, $685 = 0, $686 = 0, $687 = 0;
 var $688 = 0, $689 = 0, $69 = 0, $690 = 0, $691 = 0, $692 = 0, $693 = 0, $694 = 0, $695 = 0, $696 = 0, $697 = 0, $698 = 0, $699 = 0, $7 = 0, $70 = 0, $700 = 0, $701 = 0, $702 = 0, $703 = 0, $704 = 0;
 var $705 = 0, $706 = 0, $707 = 0, $708 = 0, $709 = 0, $71 = 0, $710 = 0, $711 = 0, $712 = 0, $713 = 0, $714 = 0, $715 = 0, $716 = 0, $717 = 0, $718 = 0, $719 = 0, $72 = 0, $720 = 0, $721 = 0, $722 = 0;
 var $723 = 0, $724 = 0, $725 = 0, $726 = 0, $727 = 0, $728 = 0, $729 = 0, $73 = 0, $730 = 0, $731 = 0, $732 = 0, $733 = 0, $734 = 0, $735 = 0, $736 = 0, $737 = 0, $738 = 0, $739 = 0, $74 = 0, $740 = 0;
 var $741 = 0, $742 = 0, $743 = 0, $744 = 0, $745 = 0, $746 = 0, $747 = 0, $748 = 0, $749 = 0, $75 = 0, $750 = 0, $751 = 0, $752 = 0, $753 = 0, $754 = 0, $755 = 0, $756 = 0, $757 = 0, $758 = 0, $759 = 0;
 var $76 = 0, $760 = 0, $761 = 0, $762 = 0, $763 = 0, $764 = 0, $765 = 0, $766 = 0, $767 = 0, $768 = 0, $769 = 0, $77 = 0, $770 = 0, $771 = 0, $772 = 0, $773 = 0, $774 = 0, $775 = 0, $776 = 0, $777 = 0;
 var $778 = 0, $779 = 0, $78 = 0, $780 = 0, $781 = 0, $782 = 0, $783 = 0, $784 = 0, $785 = 0, $786 = 0, $787 = 0, $788 = 0, $789 = 0, $79 = 0, $790 = 0, $791 = 0, $792 = 0, $793 = 0, $794 = 0, $795 = 0;
 var $796 = 0, $797 = 0, $798 = 0, $799 = 0, $8 = 0, $80 = 0, $800 = 0, $801 = 0, $802 = 0, $803 = 0, $804 = 0, $805 = 0, $806 = 0, $807 = 0, $808 = 0, $809 = 0, $81 = 0, $810 = 0, $811 = 0, $812 = 0;
 var $813 = 0, $814 = 0, $815 = 0, $816 = 0, $817 = 0, $818 = 0, $819 = 0, $82 = 0, $820 = 0, $821 = 0, $822 = 0, $823 = 0, $824 = 0, $825 = 0, $826 = 0, $827 = 0, $828 = 0, $829 = 0, $83 = 0, $830 = 0;
 var $831 = 0, $832 = 0, $833 = 0, $834 = 0, $835 = 0, $836 = 0, $837 = 0, $838 = 0, $839 = 0, $84 = 0, $840 = 0, $841 = 0, $842 = 0, $843 = 0, $844 = 0, $845 = 0, $846 = 0, $847 = 0, $848 = 0, $849 = 0;
 var $85 = 0, $850 = 0, $851 = 0, $852 = 0, $853 = 0, $854 = 0, $855 = 0, $856 = 0, $857 = 0, $858 = 0, $859 = 0, $86 = 0, $860 = 0, $861 = 0, $862 = 0, $863 = 0, $864 = 0, $865 = 0, $866 = 0, $867 = 0;
 var $868 = 0, $869 = 0, $87 = 0, $870 = 0, $871 = 0, $872 = 0, $873 = 0, $874 = 0, $875 = 0, $876 = 0, $877 = 0, $878 = 0, $879 = 0, $88 = 0, $880 = 0, $881 = 0, $882 = 0, $883 = 0, $884 = 0, $885 = 0;
 var $886 = 0, $887 = 0, $888 = 0, $889 = 0, $89 = 0, $890 = 0, $891 = 0, $892 = 0, $893 = 0, $894 = 0, $895 = 0, $896 = 0, $897 = 0, $898 = 0, $899 = 0, $9 = 0, $90 = 0, $900 = 0, $901 = 0, $902 = 0;
 var $903 = 0, $904 = 0, $905 = 0, $906 = 0, $907 = 0, $908 = 0, $909 = 0, $91 = 0, $910 = 0, $911 = 0, $912 = 0, $913 = 0, $914 = 0, $915 = 0, $916 = 0, $917 = 0, $918 = 0, $919 = 0, $92 = 0, $920 = 0;
 var $921 = 0, $922 = 0, $923 = 0, $924 = 0, $925 = 0, $926 = 0, $927 = 0, $928 = 0, $929 = 0, $93 = 0, $930 = 0, $931 = 0, $932 = 0, $933 = 0, $934 = 0, $935 = 0, $936 = 0, $937 = 0, $938 = 0, $939 = 0;
 var $94 = 0, $940 = 0, $941 = 0, $942 = 0, $943 = 0, $944 = 0, $945 = 0, $946 = 0, $947 = 0, $948 = 0, $949 = 0, $95 = 0, $950 = 0, $951 = 0, $952 = 0, $953 = 0, $954 = 0, $955 = 0, $956 = 0, $957 = 0;
 var $958 = 0, $959 = 0, $96 = 0, $960 = 0, $961 = 0, $962 = 0, $963 = 0, $964 = 0, $965 = 0, $966 = 0, $967 = 0, $968 = 0, $969 = 0, $97 = 0, $970 = 0, $971 = 0, $972 = 0, $973 = 0, $974 = 0, $975 = 0;
 var $976 = 0, $977 = 0, $978 = 0, $979 = 0, $98 = 0, $980 = 0, $981 = 0, $982 = 0, $983 = 0, $984 = 0, $985 = 0, $986 = 0, $987 = 0, $988 = 0, $989 = 0, $99 = 0, $990 = 0, $991 = 0, $992 = 0, $993 = 0;
 var $994 = 0, $995 = 0, $996 = 0, $997 = 0, $998 = 0, $999 = 0, $S = 0, $W = 0, $add$ptr = 0, $add209 = 0, $add273 = 0, $add337 = 0, $add401 = 0, $add465 = 0, $add529 = 0, $add593 = 0, $add631 = 0, $arrayidx108 = 0, $arrayidx110 = 0, $arrayidx118 = 0;
 var $arrayidx119 = 0, $arrayidx137 = 0, $arrayidx139 = 0, $arrayidx146 = 0, $arrayidx149 = 0, $arrayidx16 = 0, $arrayidx169 = 0, $arrayidx171 = 0, $arrayidx178 = 0, $arrayidx210 = 0, $arrayidx213 = 0, $arrayidx24 = 0, $arrayidx274 = 0, $arrayidx277 = 0, $arrayidx32 = 0, $arrayidx338 = 0, $arrayidx341 = 0, $arrayidx40 = 0, $arrayidx402 = 0, $arrayidx405 = 0;
 var $arrayidx466 = 0, $arrayidx469 = 0, $arrayidx48 = 0, $arrayidx530 = 0, $arrayidx533 = 0, $arrayidx56 = 0, $arrayidx594 = 0, $arrayidx597 = 0, $arrayidx61 = 0, $arrayidx638 = 0, $arrayidx638$1 = 0, $arrayidx638$2 = 0, $arrayidx638$3 = 0, $arrayidx638$4 = 0, $arrayidx638$5 = 0, $arrayidx638$6 = 0, $arrayidx638$7 = 0, $arrayidx639$1 = 0, $arrayidx639$2 = 0, $arrayidx639$3 = 0;
 var $arrayidx639$4 = 0, $arrayidx639$5 = 0, $arrayidx639$6 = 0, $arrayidx639$7 = 0, $arrayidx69 = 0, $arrayidx86 = 0, $arrayidx88 = 0, $arrayidx9 = 0, $cmp115 = 0, $exitcond = 0, $exitcond14 = 0, $i$112 = 0, $i$211 = 0, $i$32 = 0, $inc112 = 0, $inc63 = 0, $mul = 0, $scevgep = 0, $sub = 0, $sub107 = 0;
 var $sub85 = 0, $sub87 = 0, dest = 0, label = 0, sp = 0, src = 0, stop = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 704|0;
 $S = sp + 640|0;
 $W = sp;
 $scevgep = ((($md)) + 8|0);
 dest=$S; src=$scevgep; stop=dest+64|0; do { HEAP32[dest>>2]=HEAP32[src>>2]|0; dest=dest+4|0; src=src+4|0; } while ((dest|0) < (stop|0));
 $i$112 = 0;
 while(1) {
  $mul = $i$112 << 3;
  $add$ptr = (($buf) + ($mul)|0);
  $0 = HEAP8[$add$ptr>>0]|0;
  $1 = $0&255;
  $2 = (_bitshift64Shl(($1|0),0,56)|0);
  $3 = (getTempRet0() | 0);
  $arrayidx9 = ((($add$ptr)) + 1|0);
  $4 = HEAP8[$arrayidx9>>0]|0;
  $5 = $4&255;
  $6 = (_bitshift64Shl(($5|0),0,48)|0);
  $7 = (getTempRet0() | 0);
  $8 = $6 | $2;
  $9 = $7 | $3;
  $arrayidx16 = ((($add$ptr)) + 2|0);
  $10 = HEAP8[$arrayidx16>>0]|0;
  $11 = $10&255;
  $12 = (_bitshift64Shl(($11|0),0,40)|0);
  $13 = (getTempRet0() | 0);
  $14 = $8 | $12;
  $15 = $9 | $13;
  $arrayidx24 = ((($add$ptr)) + 3|0);
  $16 = HEAP8[$arrayidx24>>0]|0;
  $17 = $16&255;
  $18 = $15 | $17;
  $arrayidx32 = ((($add$ptr)) + 4|0);
  $19 = HEAP8[$arrayidx32>>0]|0;
  $20 = $19&255;
  $21 = (_bitshift64Shl(($20|0),0,24)|0);
  $22 = (getTempRet0() | 0);
  $23 = $14 | $21;
  $24 = $18 | $22;
  $arrayidx40 = ((($add$ptr)) + 5|0);
  $25 = HEAP8[$arrayidx40>>0]|0;
  $26 = $25&255;
  $27 = (_bitshift64Shl(($26|0),0,16)|0);
  $28 = (getTempRet0() | 0);
  $29 = $23 | $27;
  $30 = $24 | $28;
  $arrayidx48 = ((($add$ptr)) + 6|0);
  $31 = HEAP8[$arrayidx48>>0]|0;
  $32 = $31&255;
  $33 = (_bitshift64Shl(($32|0),0,8)|0);
  $34 = (getTempRet0() | 0);
  $35 = $29 | $33;
  $36 = $30 | $34;
  $arrayidx56 = ((($add$ptr)) + 7|0);
  $37 = HEAP8[$arrayidx56>>0]|0;
  $38 = $37&255;
  $39 = $35 | $38;
  $arrayidx61 = (($W) + ($i$112<<3)|0);
  $40 = $arrayidx61;
  $41 = $40;
  HEAP32[$41>>2] = $39;
  $42 = (($40) + 4)|0;
  $43 = $42;
  HEAP32[$43>>2] = $36;
  $inc63 = (($i$112) + 1)|0;
  $exitcond14 = ($inc63|0)==(16);
  if ($exitcond14) {
   break;
  } else {
   $i$112 = $inc63;
  }
 }
 $i$211 = 16;
 while(1) {
  $sub = (($i$211) + -2)|0;
  $arrayidx69 = (($W) + ($sub<<3)|0);
  $44 = $arrayidx69;
  $45 = $44;
  $46 = HEAP32[$45>>2]|0;
  $47 = (($44) + 4)|0;
  $48 = $47;
  $49 = HEAP32[$48>>2]|0;
  $50 = (_bitshift64Lshr(($46|0),($49|0),19)|0);
  $51 = (getTempRet0() | 0);
  $52 = (_bitshift64Shl(($46|0),($49|0),45)|0);
  $53 = (getTempRet0() | 0);
  $54 = $50 | $52;
  $55 = $51 | $53;
  $56 = (_bitshift64Lshr(($46|0),($49|0),61)|0);
  $57 = (getTempRet0() | 0);
  $58 = (_bitshift64Shl(($46|0),($49|0),3)|0);
  $59 = (getTempRet0() | 0);
  $60 = $56 | $58;
  $61 = $57 | $59;
  $62 = (_bitshift64Lshr(($46|0),($49|0),6)|0);
  $63 = (getTempRet0() | 0);
  $64 = $60 ^ $62;
  $65 = $61 ^ $63;
  $66 = $64 ^ $54;
  $67 = $65 ^ $55;
  $sub85 = (($i$211) + -7)|0;
  $arrayidx86 = (($W) + ($sub85<<3)|0);
  $68 = $arrayidx86;
  $69 = $68;
  $70 = HEAP32[$69>>2]|0;
  $71 = (($68) + 4)|0;
  $72 = $71;
  $73 = HEAP32[$72>>2]|0;
  $sub87 = (($i$211) + -15)|0;
  $arrayidx88 = (($W) + ($sub87<<3)|0);
  $74 = $arrayidx88;
  $75 = $74;
  $76 = HEAP32[$75>>2]|0;
  $77 = (($74) + 4)|0;
  $78 = $77;
  $79 = HEAP32[$78>>2]|0;
  $80 = (_bitshift64Lshr(($76|0),($79|0),1)|0);
  $81 = (getTempRet0() | 0);
  $82 = (_bitshift64Shl(($76|0),($79|0),63)|0);
  $83 = (getTempRet0() | 0);
  $84 = $80 | $82;
  $85 = $81 | $83;
  $86 = (_bitshift64Lshr(($76|0),($79|0),8)|0);
  $87 = (getTempRet0() | 0);
  $88 = (_bitshift64Shl(($76|0),($79|0),56)|0);
  $89 = (getTempRet0() | 0);
  $90 = $86 | $88;
  $91 = $87 | $89;
  $92 = (_bitshift64Lshr(($76|0),($79|0),7)|0);
  $93 = (getTempRet0() | 0);
  $94 = $90 ^ $92;
  $95 = $91 ^ $93;
  $96 = $94 ^ $84;
  $97 = $95 ^ $85;
  $sub107 = (($i$211) + -16)|0;
  $arrayidx108 = (($W) + ($sub107<<3)|0);
  $98 = $arrayidx108;
  $99 = $98;
  $100 = HEAP32[$99>>2]|0;
  $101 = (($98) + 4)|0;
  $102 = $101;
  $103 = HEAP32[$102>>2]|0;
  $104 = (_i64Add(($100|0),($103|0),($70|0),($73|0))|0);
  $105 = (getTempRet0() | 0);
  $106 = (_i64Add(($104|0),($105|0),($66|0),($67|0))|0);
  $107 = (getTempRet0() | 0);
  $108 = (_i64Add(($106|0),($107|0),($96|0),($97|0))|0);
  $109 = (getTempRet0() | 0);
  $arrayidx110 = (($W) + ($i$211<<3)|0);
  $110 = $arrayidx110;
  $111 = $110;
  HEAP32[$111>>2] = $108;
  $112 = (($110) + 4)|0;
  $113 = $112;
  HEAP32[$113>>2] = $109;
  $inc112 = (($i$211) + 1)|0;
  $exitcond = ($inc112|0)==(80);
  if ($exitcond) {
   break;
  } else {
   $i$211 = $inc112;
  }
 }
 $arrayidx118 = ((($S)) + 56|0);
 $arrayidx119 = ((($S)) + 32|0);
 $arrayidx137 = ((($S)) + 48|0);
 $arrayidx139 = ((($S)) + 40|0);
 $arrayidx169 = ((($S)) + 8|0);
 $arrayidx171 = ((($S)) + 16|0);
 $arrayidx178 = ((($S)) + 24|0);
 $114 = $arrayidx118;
 $115 = $114;
 $116 = HEAP32[$115>>2]|0;
 $117 = (($114) + 4)|0;
 $118 = $117;
 $119 = HEAP32[$118>>2]|0;
 $120 = $arrayidx119;
 $121 = $120;
 $122 = HEAP32[$121>>2]|0;
 $123 = (($120) + 4)|0;
 $124 = $123;
 $125 = HEAP32[$124>>2]|0;
 $126 = $arrayidx137;
 $127 = $126;
 $128 = HEAP32[$127>>2]|0;
 $129 = (($126) + 4)|0;
 $130 = $129;
 $131 = HEAP32[$130>>2]|0;
 $132 = $arrayidx139;
 $133 = $132;
 $134 = HEAP32[$133>>2]|0;
 $135 = (($132) + 4)|0;
 $136 = $135;
 $137 = HEAP32[$136>>2]|0;
 $138 = $S;
 $139 = $138;
 $140 = HEAP32[$139>>2]|0;
 $141 = (($138) + 4)|0;
 $142 = $141;
 $143 = HEAP32[$142>>2]|0;
 $144 = $arrayidx169;
 $145 = $144;
 $146 = HEAP32[$145>>2]|0;
 $147 = (($144) + 4)|0;
 $148 = $147;
 $149 = HEAP32[$148>>2]|0;
 $150 = $arrayidx171;
 $151 = $150;
 $152 = HEAP32[$151>>2]|0;
 $153 = (($150) + 4)|0;
 $154 = $153;
 $155 = HEAP32[$154>>2]|0;
 $156 = $arrayidx178;
 $157 = $156;
 $158 = HEAP32[$157>>2]|0;
 $159 = (($156) + 4)|0;
 $160 = $159;
 $161 = HEAP32[$160>>2]|0;
 $162 = $122;$163 = $125;$187 = $134;$188 = $128;$190 = $137;$191 = $131;$208 = $116;$209 = $119;$218 = $140;$219 = $143;$243 = $146;$245 = $149;$247 = $152;$249 = $155;$254 = $158;$255 = $161;$i$32 = 0;
 while(1) {
  $164 = (_bitshift64Lshr(($162|0),($163|0),14)|0);
  $165 = (getTempRet0() | 0);
  $166 = (_bitshift64Shl(($162|0),($163|0),50)|0);
  $167 = (getTempRet0() | 0);
  $168 = $164 | $166;
  $169 = $165 | $167;
  $170 = (_bitshift64Lshr(($162|0),($163|0),18)|0);
  $171 = (getTempRet0() | 0);
  $172 = (_bitshift64Shl(($162|0),($163|0),46)|0);
  $173 = (getTempRet0() | 0);
  $174 = $170 | $172;
  $175 = $171 | $173;
  $176 = $168 ^ $174;
  $177 = $169 ^ $175;
  $178 = (_bitshift64Lshr(($162|0),($163|0),41)|0);
  $179 = (getTempRet0() | 0);
  $180 = (_bitshift64Shl(($162|0),($163|0),23)|0);
  $181 = (getTempRet0() | 0);
  $182 = $178 | $180;
  $183 = $179 | $181;
  $184 = $176 ^ $182;
  $185 = $177 ^ $183;
  $186 = $187 ^ $188;
  $189 = $190 ^ $191;
  $192 = $186 & $162;
  $193 = $189 & $163;
  $194 = $192 ^ $188;
  $195 = $193 ^ $191;
  $arrayidx146 = (31840 + ($i$32<<3)|0);
  $196 = $arrayidx146;
  $197 = $196;
  $198 = HEAP32[$197>>2]|0;
  $199 = (($196) + 4)|0;
  $200 = $199;
  $201 = HEAP32[$200>>2]|0;
  $arrayidx149 = (($W) + ($i$32<<3)|0);
  $202 = $arrayidx149;
  $203 = $202;
  $204 = HEAP32[$203>>2]|0;
  $205 = (($202) + 4)|0;
  $206 = $205;
  $207 = HEAP32[$206>>2]|0;
  $210 = (_i64Add(($198|0),($201|0),($208|0),($209|0))|0);
  $211 = (getTempRet0() | 0);
  $212 = (_i64Add(($210|0),($211|0),($184|0),($185|0))|0);
  $213 = (getTempRet0() | 0);
  $214 = (_i64Add(($212|0),($213|0),($204|0),($207|0))|0);
  $215 = (getTempRet0() | 0);
  $216 = (_i64Add(($214|0),($215|0),($194|0),($195|0))|0);
  $217 = (getTempRet0() | 0);
  $220 = (_bitshift64Lshr(($218|0),($219|0),28)|0);
  $221 = (getTempRet0() | 0);
  $222 = (_bitshift64Shl(($218|0),($219|0),36)|0);
  $223 = (getTempRet0() | 0);
  $224 = $220 | $222;
  $225 = $221 | $223;
  $226 = (_bitshift64Lshr(($218|0),($219|0),34)|0);
  $227 = (getTempRet0() | 0);
  $228 = (_bitshift64Shl(($218|0),($219|0),30)|0);
  $229 = (getTempRet0() | 0);
  $230 = $226 | $228;
  $231 = $227 | $229;
  $232 = $224 ^ $230;
  $233 = $225 ^ $231;
  $234 = (_bitshift64Lshr(($218|0),($219|0),39)|0);
  $235 = (getTempRet0() | 0);
  $236 = (_bitshift64Shl(($218|0),($219|0),25)|0);
  $237 = (getTempRet0() | 0);
  $238 = $234 | $236;
  $239 = $235 | $237;
  $240 = $232 ^ $238;
  $241 = $233 ^ $239;
  $242 = $243 | $218;
  $244 = $245 | $219;
  $246 = $242 & $247;
  $248 = $244 & $249;
  $250 = $243 & $218;
  $251 = $245 & $219;
  $252 = $246 | $250;
  $253 = $248 | $251;
  $256 = (_i64Add(($254|0),($255|0),($216|0),($217|0))|0);
  $257 = (getTempRet0() | 0);
  $258 = (_i64Add(($252|0),($253|0),($216|0),($217|0))|0);
  $259 = (getTempRet0() | 0);
  $260 = (_i64Add(($258|0),($259|0),($240|0),($241|0))|0);
  $261 = (getTempRet0() | 0);
  $262 = (_bitshift64Lshr(($256|0),($257|0),14)|0);
  $263 = (getTempRet0() | 0);
  $264 = (_bitshift64Shl(($256|0),($257|0),50)|0);
  $265 = (getTempRet0() | 0);
  $266 = $262 | $264;
  $267 = $263 | $265;
  $268 = (_bitshift64Lshr(($256|0),($257|0),18)|0);
  $269 = (getTempRet0() | 0);
  $270 = (_bitshift64Shl(($256|0),($257|0),46)|0);
  $271 = (getTempRet0() | 0);
  $272 = $268 | $270;
  $273 = $269 | $271;
  $274 = $266 ^ $272;
  $275 = $267 ^ $273;
  $276 = (_bitshift64Lshr(($256|0),($257|0),41)|0);
  $277 = (getTempRet0() | 0);
  $278 = (_bitshift64Shl(($256|0),($257|0),23)|0);
  $279 = (getTempRet0() | 0);
  $280 = $276 | $278;
  $281 = $277 | $279;
  $282 = $274 ^ $280;
  $283 = $275 ^ $281;
  $284 = $187 ^ $162;
  $285 = $190 ^ $163;
  $286 = $256 & $284;
  $287 = $257 & $285;
  $288 = $286 ^ $187;
  $289 = $287 ^ $190;
  $add209 = $i$32 | 1;
  $arrayidx210 = (31840 + ($add209<<3)|0);
  $290 = $arrayidx210;
  $291 = $290;
  $292 = HEAP32[$291>>2]|0;
  $293 = (($290) + 4)|0;
  $294 = $293;
  $295 = HEAP32[$294>>2]|0;
  $arrayidx213 = (($W) + ($add209<<3)|0);
  $296 = $arrayidx213;
  $297 = $296;
  $298 = HEAP32[$297>>2]|0;
  $299 = (($296) + 4)|0;
  $300 = $299;
  $301 = HEAP32[$300>>2]|0;
  $302 = (_i64Add(($288|0),($289|0),($188|0),($191|0))|0);
  $303 = (getTempRet0() | 0);
  $304 = (_i64Add(($302|0),($303|0),($292|0),($295|0))|0);
  $305 = (getTempRet0() | 0);
  $306 = (_i64Add(($304|0),($305|0),($298|0),($301|0))|0);
  $307 = (getTempRet0() | 0);
  $308 = (_i64Add(($306|0),($307|0),($282|0),($283|0))|0);
  $309 = (getTempRet0() | 0);
  $310 = (_bitshift64Lshr(($260|0),($261|0),28)|0);
  $311 = (getTempRet0() | 0);
  $312 = (_bitshift64Shl(($260|0),($261|0),36)|0);
  $313 = (getTempRet0() | 0);
  $314 = $310 | $312;
  $315 = $311 | $313;
  $316 = (_bitshift64Lshr(($260|0),($261|0),34)|0);
  $317 = (getTempRet0() | 0);
  $318 = (_bitshift64Shl(($260|0),($261|0),30)|0);
  $319 = (getTempRet0() | 0);
  $320 = $316 | $318;
  $321 = $317 | $319;
  $322 = $314 ^ $320;
  $323 = $315 ^ $321;
  $324 = (_bitshift64Lshr(($260|0),($261|0),39)|0);
  $325 = (getTempRet0() | 0);
  $326 = (_bitshift64Shl(($260|0),($261|0),25)|0);
  $327 = (getTempRet0() | 0);
  $328 = $324 | $326;
  $329 = $325 | $327;
  $330 = $322 ^ $328;
  $331 = $323 ^ $329;
  $332 = $260 | $218;
  $333 = $261 | $219;
  $334 = $332 & $243;
  $335 = $333 & $245;
  $336 = $260 & $218;
  $337 = $261 & $219;
  $338 = $334 | $336;
  $339 = $335 | $337;
  $340 = (_i64Add(($330|0),($331|0),($338|0),($339|0))|0);
  $341 = (getTempRet0() | 0);
  $342 = (_i64Add(($308|0),($309|0),($247|0),($249|0))|0);
  $343 = (getTempRet0() | 0);
  $344 = (_i64Add(($340|0),($341|0),($308|0),($309|0))|0);
  $345 = (getTempRet0() | 0);
  $346 = (_bitshift64Lshr(($342|0),($343|0),14)|0);
  $347 = (getTempRet0() | 0);
  $348 = (_bitshift64Shl(($342|0),($343|0),50)|0);
  $349 = (getTempRet0() | 0);
  $350 = $346 | $348;
  $351 = $347 | $349;
  $352 = (_bitshift64Lshr(($342|0),($343|0),18)|0);
  $353 = (getTempRet0() | 0);
  $354 = (_bitshift64Shl(($342|0),($343|0),46)|0);
  $355 = (getTempRet0() | 0);
  $356 = $352 | $354;
  $357 = $353 | $355;
  $358 = $350 ^ $356;
  $359 = $351 ^ $357;
  $360 = (_bitshift64Lshr(($342|0),($343|0),41)|0);
  $361 = (getTempRet0() | 0);
  $362 = (_bitshift64Shl(($342|0),($343|0),23)|0);
  $363 = (getTempRet0() | 0);
  $364 = $360 | $362;
  $365 = $361 | $363;
  $366 = $358 ^ $364;
  $367 = $359 ^ $365;
  $368 = $256 ^ $162;
  $369 = $257 ^ $163;
  $370 = $342 & $368;
  $371 = $343 & $369;
  $372 = $370 ^ $162;
  $373 = $371 ^ $163;
  $add273 = $i$32 | 2;
  $arrayidx274 = (31840 + ($add273<<3)|0);
  $374 = $arrayidx274;
  $375 = $374;
  $376 = HEAP32[$375>>2]|0;
  $377 = (($374) + 4)|0;
  $378 = $377;
  $379 = HEAP32[$378>>2]|0;
  $arrayidx277 = (($W) + ($add273<<3)|0);
  $380 = $arrayidx277;
  $381 = $380;
  $382 = HEAP32[$381>>2]|0;
  $383 = (($380) + 4)|0;
  $384 = $383;
  $385 = HEAP32[$384>>2]|0;
  $386 = (_i64Add(($376|0),($379|0),($187|0),($190|0))|0);
  $387 = (getTempRet0() | 0);
  $388 = (_i64Add(($386|0),($387|0),($382|0),($385|0))|0);
  $389 = (getTempRet0() | 0);
  $390 = (_i64Add(($388|0),($389|0),($372|0),($373|0))|0);
  $391 = (getTempRet0() | 0);
  $392 = (_i64Add(($390|0),($391|0),($366|0),($367|0))|0);
  $393 = (getTempRet0() | 0);
  $394 = (_bitshift64Lshr(($344|0),($345|0),28)|0);
  $395 = (getTempRet0() | 0);
  $396 = (_bitshift64Shl(($344|0),($345|0),36)|0);
  $397 = (getTempRet0() | 0);
  $398 = $394 | $396;
  $399 = $395 | $397;
  $400 = (_bitshift64Lshr(($344|0),($345|0),34)|0);
  $401 = (getTempRet0() | 0);
  $402 = (_bitshift64Shl(($344|0),($345|0),30)|0);
  $403 = (getTempRet0() | 0);
  $404 = $400 | $402;
  $405 = $401 | $403;
  $406 = $398 ^ $404;
  $407 = $399 ^ $405;
  $408 = (_bitshift64Lshr(($344|0),($345|0),39)|0);
  $409 = (getTempRet0() | 0);
  $410 = (_bitshift64Shl(($344|0),($345|0),25)|0);
  $411 = (getTempRet0() | 0);
  $412 = $408 | $410;
  $413 = $409 | $411;
  $414 = $406 ^ $412;
  $415 = $407 ^ $413;
  $416 = $344 | $260;
  $417 = $345 | $261;
  $418 = $416 & $218;
  $419 = $417 & $219;
  $420 = $344 & $260;
  $421 = $345 & $261;
  $422 = $418 | $420;
  $423 = $419 | $421;
  $424 = (_i64Add(($414|0),($415|0),($422|0),($423|0))|0);
  $425 = (getTempRet0() | 0);
  $426 = (_i64Add(($392|0),($393|0),($243|0),($245|0))|0);
  $427 = (getTempRet0() | 0);
  $428 = (_i64Add(($424|0),($425|0),($392|0),($393|0))|0);
  $429 = (getTempRet0() | 0);
  $430 = (_bitshift64Lshr(($426|0),($427|0),14)|0);
  $431 = (getTempRet0() | 0);
  $432 = (_bitshift64Shl(($426|0),($427|0),50)|0);
  $433 = (getTempRet0() | 0);
  $434 = $430 | $432;
  $435 = $431 | $433;
  $436 = (_bitshift64Lshr(($426|0),($427|0),18)|0);
  $437 = (getTempRet0() | 0);
  $438 = (_bitshift64Shl(($426|0),($427|0),46)|0);
  $439 = (getTempRet0() | 0);
  $440 = $436 | $438;
  $441 = $437 | $439;
  $442 = $434 ^ $440;
  $443 = $435 ^ $441;
  $444 = (_bitshift64Lshr(($426|0),($427|0),41)|0);
  $445 = (getTempRet0() | 0);
  $446 = (_bitshift64Shl(($426|0),($427|0),23)|0);
  $447 = (getTempRet0() | 0);
  $448 = $444 | $446;
  $449 = $445 | $447;
  $450 = $442 ^ $448;
  $451 = $443 ^ $449;
  $452 = $342 ^ $256;
  $453 = $343 ^ $257;
  $454 = $426 & $452;
  $455 = $427 & $453;
  $456 = $454 ^ $256;
  $457 = $455 ^ $257;
  $add337 = $i$32 | 3;
  $arrayidx338 = (31840 + ($add337<<3)|0);
  $458 = $arrayidx338;
  $459 = $458;
  $460 = HEAP32[$459>>2]|0;
  $461 = (($458) + 4)|0;
  $462 = $461;
  $463 = HEAP32[$462>>2]|0;
  $arrayidx341 = (($W) + ($add337<<3)|0);
  $464 = $arrayidx341;
  $465 = $464;
  $466 = HEAP32[$465>>2]|0;
  $467 = (($464) + 4)|0;
  $468 = $467;
  $469 = HEAP32[$468>>2]|0;
  $470 = (_i64Add(($460|0),($463|0),($162|0),($163|0))|0);
  $471 = (getTempRet0() | 0);
  $472 = (_i64Add(($470|0),($471|0),($466|0),($469|0))|0);
  $473 = (getTempRet0() | 0);
  $474 = (_i64Add(($472|0),($473|0),($456|0),($457|0))|0);
  $475 = (getTempRet0() | 0);
  $476 = (_i64Add(($474|0),($475|0),($450|0),($451|0))|0);
  $477 = (getTempRet0() | 0);
  $478 = (_bitshift64Lshr(($428|0),($429|0),28)|0);
  $479 = (getTempRet0() | 0);
  $480 = (_bitshift64Shl(($428|0),($429|0),36)|0);
  $481 = (getTempRet0() | 0);
  $482 = $478 | $480;
  $483 = $479 | $481;
  $484 = (_bitshift64Lshr(($428|0),($429|0),34)|0);
  $485 = (getTempRet0() | 0);
  $486 = (_bitshift64Shl(($428|0),($429|0),30)|0);
  $487 = (getTempRet0() | 0);
  $488 = $484 | $486;
  $489 = $485 | $487;
  $490 = $482 ^ $488;
  $491 = $483 ^ $489;
  $492 = (_bitshift64Lshr(($428|0),($429|0),39)|0);
  $493 = (getTempRet0() | 0);
  $494 = (_bitshift64Shl(($428|0),($429|0),25)|0);
  $495 = (getTempRet0() | 0);
  $496 = $492 | $494;
  $497 = $493 | $495;
  $498 = $490 ^ $496;
  $499 = $491 ^ $497;
  $500 = $428 | $344;
  $501 = $429 | $345;
  $502 = $500 & $260;
  $503 = $501 & $261;
  $504 = $428 & $344;
  $505 = $429 & $345;
  $506 = $502 | $504;
  $507 = $503 | $505;
  $508 = (_i64Add(($498|0),($499|0),($506|0),($507|0))|0);
  $509 = (getTempRet0() | 0);
  $510 = (_i64Add(($476|0),($477|0),($218|0),($219|0))|0);
  $511 = (getTempRet0() | 0);
  $512 = (_i64Add(($508|0),($509|0),($476|0),($477|0))|0);
  $513 = (getTempRet0() | 0);
  $514 = (_bitshift64Lshr(($510|0),($511|0),14)|0);
  $515 = (getTempRet0() | 0);
  $516 = (_bitshift64Shl(($510|0),($511|0),50)|0);
  $517 = (getTempRet0() | 0);
  $518 = $514 | $516;
  $519 = $515 | $517;
  $520 = (_bitshift64Lshr(($510|0),($511|0),18)|0);
  $521 = (getTempRet0() | 0);
  $522 = (_bitshift64Shl(($510|0),($511|0),46)|0);
  $523 = (getTempRet0() | 0);
  $524 = $520 | $522;
  $525 = $521 | $523;
  $526 = $518 ^ $524;
  $527 = $519 ^ $525;
  $528 = (_bitshift64Lshr(($510|0),($511|0),41)|0);
  $529 = (getTempRet0() | 0);
  $530 = (_bitshift64Shl(($510|0),($511|0),23)|0);
  $531 = (getTempRet0() | 0);
  $532 = $528 | $530;
  $533 = $529 | $531;
  $534 = $526 ^ $532;
  $535 = $527 ^ $533;
  $536 = $426 ^ $342;
  $537 = $427 ^ $343;
  $538 = $510 & $536;
  $539 = $511 & $537;
  $540 = $538 ^ $342;
  $541 = $539 ^ $343;
  $add401 = $i$32 | 4;
  $arrayidx402 = (31840 + ($add401<<3)|0);
  $542 = $arrayidx402;
  $543 = $542;
  $544 = HEAP32[$543>>2]|0;
  $545 = (($542) + 4)|0;
  $546 = $545;
  $547 = HEAP32[$546>>2]|0;
  $arrayidx405 = (($W) + ($add401<<3)|0);
  $548 = $arrayidx405;
  $549 = $548;
  $550 = HEAP32[$549>>2]|0;
  $551 = (($548) + 4)|0;
  $552 = $551;
  $553 = HEAP32[$552>>2]|0;
  $554 = (_i64Add(($544|0),($547|0),($256|0),($257|0))|0);
  $555 = (getTempRet0() | 0);
  $556 = (_i64Add(($554|0),($555|0),($550|0),($553|0))|0);
  $557 = (getTempRet0() | 0);
  $558 = (_i64Add(($556|0),($557|0),($540|0),($541|0))|0);
  $559 = (getTempRet0() | 0);
  $560 = (_i64Add(($558|0),($559|0),($534|0),($535|0))|0);
  $561 = (getTempRet0() | 0);
  $562 = (_bitshift64Lshr(($512|0),($513|0),28)|0);
  $563 = (getTempRet0() | 0);
  $564 = (_bitshift64Shl(($512|0),($513|0),36)|0);
  $565 = (getTempRet0() | 0);
  $566 = $562 | $564;
  $567 = $563 | $565;
  $568 = (_bitshift64Lshr(($512|0),($513|0),34)|0);
  $569 = (getTempRet0() | 0);
  $570 = (_bitshift64Shl(($512|0),($513|0),30)|0);
  $571 = (getTempRet0() | 0);
  $572 = $568 | $570;
  $573 = $569 | $571;
  $574 = $566 ^ $572;
  $575 = $567 ^ $573;
  $576 = (_bitshift64Lshr(($512|0),($513|0),39)|0);
  $577 = (getTempRet0() | 0);
  $578 = (_bitshift64Shl(($512|0),($513|0),25)|0);
  $579 = (getTempRet0() | 0);
  $580 = $576 | $578;
  $581 = $577 | $579;
  $582 = $574 ^ $580;
  $583 = $575 ^ $581;
  $584 = $512 | $428;
  $585 = $513 | $429;
  $586 = $584 & $344;
  $587 = $585 & $345;
  $588 = $512 & $428;
  $589 = $513 & $429;
  $590 = $586 | $588;
  $591 = $587 | $589;
  $592 = (_i64Add(($582|0),($583|0),($590|0),($591|0))|0);
  $593 = (getTempRet0() | 0);
  $594 = (_i64Add(($560|0),($561|0),($260|0),($261|0))|0);
  $595 = (getTempRet0() | 0);
  $596 = (_i64Add(($592|0),($593|0),($560|0),($561|0))|0);
  $597 = (getTempRet0() | 0);
  $598 = (_bitshift64Lshr(($594|0),($595|0),14)|0);
  $599 = (getTempRet0() | 0);
  $600 = (_bitshift64Shl(($594|0),($595|0),50)|0);
  $601 = (getTempRet0() | 0);
  $602 = $598 | $600;
  $603 = $599 | $601;
  $604 = (_bitshift64Lshr(($594|0),($595|0),18)|0);
  $605 = (getTempRet0() | 0);
  $606 = (_bitshift64Shl(($594|0),($595|0),46)|0);
  $607 = (getTempRet0() | 0);
  $608 = $604 | $606;
  $609 = $605 | $607;
  $610 = $602 ^ $608;
  $611 = $603 ^ $609;
  $612 = (_bitshift64Lshr(($594|0),($595|0),41)|0);
  $613 = (getTempRet0() | 0);
  $614 = (_bitshift64Shl(($594|0),($595|0),23)|0);
  $615 = (getTempRet0() | 0);
  $616 = $612 | $614;
  $617 = $613 | $615;
  $618 = $610 ^ $616;
  $619 = $611 ^ $617;
  $620 = $510 ^ $426;
  $621 = $511 ^ $427;
  $622 = $594 & $620;
  $623 = $595 & $621;
  $624 = $622 ^ $426;
  $625 = $623 ^ $427;
  $add465 = $i$32 | 5;
  $arrayidx466 = (31840 + ($add465<<3)|0);
  $626 = $arrayidx466;
  $627 = $626;
  $628 = HEAP32[$627>>2]|0;
  $629 = (($626) + 4)|0;
  $630 = $629;
  $631 = HEAP32[$630>>2]|0;
  $arrayidx469 = (($W) + ($add465<<3)|0);
  $632 = $arrayidx469;
  $633 = $632;
  $634 = HEAP32[$633>>2]|0;
  $635 = (($632) + 4)|0;
  $636 = $635;
  $637 = HEAP32[$636>>2]|0;
  $638 = (_i64Add(($628|0),($631|0),($342|0),($343|0))|0);
  $639 = (getTempRet0() | 0);
  $640 = (_i64Add(($638|0),($639|0),($634|0),($637|0))|0);
  $641 = (getTempRet0() | 0);
  $642 = (_i64Add(($640|0),($641|0),($624|0),($625|0))|0);
  $643 = (getTempRet0() | 0);
  $644 = (_i64Add(($642|0),($643|0),($618|0),($619|0))|0);
  $645 = (getTempRet0() | 0);
  $646 = (_bitshift64Lshr(($596|0),($597|0),28)|0);
  $647 = (getTempRet0() | 0);
  $648 = (_bitshift64Shl(($596|0),($597|0),36)|0);
  $649 = (getTempRet0() | 0);
  $650 = $646 | $648;
  $651 = $647 | $649;
  $652 = (_bitshift64Lshr(($596|0),($597|0),34)|0);
  $653 = (getTempRet0() | 0);
  $654 = (_bitshift64Shl(($596|0),($597|0),30)|0);
  $655 = (getTempRet0() | 0);
  $656 = $652 | $654;
  $657 = $653 | $655;
  $658 = $650 ^ $656;
  $659 = $651 ^ $657;
  $660 = (_bitshift64Lshr(($596|0),($597|0),39)|0);
  $661 = (getTempRet0() | 0);
  $662 = (_bitshift64Shl(($596|0),($597|0),25)|0);
  $663 = (getTempRet0() | 0);
  $664 = $660 | $662;
  $665 = $661 | $663;
  $666 = $658 ^ $664;
  $667 = $659 ^ $665;
  $668 = $596 | $512;
  $669 = $597 | $513;
  $670 = $668 & $428;
  $671 = $669 & $429;
  $672 = $596 & $512;
  $673 = $597 & $513;
  $674 = $670 | $672;
  $675 = $671 | $673;
  $676 = (_i64Add(($666|0),($667|0),($674|0),($675|0))|0);
  $677 = (getTempRet0() | 0);
  $678 = (_i64Add(($644|0),($645|0),($344|0),($345|0))|0);
  $679 = (getTempRet0() | 0);
  $680 = (_i64Add(($676|0),($677|0),($644|0),($645|0))|0);
  $681 = (getTempRet0() | 0);
  $682 = (_bitshift64Lshr(($678|0),($679|0),14)|0);
  $683 = (getTempRet0() | 0);
  $684 = (_bitshift64Shl(($678|0),($679|0),50)|0);
  $685 = (getTempRet0() | 0);
  $686 = $682 | $684;
  $687 = $683 | $685;
  $688 = (_bitshift64Lshr(($678|0),($679|0),18)|0);
  $689 = (getTempRet0() | 0);
  $690 = (_bitshift64Shl(($678|0),($679|0),46)|0);
  $691 = (getTempRet0() | 0);
  $692 = $688 | $690;
  $693 = $689 | $691;
  $694 = $686 ^ $692;
  $695 = $687 ^ $693;
  $696 = (_bitshift64Lshr(($678|0),($679|0),41)|0);
  $697 = (getTempRet0() | 0);
  $698 = (_bitshift64Shl(($678|0),($679|0),23)|0);
  $699 = (getTempRet0() | 0);
  $700 = $696 | $698;
  $701 = $697 | $699;
  $702 = $694 ^ $700;
  $703 = $695 ^ $701;
  $704 = $594 ^ $510;
  $705 = $595 ^ $511;
  $706 = $678 & $704;
  $707 = $679 & $705;
  $708 = $706 ^ $510;
  $709 = $707 ^ $511;
  $add529 = $i$32 | 6;
  $arrayidx530 = (31840 + ($add529<<3)|0);
  $710 = $arrayidx530;
  $711 = $710;
  $712 = HEAP32[$711>>2]|0;
  $713 = (($710) + 4)|0;
  $714 = $713;
  $715 = HEAP32[$714>>2]|0;
  $arrayidx533 = (($W) + ($add529<<3)|0);
  $716 = $arrayidx533;
  $717 = $716;
  $718 = HEAP32[$717>>2]|0;
  $719 = (($716) + 4)|0;
  $720 = $719;
  $721 = HEAP32[$720>>2]|0;
  $722 = (_i64Add(($712|0),($715|0),($426|0),($427|0))|0);
  $723 = (getTempRet0() | 0);
  $724 = (_i64Add(($722|0),($723|0),($718|0),($721|0))|0);
  $725 = (getTempRet0() | 0);
  $726 = (_i64Add(($724|0),($725|0),($708|0),($709|0))|0);
  $727 = (getTempRet0() | 0);
  $728 = (_i64Add(($726|0),($727|0),($702|0),($703|0))|0);
  $729 = (getTempRet0() | 0);
  $730 = (_bitshift64Lshr(($680|0),($681|0),28)|0);
  $731 = (getTempRet0() | 0);
  $732 = (_bitshift64Shl(($680|0),($681|0),36)|0);
  $733 = (getTempRet0() | 0);
  $734 = $730 | $732;
  $735 = $731 | $733;
  $736 = (_bitshift64Lshr(($680|0),($681|0),34)|0);
  $737 = (getTempRet0() | 0);
  $738 = (_bitshift64Shl(($680|0),($681|0),30)|0);
  $739 = (getTempRet0() | 0);
  $740 = $736 | $738;
  $741 = $737 | $739;
  $742 = $734 ^ $740;
  $743 = $735 ^ $741;
  $744 = (_bitshift64Lshr(($680|0),($681|0),39)|0);
  $745 = (getTempRet0() | 0);
  $746 = (_bitshift64Shl(($680|0),($681|0),25)|0);
  $747 = (getTempRet0() | 0);
  $748 = $744 | $746;
  $749 = $745 | $747;
  $750 = $742 ^ $748;
  $751 = $743 ^ $749;
  $752 = $680 | $596;
  $753 = $681 | $597;
  $754 = $752 & $512;
  $755 = $753 & $513;
  $756 = $680 & $596;
  $757 = $681 & $597;
  $758 = $754 | $756;
  $759 = $755 | $757;
  $760 = (_i64Add(($750|0),($751|0),($758|0),($759|0))|0);
  $761 = (getTempRet0() | 0);
  $762 = (_i64Add(($728|0),($729|0),($428|0),($429|0))|0);
  $763 = (getTempRet0() | 0);
  $764 = (_i64Add(($760|0),($761|0),($728|0),($729|0))|0);
  $765 = (getTempRet0() | 0);
  $766 = (_bitshift64Lshr(($762|0),($763|0),14)|0);
  $767 = (getTempRet0() | 0);
  $768 = (_bitshift64Shl(($762|0),($763|0),50)|0);
  $769 = (getTempRet0() | 0);
  $770 = $766 | $768;
  $771 = $767 | $769;
  $772 = (_bitshift64Lshr(($762|0),($763|0),18)|0);
  $773 = (getTempRet0() | 0);
  $774 = (_bitshift64Shl(($762|0),($763|0),46)|0);
  $775 = (getTempRet0() | 0);
  $776 = $772 | $774;
  $777 = $773 | $775;
  $778 = $770 ^ $776;
  $779 = $771 ^ $777;
  $780 = (_bitshift64Lshr(($762|0),($763|0),41)|0);
  $781 = (getTempRet0() | 0);
  $782 = (_bitshift64Shl(($762|0),($763|0),23)|0);
  $783 = (getTempRet0() | 0);
  $784 = $780 | $782;
  $785 = $781 | $783;
  $786 = $778 ^ $784;
  $787 = $779 ^ $785;
  $788 = $678 ^ $594;
  $789 = $679 ^ $595;
  $790 = $762 & $788;
  $791 = $763 & $789;
  $792 = $790 ^ $594;
  $793 = $791 ^ $595;
  $add593 = $i$32 | 7;
  $arrayidx594 = (31840 + ($add593<<3)|0);
  $794 = $arrayidx594;
  $795 = $794;
  $796 = HEAP32[$795>>2]|0;
  $797 = (($794) + 4)|0;
  $798 = $797;
  $799 = HEAP32[$798>>2]|0;
  $arrayidx597 = (($W) + ($add593<<3)|0);
  $800 = $arrayidx597;
  $801 = $800;
  $802 = HEAP32[$801>>2]|0;
  $803 = (($800) + 4)|0;
  $804 = $803;
  $805 = HEAP32[$804>>2]|0;
  $806 = (_i64Add(($510|0),($511|0),($796|0),($799|0))|0);
  $807 = (getTempRet0() | 0);
  $808 = (_i64Add(($806|0),($807|0),($802|0),($805|0))|0);
  $809 = (getTempRet0() | 0);
  $810 = (_i64Add(($808|0),($809|0),($792|0),($793|0))|0);
  $811 = (getTempRet0() | 0);
  $812 = (_i64Add(($810|0),($811|0),($786|0),($787|0))|0);
  $813 = (getTempRet0() | 0);
  $814 = (_bitshift64Lshr(($764|0),($765|0),28)|0);
  $815 = (getTempRet0() | 0);
  $816 = (_bitshift64Shl(($764|0),($765|0),36)|0);
  $817 = (getTempRet0() | 0);
  $818 = $814 | $816;
  $819 = $815 | $817;
  $820 = (_bitshift64Lshr(($764|0),($765|0),34)|0);
  $821 = (getTempRet0() | 0);
  $822 = (_bitshift64Shl(($764|0),($765|0),30)|0);
  $823 = (getTempRet0() | 0);
  $824 = $820 | $822;
  $825 = $821 | $823;
  $826 = $818 ^ $824;
  $827 = $819 ^ $825;
  $828 = (_bitshift64Lshr(($764|0),($765|0),39)|0);
  $829 = (getTempRet0() | 0);
  $830 = (_bitshift64Shl(($764|0),($765|0),25)|0);
  $831 = (getTempRet0() | 0);
  $832 = $828 | $830;
  $833 = $829 | $831;
  $834 = $826 ^ $832;
  $835 = $827 ^ $833;
  $836 = $764 | $680;
  $837 = $765 | $681;
  $838 = $836 & $596;
  $839 = $837 & $597;
  $840 = $764 & $680;
  $841 = $765 & $681;
  $842 = $838 | $840;
  $843 = $839 | $841;
  $844 = (_i64Add(($834|0),($835|0),($842|0),($843|0))|0);
  $845 = (getTempRet0() | 0);
  $846 = (_i64Add(($812|0),($813|0),($512|0),($513|0))|0);
  $847 = (getTempRet0() | 0);
  $848 = (_i64Add(($844|0),($845|0),($812|0),($813|0))|0);
  $849 = (getTempRet0() | 0);
  $add631 = (($i$32) + 8)|0;
  $cmp115 = ($add631>>>0)<(80);
  if ($cmp115) {
   $162 = $846;$163 = $847;$187 = $762;$188 = $678;$190 = $763;$191 = $679;$208 = $594;$209 = $595;$218 = $848;$219 = $849;$243 = $764;$245 = $765;$247 = $680;$249 = $681;$254 = $596;$255 = $597;$i$32 = $add631;
  } else {
   break;
  }
 }
 $850 = $arrayidx118;
 $851 = $850;
 HEAP32[$851>>2] = $594;
 $852 = (($850) + 4)|0;
 $853 = $852;
 HEAP32[$853>>2] = $595;
 $854 = $arrayidx119;
 $855 = $854;
 HEAP32[$855>>2] = $846;
 $856 = (($854) + 4)|0;
 $857 = $856;
 HEAP32[$857>>2] = $847;
 $858 = $arrayidx137;
 $859 = $858;
 HEAP32[$859>>2] = $678;
 $860 = (($858) + 4)|0;
 $861 = $860;
 HEAP32[$861>>2] = $679;
 $862 = $arrayidx139;
 $863 = $862;
 HEAP32[$863>>2] = $762;
 $864 = (($862) + 4)|0;
 $865 = $864;
 HEAP32[$865>>2] = $763;
 $866 = $S;
 $867 = $866;
 HEAP32[$867>>2] = $848;
 $868 = (($866) + 4)|0;
 $869 = $868;
 HEAP32[$869>>2] = $849;
 $870 = $arrayidx169;
 $871 = $870;
 HEAP32[$871>>2] = $764;
 $872 = (($870) + 4)|0;
 $873 = $872;
 HEAP32[$873>>2] = $765;
 $874 = $arrayidx171;
 $875 = $874;
 HEAP32[$875>>2] = $680;
 $876 = (($874) + 4)|0;
 $877 = $876;
 HEAP32[$877>>2] = $681;
 $878 = $arrayidx178;
 $879 = $878;
 HEAP32[$879>>2] = $596;
 $880 = (($878) + 4)|0;
 $881 = $880;
 HEAP32[$881>>2] = $597;
 $arrayidx638 = ((($md)) + 8|0);
 $882 = $arrayidx638;
 $883 = $882;
 $884 = HEAP32[$883>>2]|0;
 $885 = (($882) + 4)|0;
 $886 = $885;
 $887 = HEAP32[$886>>2]|0;
 $888 = $S;
 $889 = $888;
 $890 = HEAP32[$889>>2]|0;
 $891 = (($888) + 4)|0;
 $892 = $891;
 $893 = HEAP32[$892>>2]|0;
 $894 = (_i64Add(($890|0),($893|0),($884|0),($887|0))|0);
 $895 = (getTempRet0() | 0);
 $896 = $arrayidx638;
 $897 = $896;
 HEAP32[$897>>2] = $894;
 $898 = (($896) + 4)|0;
 $899 = $898;
 HEAP32[$899>>2] = $895;
 $arrayidx638$1 = ((($md)) + 16|0);
 $900 = $arrayidx638$1;
 $901 = $900;
 $902 = HEAP32[$901>>2]|0;
 $903 = (($900) + 4)|0;
 $904 = $903;
 $905 = HEAP32[$904>>2]|0;
 $arrayidx639$1 = ((($S)) + 8|0);
 $906 = $arrayidx639$1;
 $907 = $906;
 $908 = HEAP32[$907>>2]|0;
 $909 = (($906) + 4)|0;
 $910 = $909;
 $911 = HEAP32[$910>>2]|0;
 $912 = (_i64Add(($908|0),($911|0),($902|0),($905|0))|0);
 $913 = (getTempRet0() | 0);
 $914 = $arrayidx638$1;
 $915 = $914;
 HEAP32[$915>>2] = $912;
 $916 = (($914) + 4)|0;
 $917 = $916;
 HEAP32[$917>>2] = $913;
 $arrayidx638$2 = ((($md)) + 24|0);
 $918 = $arrayidx638$2;
 $919 = $918;
 $920 = HEAP32[$919>>2]|0;
 $921 = (($918) + 4)|0;
 $922 = $921;
 $923 = HEAP32[$922>>2]|0;
 $arrayidx639$2 = ((($S)) + 16|0);
 $924 = $arrayidx639$2;
 $925 = $924;
 $926 = HEAP32[$925>>2]|0;
 $927 = (($924) + 4)|0;
 $928 = $927;
 $929 = HEAP32[$928>>2]|0;
 $930 = (_i64Add(($926|0),($929|0),($920|0),($923|0))|0);
 $931 = (getTempRet0() | 0);
 $932 = $arrayidx638$2;
 $933 = $932;
 HEAP32[$933>>2] = $930;
 $934 = (($932) + 4)|0;
 $935 = $934;
 HEAP32[$935>>2] = $931;
 $arrayidx638$3 = ((($md)) + 32|0);
 $936 = $arrayidx638$3;
 $937 = $936;
 $938 = HEAP32[$937>>2]|0;
 $939 = (($936) + 4)|0;
 $940 = $939;
 $941 = HEAP32[$940>>2]|0;
 $arrayidx639$3 = ((($S)) + 24|0);
 $942 = $arrayidx639$3;
 $943 = $942;
 $944 = HEAP32[$943>>2]|0;
 $945 = (($942) + 4)|0;
 $946 = $945;
 $947 = HEAP32[$946>>2]|0;
 $948 = (_i64Add(($944|0),($947|0),($938|0),($941|0))|0);
 $949 = (getTempRet0() | 0);
 $950 = $arrayidx638$3;
 $951 = $950;
 HEAP32[$951>>2] = $948;
 $952 = (($950) + 4)|0;
 $953 = $952;
 HEAP32[$953>>2] = $949;
 $arrayidx638$4 = ((($md)) + 40|0);
 $954 = $arrayidx638$4;
 $955 = $954;
 $956 = HEAP32[$955>>2]|0;
 $957 = (($954) + 4)|0;
 $958 = $957;
 $959 = HEAP32[$958>>2]|0;
 $arrayidx639$4 = ((($S)) + 32|0);
 $960 = $arrayidx639$4;
 $961 = $960;
 $962 = HEAP32[$961>>2]|0;
 $963 = (($960) + 4)|0;
 $964 = $963;
 $965 = HEAP32[$964>>2]|0;
 $966 = (_i64Add(($962|0),($965|0),($956|0),($959|0))|0);
 $967 = (getTempRet0() | 0);
 $968 = $arrayidx638$4;
 $969 = $968;
 HEAP32[$969>>2] = $966;
 $970 = (($968) + 4)|0;
 $971 = $970;
 HEAP32[$971>>2] = $967;
 $arrayidx638$5 = ((($md)) + 48|0);
 $972 = $arrayidx638$5;
 $973 = $972;
 $974 = HEAP32[$973>>2]|0;
 $975 = (($972) + 4)|0;
 $976 = $975;
 $977 = HEAP32[$976>>2]|0;
 $arrayidx639$5 = ((($S)) + 40|0);
 $978 = $arrayidx639$5;
 $979 = $978;
 $980 = HEAP32[$979>>2]|0;
 $981 = (($978) + 4)|0;
 $982 = $981;
 $983 = HEAP32[$982>>2]|0;
 $984 = (_i64Add(($980|0),($983|0),($974|0),($977|0))|0);
 $985 = (getTempRet0() | 0);
 $986 = $arrayidx638$5;
 $987 = $986;
 HEAP32[$987>>2] = $984;
 $988 = (($986) + 4)|0;
 $989 = $988;
 HEAP32[$989>>2] = $985;
 $arrayidx638$6 = ((($md)) + 56|0);
 $990 = $arrayidx638$6;
 $991 = $990;
 $992 = HEAP32[$991>>2]|0;
 $993 = (($990) + 4)|0;
 $994 = $993;
 $995 = HEAP32[$994>>2]|0;
 $arrayidx639$6 = ((($S)) + 48|0);
 $996 = $arrayidx639$6;
 $997 = $996;
 $998 = HEAP32[$997>>2]|0;
 $999 = (($996) + 4)|0;
 $1000 = $999;
 $1001 = HEAP32[$1000>>2]|0;
 $1002 = (_i64Add(($998|0),($1001|0),($992|0),($995|0))|0);
 $1003 = (getTempRet0() | 0);
 $1004 = $arrayidx638$6;
 $1005 = $1004;
 HEAP32[$1005>>2] = $1002;
 $1006 = (($1004) + 4)|0;
 $1007 = $1006;
 HEAP32[$1007>>2] = $1003;
 $arrayidx638$7 = ((($md)) + 64|0);
 $1008 = $arrayidx638$7;
 $1009 = $1008;
 $1010 = HEAP32[$1009>>2]|0;
 $1011 = (($1008) + 4)|0;
 $1012 = $1011;
 $1013 = HEAP32[$1012>>2]|0;
 $arrayidx639$7 = ((($S)) + 56|0);
 $1014 = $arrayidx639$7;
 $1015 = $1014;
 $1016 = HEAP32[$1015>>2]|0;
 $1017 = (($1014) + 4)|0;
 $1018 = $1017;
 $1019 = HEAP32[$1018>>2]|0;
 $1020 = (_i64Add(($1016|0),($1019|0),($1010|0),($1013|0))|0);
 $1021 = (getTempRet0() | 0);
 $1022 = $arrayidx638$7;
 $1023 = $1022;
 HEAP32[$1023>>2] = $1020;
 $1024 = (($1022) + 4)|0;
 $1025 = $1024;
 HEAP32[$1025>>2] = $1021;
 STACKTOP = sp;return;
}
function _sha512_final($md,$out) {
 $md = $md|0;
 $out = $out|0;
 var $$ph = 0, $$pr = 0, $0 = 0, $1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0, $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $12 = 0;
 var $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0;
 var $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0;
 var $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0;
 var $68 = 0, $69 = 0, $7 = 0, $70 = 0, $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0;
 var $86 = 0, $87 = 0, $88 = 0, $89 = 0, $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, $add$ptr = 0, $add$ptr103 = 0, $arrayidx = 0, $arrayidx112 = 0, $arrayidx120 = 0;
 var $arrayidx128 = 0, $arrayidx136 = 0, $arrayidx144 = 0, $arrayidx152 = 0, $arrayidx159 = 0, $arrayidx19 = 0, $arrayidx31 = 0, $arrayidx45 = 0, $arrayidx53 = 0, $arrayidx61 = 0, $arrayidx69 = 0, $arrayidx77 = 0, $arrayidx85 = 0, $arrayidx92 = 0, $arrayidx98 = 0, $buf = 0, $cmp = 0, $cmp1 = 0, $cmp10 = 0, $cmp14 = 0;
 var $cmp1468 = 0, $cmp25 = 0, $cmp4 = 0, $curlen = 0, $exitcond = 0, $i$066 = 0, $inc = 0, $inc160 = 0, $inc18 = 0, $inc30 = 0, $mul102 = 0, $or$cond = 0, $retval$0 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $cmp = ($md|0)==(0|0);
 $cmp1 = ($out|0)==(0|0);
 $or$cond = $cmp | $cmp1;
 if ($or$cond) {
  $retval$0 = 1;
  return ($retval$0|0);
 }
 $curlen = ((($md)) + 72|0);
 $0 = HEAP32[$curlen>>2]|0;
 $cmp4 = ($0>>>0)>(127);
 if ($cmp4) {
  $retval$0 = 1;
  return ($retval$0|0);
 }
 $1 = (_bitshift64Shl(($0|0),0,3)|0);
 $2 = (getTempRet0() | 0);
 $3 = $md;
 $4 = $3;
 $5 = HEAP32[$4>>2]|0;
 $6 = (($3) + 4)|0;
 $7 = $6;
 $8 = HEAP32[$7>>2]|0;
 $9 = (_i64Add(($5|0),($8|0),($1|0),($2|0))|0);
 $10 = (getTempRet0() | 0);
 $11 = $md;
 $12 = $11;
 HEAP32[$12>>2] = $9;
 $13 = (($11) + 4)|0;
 $14 = $13;
 HEAP32[$14>>2] = $10;
 $buf = ((($md)) + 76|0);
 $inc = (($0) + 1)|0;
 HEAP32[$curlen>>2] = $inc;
 $arrayidx = (((($md)) + 76|0) + ($0)|0);
 HEAP8[$arrayidx>>0] = -128;
 $15 = HEAP32[$curlen>>2]|0;
 $cmp10 = ($15>>>0)>(112);
 if ($cmp10) {
  $cmp1468 = ($15>>>0)<(128);
  if ($cmp1468) {
   $16 = $15;
   while(1) {
    $inc18 = (($16) + 1)|0;
    HEAP32[$curlen>>2] = $inc18;
    $arrayidx19 = (((($md)) + 76|0) + ($16)|0);
    HEAP8[$arrayidx19>>0] = 0;
    $$pr = HEAP32[$curlen>>2]|0;
    $cmp14 = ($$pr>>>0)<(128);
    if ($cmp14) {
     $16 = $$pr;
    } else {
     break;
    }
   }
  }
  _sha512_compress($md,$buf);
  HEAP32[$curlen>>2] = 0;
  $$ph = 0;
 } else {
  $$ph = $15;
 }
 $17 = $$ph;
 while(1) {
  $inc30 = (($17) + 1)|0;
  HEAP32[$curlen>>2] = $inc30;
  $arrayidx31 = (((($md)) + 76|0) + ($17)|0);
  HEAP8[$arrayidx31>>0] = 0;
  $18 = HEAP32[$curlen>>2]|0;
  $cmp25 = ($18>>>0)<(120);
  if ($cmp25) {
   $17 = $18;
  } else {
   break;
  }
 }
 $19 = $md;
 $20 = $19;
 $21 = HEAP32[$20>>2]|0;
 $22 = (($19) + 4)|0;
 $23 = $22;
 $24 = HEAP32[$23>>2]|0;
 $25 = (_bitshift64Lshr(($21|0),($24|0),56)|0);
 $26 = (getTempRet0() | 0);
 $27 = $25&255;
 $add$ptr = ((($md)) + 196|0);
 HEAP8[$add$ptr>>0] = $27;
 $28 = (_bitshift64Lshr(($21|0),($24|0),48)|0);
 $29 = (getTempRet0() | 0);
 $30 = $28&255;
 $arrayidx45 = ((($md)) + 197|0);
 HEAP8[$arrayidx45>>0] = $30;
 $31 = (_bitshift64Lshr(($21|0),($24|0),40)|0);
 $32 = (getTempRet0() | 0);
 $33 = $31&255;
 $arrayidx53 = ((($md)) + 198|0);
 HEAP8[$arrayidx53>>0] = $33;
 $34 = $24&255;
 $arrayidx61 = ((($md)) + 199|0);
 HEAP8[$arrayidx61>>0] = $34;
 $35 = (_bitshift64Lshr(($21|0),($24|0),24)|0);
 $36 = (getTempRet0() | 0);
 $37 = $35&255;
 $arrayidx69 = ((($md)) + 200|0);
 HEAP8[$arrayidx69>>0] = $37;
 $38 = (_bitshift64Lshr(($21|0),($24|0),16)|0);
 $39 = (getTempRet0() | 0);
 $40 = $38&255;
 $arrayidx77 = ((($md)) + 201|0);
 HEAP8[$arrayidx77>>0] = $40;
 $41 = (_bitshift64Lshr(($21|0),($24|0),8)|0);
 $42 = (getTempRet0() | 0);
 $43 = $41&255;
 $arrayidx85 = ((($md)) + 202|0);
 HEAP8[$arrayidx85>>0] = $43;
 $44 = $21&255;
 $arrayidx92 = ((($md)) + 203|0);
 HEAP8[$arrayidx92>>0] = $44;
 _sha512_compress($md,$buf);
 $i$066 = 0;
 while(1) {
  $arrayidx98 = (((($md)) + 8|0) + ($i$066<<3)|0);
  $45 = $arrayidx98;
  $46 = $45;
  $47 = HEAP32[$46>>2]|0;
  $48 = (($45) + 4)|0;
  $49 = $48;
  $50 = HEAP32[$49>>2]|0;
  $51 = (_bitshift64Lshr(($47|0),($50|0),56)|0);
  $52 = (getTempRet0() | 0);
  $53 = $51&255;
  $mul102 = $i$066 << 3;
  $add$ptr103 = (($out) + ($mul102)|0);
  HEAP8[$add$ptr103>>0] = $53;
  $54 = $arrayidx98;
  $55 = $54;
  $56 = HEAP32[$55>>2]|0;
  $57 = (($54) + 4)|0;
  $58 = $57;
  $59 = HEAP32[$58>>2]|0;
  $60 = (_bitshift64Lshr(($56|0),($59|0),48)|0);
  $61 = (getTempRet0() | 0);
  $62 = $60&255;
  $arrayidx112 = ((($add$ptr103)) + 1|0);
  HEAP8[$arrayidx112>>0] = $62;
  $63 = $arrayidx98;
  $64 = $63;
  $65 = HEAP32[$64>>2]|0;
  $66 = (($63) + 4)|0;
  $67 = $66;
  $68 = HEAP32[$67>>2]|0;
  $69 = (_bitshift64Lshr(($65|0),($68|0),40)|0);
  $70 = (getTempRet0() | 0);
  $71 = $69&255;
  $arrayidx120 = ((($add$ptr103)) + 2|0);
  HEAP8[$arrayidx120>>0] = $71;
  $72 = $arrayidx98;
  $73 = $72;
  $74 = HEAP32[$73>>2]|0;
  $75 = (($72) + 4)|0;
  $76 = $75;
  $77 = HEAP32[$76>>2]|0;
  $78 = $77&255;
  $arrayidx128 = ((($add$ptr103)) + 3|0);
  HEAP8[$arrayidx128>>0] = $78;
  $79 = $arrayidx98;
  $80 = $79;
  $81 = HEAP32[$80>>2]|0;
  $82 = (($79) + 4)|0;
  $83 = $82;
  $84 = HEAP32[$83>>2]|0;
  $85 = (_bitshift64Lshr(($81|0),($84|0),24)|0);
  $86 = (getTempRet0() | 0);
  $87 = $85&255;
  $arrayidx136 = ((($add$ptr103)) + 4|0);
  HEAP8[$arrayidx136>>0] = $87;
  $88 = $arrayidx98;
  $89 = $88;
  $90 = HEAP32[$89>>2]|0;
  $91 = (($88) + 4)|0;
  $92 = $91;
  $93 = HEAP32[$92>>2]|0;
  $94 = (_bitshift64Lshr(($90|0),($93|0),16)|0);
  $95 = (getTempRet0() | 0);
  $96 = $94&255;
  $arrayidx144 = ((($add$ptr103)) + 5|0);
  HEAP8[$arrayidx144>>0] = $96;
  $97 = $arrayidx98;
  $98 = $97;
  $99 = HEAP32[$98>>2]|0;
  $100 = (($97) + 4)|0;
  $101 = $100;
  $102 = HEAP32[$101>>2]|0;
  $103 = (_bitshift64Lshr(($99|0),($102|0),8)|0);
  $104 = (getTempRet0() | 0);
  $105 = $103&255;
  $arrayidx152 = ((($add$ptr103)) + 6|0);
  HEAP8[$arrayidx152>>0] = $105;
  $106 = $arrayidx98;
  $107 = $106;
  $108 = HEAP32[$107>>2]|0;
  $109 = (($106) + 4)|0;
  $110 = $109;
  $111 = HEAP32[$110>>2]|0;
  $112 = $108&255;
  $arrayidx159 = ((($add$ptr103)) + 7|0);
  HEAP8[$arrayidx159>>0] = $112;
  $inc160 = (($i$066) + 1)|0;
  $exitcond = ($inc160|0)==(8);
  if ($exitcond) {
   $retval$0 = 0;
   break;
  } else {
   $i$066 = $inc160;
  }
 }
 return ($retval$0|0);
}
function _sha512($message,$message_len,$out) {
 $message = $message|0;
 $message_len = $message_len|0;
 $out = $out|0;
 var $call = 0, $call1 = 0, $call5 = 0, $ctx = 0, $retval$0 = 0, $tobool = 0, $tobool2 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 208|0;
 $ctx = sp;
 $call = (_sha512_init($ctx)|0);
 $tobool = ($call|0)==(0);
 if ($tobool) {
  $call1 = (_sha512_update($ctx,$message,$message_len)|0);
  $tobool2 = ($call1|0)==(0);
  if ($tobool2) {
   $call5 = (_sha512_final($ctx,$out)|0);
   $retval$0 = $call5;
  } else {
   $retval$0 = $call1;
  }
 } else {
  $retval$0 = $call;
 }
 STACKTOP = sp;return ($retval$0|0);
}
function _ed25519_sign($signature,$message,$message_len,$public_key,$private_key) {
 $signature = $signature|0;
 $message = $message|0;
 $message_len = $message_len|0;
 $public_key = $public_key|0;
 $private_key = $private_key|0;
 var $R = 0, $add$ptr = 0, $add$ptr13 = 0, $hash = 0, $hram = 0, $r = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 496|0;
 $hash = sp + 128|0;
 $hram = sp + 64|0;
 $r = sp;
 $R = sp + 336|0;
 (_sha512_init($hash)|0);
 $add$ptr = ((($private_key)) + 32|0);
 (_sha512_update($hash,$add$ptr,32)|0);
 (_sha512_update($hash,$message,$message_len)|0);
 (_sha512_final($hash,$r)|0);
 _sc_reduce($r);
 _ge_scalarmult_base($R,$r);
 _ge_p3_tobytes($signature,$R);
 (_sha512_init($hash)|0);
 (_sha512_update($hash,$signature,32)|0);
 (_sha512_update($hash,$public_key,32)|0);
 (_sha512_update($hash,$message,$message_len)|0);
 (_sha512_final($hash,$hram)|0);
 _sc_reduce($hram);
 $add$ptr13 = ((($signature)) + 32|0);
 _sc_muladd($add$ptr13,$hram,$private_key,$r);
 STACKTOP = sp;return;
}
function _ed25519_verify($signature,$message,$message_len,$public_key) {
 $signature = $signature|0;
 $message = $message|0;
 $message_len = $message_len|0;
 $public_key = $public_key|0;
 var $$ = 0, $0 = 0, $A = 0, $R = 0, $add$ptr = 0, $arrayidx = 0, $call = 0, $call13 = 0, $checker = 0, $cmp = 0, $h = 0, $hash = 0, $retval$0 = 0, $tobool = 0, $tobool14 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 592|0;
 $h = sp + 32|0;
 $checker = sp;
 $hash = sp + 96|0;
 $A = sp + 424|0;
 $R = sp + 304|0;
 $arrayidx = ((($signature)) + 63|0);
 $0 = HEAP8[$arrayidx>>0]|0;
 $tobool = ($0&255)>(31);
 if ($tobool) {
  $retval$0 = 0;
  STACKTOP = sp;return ($retval$0|0);
 }
 $call = (_ge_frombytes_negate_vartime($A,$public_key)|0);
 $cmp = ($call|0)==(0);
 if (!($cmp)) {
  $retval$0 = 0;
  STACKTOP = sp;return ($retval$0|0);
 }
 (_sha512_init($hash)|0);
 (_sha512_update($hash,$signature,32)|0);
 (_sha512_update($hash,$public_key,32)|0);
 (_sha512_update($hash,$message,$message_len)|0);
 (_sha512_final($hash,$h)|0);
 _sc_reduce($h);
 $add$ptr = ((($signature)) + 32|0);
 _ge_double_scalarmult_vartime($R,$h,$A,$add$ptr);
 _ge_tobytes($checker,$R);
 $call13 = (_consttime_equal($checker,$signature)|0);
 $tobool14 = ($call13|0)!=(0);
 $$ = $tobool14&1;
 $retval$0 = $$;
 STACKTOP = sp;return ($retval$0|0);
}
function _consttime_equal($x,$y) {
 $x = $x|0;
 $y = $y|0;
 var $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0;
 var $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0;
 var $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0;
 var $63 = 0, $7 = 0, $8 = 0, $9 = 0, $arrayidx101 = 0, $arrayidx107 = 0, $arrayidx109 = 0, $arrayidx11 = 0, $arrayidx115 = 0, $arrayidx117 = 0, $arrayidx123 = 0, $arrayidx125 = 0, $arrayidx13 = 0, $arrayidx131 = 0, $arrayidx133 = 0, $arrayidx139 = 0, $arrayidx141 = 0, $arrayidx147 = 0, $arrayidx149 = 0, $arrayidx155 = 0;
 var $arrayidx157 = 0, $arrayidx163 = 0, $arrayidx165 = 0, $arrayidx171 = 0, $arrayidx173 = 0, $arrayidx179 = 0, $arrayidx181 = 0, $arrayidx187 = 0, $arrayidx189 = 0, $arrayidx19 = 0, $arrayidx195 = 0, $arrayidx197 = 0, $arrayidx203 = 0, $arrayidx205 = 0, $arrayidx21 = 0, $arrayidx211 = 0, $arrayidx213 = 0, $arrayidx219 = 0, $arrayidx221 = 0, $arrayidx227 = 0;
 var $arrayidx229 = 0, $arrayidx235 = 0, $arrayidx237 = 0, $arrayidx243 = 0, $arrayidx245 = 0, $arrayidx27 = 0, $arrayidx29 = 0, $arrayidx35 = 0, $arrayidx37 = 0, $arrayidx4 = 0, $arrayidx43 = 0, $arrayidx45 = 0, $arrayidx51 = 0, $arrayidx53 = 0, $arrayidx59 = 0, $arrayidx6 = 0, $arrayidx61 = 0, $arrayidx67 = 0, $arrayidx69 = 0, $arrayidx75 = 0;
 var $arrayidx77 = 0, $arrayidx83 = 0, $arrayidx85 = 0, $arrayidx91 = 0, $arrayidx93 = 0, $arrayidx99 = 0, $lnot$ext = 0, $or105120 = 0, $or113122 = 0, $or121124 = 0, $or129126 = 0, $or137128 = 0, $or145130 = 0, $or153132 = 0, $or161134 = 0, $or169136 = 0, $or177138 = 0, $or1798 = 0, $or185140 = 0, $or193142 = 0;
 var $or201144 = 0, $or209146 = 0, $or217148 = 0, $or225150 = 0, $or233152 = 0, $or241154 = 0, $or249156 = 0, $or25100 = 0, $or33102 = 0, $or41104 = 0, $or49106 = 0, $or57108 = 0, $or65110 = 0, $or73112 = 0, $or81114 = 0, $or89116 = 0, $or96 = 0, $or97118 = 0, $tobool = 0, $xor103119 = 0;
 var $xor111121 = 0, $xor119123 = 0, $xor127125 = 0, $xor135127 = 0, $xor143129 = 0, $xor151131 = 0, $xor159133 = 0, $xor1597 = 0, $xor167135 = 0, $xor175137 = 0, $xor183139 = 0, $xor191141 = 0, $xor199143 = 0, $xor207145 = 0, $xor215147 = 0, $xor223149 = 0, $xor231151 = 0, $xor239153 = 0, $xor2399 = 0, $xor247155 = 0;
 var $xor31101 = 0, $xor39103 = 0, $xor47105 = 0, $xor55107 = 0, $xor63109 = 0, $xor71111 = 0, $xor79113 = 0, $xor87115 = 0, $xor895 = 0, $xor94 = 0, $xor95117 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $0 = HEAP8[$x>>0]|0;
 $1 = HEAP8[$y>>0]|0;
 $xor94 = $1 ^ $0;
 $arrayidx4 = ((($x)) + 1|0);
 $2 = HEAP8[$arrayidx4>>0]|0;
 $arrayidx6 = ((($y)) + 1|0);
 $3 = HEAP8[$arrayidx6>>0]|0;
 $xor895 = $3 ^ $2;
 $or96 = $xor895 | $xor94;
 $arrayidx11 = ((($x)) + 2|0);
 $4 = HEAP8[$arrayidx11>>0]|0;
 $arrayidx13 = ((($y)) + 2|0);
 $5 = HEAP8[$arrayidx13>>0]|0;
 $xor1597 = $5 ^ $4;
 $or1798 = $or96 | $xor1597;
 $arrayidx19 = ((($x)) + 3|0);
 $6 = HEAP8[$arrayidx19>>0]|0;
 $arrayidx21 = ((($y)) + 3|0);
 $7 = HEAP8[$arrayidx21>>0]|0;
 $xor2399 = $7 ^ $6;
 $or25100 = $or1798 | $xor2399;
 $arrayidx27 = ((($x)) + 4|0);
 $8 = HEAP8[$arrayidx27>>0]|0;
 $arrayidx29 = ((($y)) + 4|0);
 $9 = HEAP8[$arrayidx29>>0]|0;
 $xor31101 = $9 ^ $8;
 $or33102 = $or25100 | $xor31101;
 $arrayidx35 = ((($x)) + 5|0);
 $10 = HEAP8[$arrayidx35>>0]|0;
 $arrayidx37 = ((($y)) + 5|0);
 $11 = HEAP8[$arrayidx37>>0]|0;
 $xor39103 = $11 ^ $10;
 $or41104 = $or33102 | $xor39103;
 $arrayidx43 = ((($x)) + 6|0);
 $12 = HEAP8[$arrayidx43>>0]|0;
 $arrayidx45 = ((($y)) + 6|0);
 $13 = HEAP8[$arrayidx45>>0]|0;
 $xor47105 = $13 ^ $12;
 $or49106 = $or41104 | $xor47105;
 $arrayidx51 = ((($x)) + 7|0);
 $14 = HEAP8[$arrayidx51>>0]|0;
 $arrayidx53 = ((($y)) + 7|0);
 $15 = HEAP8[$arrayidx53>>0]|0;
 $xor55107 = $15 ^ $14;
 $or57108 = $or49106 | $xor55107;
 $arrayidx59 = ((($x)) + 8|0);
 $16 = HEAP8[$arrayidx59>>0]|0;
 $arrayidx61 = ((($y)) + 8|0);
 $17 = HEAP8[$arrayidx61>>0]|0;
 $xor63109 = $17 ^ $16;
 $or65110 = $or57108 | $xor63109;
 $arrayidx67 = ((($x)) + 9|0);
 $18 = HEAP8[$arrayidx67>>0]|0;
 $arrayidx69 = ((($y)) + 9|0);
 $19 = HEAP8[$arrayidx69>>0]|0;
 $xor71111 = $19 ^ $18;
 $or73112 = $or65110 | $xor71111;
 $arrayidx75 = ((($x)) + 10|0);
 $20 = HEAP8[$arrayidx75>>0]|0;
 $arrayidx77 = ((($y)) + 10|0);
 $21 = HEAP8[$arrayidx77>>0]|0;
 $xor79113 = $21 ^ $20;
 $or81114 = $or73112 | $xor79113;
 $arrayidx83 = ((($x)) + 11|0);
 $22 = HEAP8[$arrayidx83>>0]|0;
 $arrayidx85 = ((($y)) + 11|0);
 $23 = HEAP8[$arrayidx85>>0]|0;
 $xor87115 = $23 ^ $22;
 $or89116 = $or81114 | $xor87115;
 $arrayidx91 = ((($x)) + 12|0);
 $24 = HEAP8[$arrayidx91>>0]|0;
 $arrayidx93 = ((($y)) + 12|0);
 $25 = HEAP8[$arrayidx93>>0]|0;
 $xor95117 = $25 ^ $24;
 $or97118 = $or89116 | $xor95117;
 $arrayidx99 = ((($x)) + 13|0);
 $26 = HEAP8[$arrayidx99>>0]|0;
 $arrayidx101 = ((($y)) + 13|0);
 $27 = HEAP8[$arrayidx101>>0]|0;
 $xor103119 = $27 ^ $26;
 $or105120 = $or97118 | $xor103119;
 $arrayidx107 = ((($x)) + 14|0);
 $28 = HEAP8[$arrayidx107>>0]|0;
 $arrayidx109 = ((($y)) + 14|0);
 $29 = HEAP8[$arrayidx109>>0]|0;
 $xor111121 = $29 ^ $28;
 $or113122 = $or105120 | $xor111121;
 $arrayidx115 = ((($x)) + 15|0);
 $30 = HEAP8[$arrayidx115>>0]|0;
 $arrayidx117 = ((($y)) + 15|0);
 $31 = HEAP8[$arrayidx117>>0]|0;
 $xor119123 = $31 ^ $30;
 $or121124 = $or113122 | $xor119123;
 $arrayidx123 = ((($x)) + 16|0);
 $32 = HEAP8[$arrayidx123>>0]|0;
 $arrayidx125 = ((($y)) + 16|0);
 $33 = HEAP8[$arrayidx125>>0]|0;
 $xor127125 = $33 ^ $32;
 $or129126 = $or121124 | $xor127125;
 $arrayidx131 = ((($x)) + 17|0);
 $34 = HEAP8[$arrayidx131>>0]|0;
 $arrayidx133 = ((($y)) + 17|0);
 $35 = HEAP8[$arrayidx133>>0]|0;
 $xor135127 = $35 ^ $34;
 $or137128 = $or129126 | $xor135127;
 $arrayidx139 = ((($x)) + 18|0);
 $36 = HEAP8[$arrayidx139>>0]|0;
 $arrayidx141 = ((($y)) + 18|0);
 $37 = HEAP8[$arrayidx141>>0]|0;
 $xor143129 = $37 ^ $36;
 $or145130 = $or137128 | $xor143129;
 $arrayidx147 = ((($x)) + 19|0);
 $38 = HEAP8[$arrayidx147>>0]|0;
 $arrayidx149 = ((($y)) + 19|0);
 $39 = HEAP8[$arrayidx149>>0]|0;
 $xor151131 = $39 ^ $38;
 $or153132 = $or145130 | $xor151131;
 $arrayidx155 = ((($x)) + 20|0);
 $40 = HEAP8[$arrayidx155>>0]|0;
 $arrayidx157 = ((($y)) + 20|0);
 $41 = HEAP8[$arrayidx157>>0]|0;
 $xor159133 = $41 ^ $40;
 $or161134 = $or153132 | $xor159133;
 $arrayidx163 = ((($x)) + 21|0);
 $42 = HEAP8[$arrayidx163>>0]|0;
 $arrayidx165 = ((($y)) + 21|0);
 $43 = HEAP8[$arrayidx165>>0]|0;
 $xor167135 = $43 ^ $42;
 $or169136 = $or161134 | $xor167135;
 $arrayidx171 = ((($x)) + 22|0);
 $44 = HEAP8[$arrayidx171>>0]|0;
 $arrayidx173 = ((($y)) + 22|0);
 $45 = HEAP8[$arrayidx173>>0]|0;
 $xor175137 = $45 ^ $44;
 $or177138 = $or169136 | $xor175137;
 $arrayidx179 = ((($x)) + 23|0);
 $46 = HEAP8[$arrayidx179>>0]|0;
 $arrayidx181 = ((($y)) + 23|0);
 $47 = HEAP8[$arrayidx181>>0]|0;
 $xor183139 = $47 ^ $46;
 $or185140 = $or177138 | $xor183139;
 $arrayidx187 = ((($x)) + 24|0);
 $48 = HEAP8[$arrayidx187>>0]|0;
 $arrayidx189 = ((($y)) + 24|0);
 $49 = HEAP8[$arrayidx189>>0]|0;
 $xor191141 = $49 ^ $48;
 $or193142 = $or185140 | $xor191141;
 $arrayidx195 = ((($x)) + 25|0);
 $50 = HEAP8[$arrayidx195>>0]|0;
 $arrayidx197 = ((($y)) + 25|0);
 $51 = HEAP8[$arrayidx197>>0]|0;
 $xor199143 = $51 ^ $50;
 $or201144 = $or193142 | $xor199143;
 $arrayidx203 = ((($x)) + 26|0);
 $52 = HEAP8[$arrayidx203>>0]|0;
 $arrayidx205 = ((($y)) + 26|0);
 $53 = HEAP8[$arrayidx205>>0]|0;
 $xor207145 = $53 ^ $52;
 $or209146 = $or201144 | $xor207145;
 $arrayidx211 = ((($x)) + 27|0);
 $54 = HEAP8[$arrayidx211>>0]|0;
 $arrayidx213 = ((($y)) + 27|0);
 $55 = HEAP8[$arrayidx213>>0]|0;
 $xor215147 = $55 ^ $54;
 $or217148 = $or209146 | $xor215147;
 $arrayidx219 = ((($x)) + 28|0);
 $56 = HEAP8[$arrayidx219>>0]|0;
 $arrayidx221 = ((($y)) + 28|0);
 $57 = HEAP8[$arrayidx221>>0]|0;
 $xor223149 = $57 ^ $56;
 $or225150 = $or217148 | $xor223149;
 $arrayidx227 = ((($x)) + 29|0);
 $58 = HEAP8[$arrayidx227>>0]|0;
 $arrayidx229 = ((($y)) + 29|0);
 $59 = HEAP8[$arrayidx229>>0]|0;
 $xor231151 = $59 ^ $58;
 $or233152 = $or225150 | $xor231151;
 $arrayidx235 = ((($x)) + 30|0);
 $60 = HEAP8[$arrayidx235>>0]|0;
 $arrayidx237 = ((($y)) + 30|0);
 $61 = HEAP8[$arrayidx237>>0]|0;
 $xor239153 = $61 ^ $60;
 $or241154 = $or233152 | $xor239153;
 $arrayidx243 = ((($x)) + 31|0);
 $62 = HEAP8[$arrayidx243>>0]|0;
 $arrayidx245 = ((($y)) + 31|0);
 $63 = HEAP8[$arrayidx245>>0]|0;
 $xor247155 = $63 ^ $62;
 $or249156 = $or241154 | $xor247155;
 $tobool = ($or249156<<24>>24)==(0);
 $lnot$ext = $tobool&1;
 return ($lnot$ext|0);
}
function _malloc($bytes) {
 $bytes = $bytes|0;
 var $$pre = 0, $$pre$i = 0, $$pre$i$i = 0, $$pre$i134 = 0, $$pre$i194 = 0, $$pre$i31$i = 0, $$pre$phi$i$iZ2D = 0, $$pre$phi$i195Z2D = 0, $$pre$phi$i32$iZ2D = 0, $$pre$phi$iZ2D = 0, $$pre$phiZ2D = 0, $0 = 0, $1 = 0, $10 = 0, $100 = 0, $101 = 0, $102 = 0, $103 = 0, $104 = 0, $105 = 0;
 var $106 = 0, $107 = 0, $108 = 0, $109 = 0, $11 = 0, $110 = 0, $111 = 0, $112 = 0, $113 = 0, $114 = 0, $115 = 0, $116 = 0, $117 = 0, $118 = 0, $119 = 0, $12 = 0, $120 = 0, $121 = 0, $122 = 0, $123 = 0;
 var $124 = 0, $125 = 0, $126 = 0, $127 = 0, $128 = 0, $129 = 0, $13 = 0, $130 = 0, $131 = 0, $132 = 0, $133 = 0, $134 = 0, $135 = 0, $136 = 0, $137 = 0, $138 = 0, $139 = 0, $14 = 0, $140 = 0, $141 = 0;
 var $142 = 0, $143 = 0, $144 = 0, $145 = 0, $146 = 0, $147 = 0, $148 = 0, $149 = 0, $15 = 0, $150 = 0, $151 = 0, $152 = 0, $153 = 0, $154 = 0, $155 = 0, $156 = 0, $157 = 0, $158 = 0, $159 = 0, $16 = 0;
 var $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0, $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0;
 var $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0, $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0;
 var $53 = 0, $54 = 0, $55 = 0, $56 = 0, $57 = 0, $58 = 0, $59 = 0, $6 = 0, $60 = 0, $61 = 0, $62 = 0, $63 = 0, $64 = 0, $65 = 0, $66 = 0, $67 = 0, $68 = 0, $69 = 0, $7 = 0, $70 = 0;
 var $71 = 0, $72 = 0, $73 = 0, $74 = 0, $75 = 0, $76 = 0, $77 = 0, $78 = 0, $79 = 0, $8 = 0, $80 = 0, $81 = 0, $82 = 0, $83 = 0, $84 = 0, $85 = 0, $86 = 0, $87 = 0, $88 = 0, $89 = 0;
 var $9 = 0, $90 = 0, $91 = 0, $92 = 0, $93 = 0, $94 = 0, $95 = 0, $96 = 0, $97 = 0, $98 = 0, $99 = 0, $F$0$i$i = 0, $F104$0 = 0, $F197$0$i = 0, $F224$0$i$i = 0, $F290$0$i = 0, $I252$0$i$i = 0, $I316$0$i = 0, $I57$0$i$i = 0, $K105$010$i$i = 0;
 var $K305$08$i$i = 0, $K373$015$i = 0, $R$1$i = 0, $R$1$i$be = 0, $R$1$i$i = 0, $R$1$i$i$be = 0, $R$1$i$i$ph = 0, $R$1$i$ph = 0, $R$1$i183 = 0, $R$1$i183$be = 0, $R$1$i183$ph = 0, $R$3$i = 0, $R$3$i$i = 0, $R$3$i188 = 0, $RP$1$i = 0, $RP$1$i$be = 0, $RP$1$i$i = 0, $RP$1$i$i$be = 0, $RP$1$i$i$ph = 0, $RP$1$i$ph = 0;
 var $RP$1$i182 = 0, $RP$1$i182$be = 0, $RP$1$i182$ph = 0, $T$0$lcssa$i = 0, $T$0$lcssa$i$i = 0, $T$0$lcssa$i34$i = 0, $T$014$i = 0, $T$07$i$i = 0, $T$09$i$i = 0, $add$i = 0, $add$i$i = 0, $add$i135 = 0, $add$i155 = 0, $add$ptr = 0, $add$ptr$i = 0, $add$ptr$i$i = 0, $add$ptr$i$i$i = 0, $add$ptr$i141 = 0, $add$ptr$i174 = 0, $add$ptr$i2$i$i = 0;
 var $add$ptr$i35$i = 0, $add$ptr$i43$i = 0, $add$ptr$i57$i = 0, $add$ptr14$i$i = 0, $add$ptr15$i$i = 0, $add$ptr16$i$i = 0, $add$ptr166 = 0, $add$ptr169 = 0, $add$ptr17$i$i = 0, $add$ptr178 = 0, $add$ptr181$i = 0, $add$ptr182 = 0, $add$ptr189$i = 0, $add$ptr190$i = 0, $add$ptr193 = 0, $add$ptr199 = 0, $add$ptr2$i$i = 0, $add$ptr205$i$i = 0, $add$ptr212$i$i = 0, $add$ptr225$i = 0;
 var $add$ptr227$i = 0, $add$ptr24$i$i = 0, $add$ptr262$i = 0, $add$ptr269$i = 0, $add$ptr273$i = 0, $add$ptr282$i = 0, $add$ptr3$i$i = 0, $add$ptr30$i$i = 0, $add$ptr369$i$i = 0, $add$ptr4$i$i = 0, $add$ptr4$i$i$i = 0, $add$ptr4$i41$i = 0, $add$ptr4$i49$i = 0, $add$ptr441$i = 0, $add$ptr5$i$i = 0, $add$ptr6$i$i = 0, $add$ptr6$i$i$i = 0, $add$ptr6$i53$i = 0, $add$ptr7$i$i = 0, $add$ptr81$i$i = 0;
 var $add$ptr95 = 0, $add$ptr98 = 0, $add10$i = 0, $add101$i = 0, $add110$i = 0, $add13$i = 0, $add14$i = 0, $add140$i = 0, $add144 = 0, $add150$i = 0, $add17$i = 0, $add17$i158 = 0, $add177$i = 0, $add18$i = 0, $add19$i = 0, $add2 = 0, $add20$i = 0, $add206$i$i = 0, $add212$i = 0, $add215$i = 0;
 var $add22$i = 0, $add246$i = 0, $add26$i$i = 0, $add268$i = 0, $add269$i$i = 0, $add274$i$i = 0, $add278$i$i = 0, $add280$i$i = 0, $add283$i$i = 0, $add337$i = 0, $add342$i = 0, $add346$i = 0, $add348$i = 0, $add351$i = 0, $add46$i = 0, $add50 = 0, $add51$i = 0, $add54 = 0, $add54$i = 0, $add58 = 0;
 var $add62 = 0, $add64 = 0, $add74$i$i = 0, $add77$i = 0, $add78$i = 0, $add79$i$i = 0, $add8 = 0, $add82$i = 0, $add83$i$i = 0, $add85$i$i = 0, $add86$i = 0, $add88$i$i = 0, $add9$i = 0, $add90$i = 0, $add92$i = 0, $and = 0, $and$i = 0, $and$i$i = 0, $and$i$i$i = 0, $and$i14$i = 0;
 var $and$i152 = 0, $and$i36$i = 0, $and$i44$i = 0, $and100$i = 0, $and103$i = 0, $and104$i = 0, $and106 = 0, $and11$i = 0, $and119$i$i = 0, $and1197$i$i = 0, $and12$i = 0, $and13$i = 0, $and13$i$i = 0, $and133$i$i = 0, $and14 = 0, $and145 = 0, $and17$i = 0, $and194$i = 0, $and194$i191 = 0, $and199$i = 0;
 var $and209$i$i = 0, $and21$i = 0, $and21$i159 = 0, $and227$i$i = 0, $and236$i = 0, $and264$i$i = 0, $and268$i$i = 0, $and273$i$i = 0, $and282$i$i = 0, $and29$i = 0, $and292$i = 0, $and295$i$i = 0, $and3$i = 0, $and3$i$i = 0, $and3$i$i$i = 0, $and3$i39$i = 0, $and3$i47$i = 0, $and30$i = 0, $and318$i$i = 0, $and3185$i$i = 0;
 var $and32$i = 0, $and32$i$i = 0, $and33$i$i = 0, $and331$i = 0, $and336$i = 0, $and341$i = 0, $and350$i = 0, $and363$i = 0, $and37$i$i = 0, $and387$i = 0, $and38712$i = 0, $and4 = 0, $and40$i$i = 0, $and41 = 0, $and42$i = 0, $and43 = 0, $and46 = 0, $and49 = 0, $and49$i = 0, $and49$i$i = 0;
 var $and53 = 0, $and57 = 0, $and6$i = 0, $and6$i$i = 0, $and6$i13$i = 0, $and6$i18$i = 0, $and61 = 0, $and64$i = 0, $and68$i = 0, $and69$i$i = 0, $and7 = 0, $and73$i = 0, $and73$i$i = 0, $and74 = 0, $and77$i = 0, $and78$i$i = 0, $and8$i = 0, $and80$i = 0, $and81$i = 0, $and85$i = 0;
 var $and87$i$i = 0, $and89$i = 0, $and9$i = 0, $and96$i$i = 0, $arrayidx = 0, $arrayidx$i = 0, $arrayidx$i$i = 0, $arrayidx$i160 = 0, $arrayidx103 = 0, $arrayidx103$i$i = 0, $arrayidx106$i = 0, $arrayidx107$i$i = 0, $arrayidx113$i = 0, $arrayidx113$i173 = 0, $arrayidx121$i = 0, $arrayidx121$i$sink = 0, $arrayidx123$i$i = 0, $arrayidx126$i$i = 0, $arrayidx137$i = 0, $arrayidx143$i$i = 0;
 var $arrayidx148$i = 0, $arrayidx151$i = 0, $arrayidx151$i$i = 0, $arrayidx151$i$i$sink = 0, $arrayidx154$i = 0, $arrayidx155$i = 0, $arrayidx161$i = 0, $arrayidx165$i = 0, $arrayidx165$i185 = 0, $arrayidx178$i$i = 0, $arrayidx184$i = 0, $arrayidx184$i$i = 0, $arrayidx195$i$i = 0, $arrayidx196$i = 0, $arrayidx204$i = 0, $arrayidx212$i = 0, $arrayidx212$i$sink = 0, $arrayidx223$i$i = 0, $arrayidx228$i = 0, $arrayidx23$i = 0;
 var $arrayidx239$i = 0, $arrayidx245$i = 0, $arrayidx256$i = 0, $arrayidx27$i = 0, $arrayidx287$i$i = 0, $arrayidx289$i = 0, $arrayidx290$i$i = 0, $arrayidx325$i$i = 0, $arrayidx355$i = 0, $arrayidx358$i = 0, $arrayidx394$i = 0, $arrayidx40$i = 0, $arrayidx44$i = 0, $arrayidx61$i = 0, $arrayidx65$i = 0, $arrayidx66 = 0, $arrayidx71$i = 0, $arrayidx75$i = 0, $arrayidx91$i$i = 0, $arrayidx92$i$i = 0;
 var $arrayidx94$i = 0, $arrayidx94$i170 = 0, $arrayidx96$i$i = 0, $bk$i = 0, $bk$i$i = 0, $bk$i176 = 0, $bk$i26$i = 0, $bk102$i$i = 0, $bk122 = 0, $bk124 = 0, $bk139$i$i = 0, $bk145$i = 0, $bk158$i$i = 0, $bk161$i$i = 0, $bk18 = 0, $bk218$i = 0, $bk220$i = 0, $bk246$i$i = 0, $bk248$i$i = 0, $bk302$i$i = 0;
 var $bk311$i = 0, $bk313$i = 0, $bk338$i$i = 0, $bk357$i$i = 0, $bk360$i$i = 0, $bk370$i = 0, $bk407$i = 0, $bk429$i = 0, $bk432$i = 0, $bk55$i$i = 0, $bk56$i = 0, $bk67$i$i = 0, $bk74$i$i = 0, $bk85 = 0, $bk91$i$i = 0, $br$2$ph$i = 0, $call107$i = 0, $call131$i = 0, $call132$i = 0, $call275$i = 0;
 var $call37$i = 0, $call68$i = 0, $call83$i = 0, $child$i$i = 0, $child166$i$i = 0, $child289$i$i = 0, $child357$i = 0, $cmp = 0, $cmp$i = 0, $cmp$i$i$i = 0, $cmp$i12$i = 0, $cmp$i133 = 0, $cmp$i149 = 0, $cmp$i15$i = 0, $cmp$i3$i$i = 0, $cmp$i37$i = 0, $cmp$i45$i = 0, $cmp$i55$i = 0, $cmp1 = 0, $cmp1$i = 0;
 var $cmp10 = 0, $cmp100$i$i = 0, $cmp102$i = 0, $cmp104$i$i = 0, $cmp105$i = 0, $cmp106$i$i = 0, $cmp107$i = 0, $cmp108$i = 0, $cmp108$i$i = 0, $cmp114$i = 0, $cmp116$i = 0, $cmp118$i = 0, $cmp119$i = 0, $cmp12$i = 0, $cmp120$i$i = 0, $cmp120$i28$i = 0, $cmp1208$i$i = 0, $cmp123$i = 0, $cmp124$i$i = 0, $cmp126$i = 0;
 var $cmp127$i = 0, $cmp128 = 0, $cmp128$i = 0, $cmp128$i$i = 0, $cmp133$i = 0, $cmp135$i = 0, $cmp137$i = 0, $cmp138$i = 0, $cmp139 = 0, $cmp141$i = 0, $cmp144$i$i = 0, $cmp146 = 0, $cmp147$i = 0, $cmp14799$i = 0, $cmp15$i = 0, $cmp151$i = 0, $cmp152$i = 0, $cmp155$i = 0, $cmp156 = 0, $cmp156$i = 0;
 var $cmp156$i$i = 0, $cmp157$i = 0, $cmp159$i = 0, $cmp162 = 0, $cmp162$i = 0, $cmp162$i184 = 0, $cmp166$i = 0, $cmp168$i$i = 0, $cmp174$i = 0, $cmp180$i = 0, $cmp185$i = 0, $cmp185$i$i = 0, $cmp186 = 0, $cmp186$i = 0, $cmp19$i = 0, $cmp190$i = 0, $cmp191$i = 0, $cmp2$i$i = 0, $cmp2$i$i$i = 0, $cmp20$i$i = 0;
 var $cmp203$i = 0, $cmp205$i = 0, $cmp209$i = 0, $cmp21$i = 0, $cmp215$i$i = 0, $cmp217$i = 0, $cmp218$i = 0, $cmp224$i = 0, $cmp228$i = 0, $cmp229$i = 0, $cmp24$i = 0, $cmp24$i$i = 0, $cmp246$i = 0, $cmp254$i$i = 0, $cmp257$i = 0, $cmp258$i$i = 0, $cmp26$i = 0, $cmp265$i = 0, $cmp27$i$i = 0, $cmp28$i = 0;
 var $cmp28$i$i = 0, $cmp284$i = 0, $cmp29 = 0, $cmp3$i$i = 0, $cmp306$i$i = 0, $cmp31 = 0, $cmp319$i = 0, $cmp319$i$i = 0, $cmp3196$i$i = 0, $cmp32$i = 0, $cmp32$i138 = 0, $cmp323$i = 0, $cmp327$i$i = 0, $cmp34$i = 0, $cmp34$i$i = 0, $cmp35$i = 0, $cmp36$i = 0, $cmp36$i$i = 0, $cmp374$i = 0, $cmp38$i = 0;
 var $cmp38$i$i = 0, $cmp388$i = 0, $cmp38813$i = 0, $cmp396$i = 0, $cmp40$i = 0, $cmp43$i = 0, $cmp45$i = 0, $cmp46$i = 0, $cmp46$i$i = 0, $cmp49$i = 0, $cmp5 = 0, $cmp55$i = 0, $cmp55$i166 = 0, $cmp57$i = 0, $cmp57$i167 = 0, $cmp59$i$i = 0, $cmp60$i = 0, $cmp62$i = 0, $cmp63$i = 0, $cmp63$i$i = 0;
 var $cmp65$i = 0, $cmp66$i = 0, $cmp66$i140 = 0, $cmp69$i = 0, $cmp7$i$i = 0, $cmp70 = 0, $cmp72$i = 0, $cmp75$i$i = 0, $cmp76$i = 0, $cmp81$i = 0, $cmp85$i = 0, $cmp89$i = 0, $cmp9$i$i = 0, $cmp90$i = 0, $cmp91$i = 0, $cmp93$i = 0, $cmp95$i = 0, $cmp96$i = 0, $cmp97$i = 0, $cmp97$i$i = 0;
 var $cmp9716$i = 0, $cmp99 = 0, $cond = 0, $cond$i = 0, $cond$i$i = 0, $cond$i$i$i = 0, $cond$i17$i = 0, $cond$i40$i = 0, $cond$i48$i = 0, $cond1$i$i = 0, $cond115$i = 0, $cond115$i$i = 0, $cond13$i$i = 0, $cond15$i$i = 0, $cond2$i = 0, $cond3$i = 0, $cond315$i$i = 0, $cond383$i = 0, $cond4$i = 0, $fd$i = 0;
 var $fd$i$i = 0, $fd$i177 = 0, $fd103$i$i = 0, $fd123 = 0, $fd140$i$i = 0, $fd146$i = 0, $fd148$i$i = 0, $fd160$i$i = 0, $fd219$i = 0, $fd247$i$i = 0, $fd303$i$i = 0, $fd312$i = 0, $fd339$i$i = 0, $fd344$i$i = 0, $fd359$i$i = 0, $fd371$i = 0, $fd408$i = 0, $fd416$i = 0, $fd431$i = 0, $fd54$i$i = 0;
 var $fd57$i = 0, $fd68$i$i = 0, $fd69 = 0, $fd78$i$i = 0, $fd9 = 0, $fd92$i$i = 0, $head = 0, $head$i = 0, $head$i$i = 0, $head$i$i$i = 0, $head$i164 = 0, $head$i22$i = 0, $head$i42$i = 0, $head$i52$i = 0, $head118$i$i = 0, $head1186$i$i = 0, $head168 = 0, $head173 = 0, $head177 = 0, $head179 = 0;
 var $head179$i = 0, $head182$i = 0, $head187$i = 0, $head189$i = 0, $head195 = 0, $head198 = 0, $head208$i$i = 0, $head211$i$i = 0, $head23$i$i = 0, $head25 = 0, $head26$i$i = 0, $head265$i = 0, $head268$i = 0, $head271$i = 0, $head274$i = 0, $head279$i = 0, $head281$i = 0, $head29$i = 0, $head29$i$i = 0, $head317$i$i = 0;
 var $head3174$i$i = 0, $head32$i$i = 0, $head34$i$i = 0, $head386$i = 0, $head38611$i = 0, $head7$i$i = 0, $head7$i$i$i = 0, $head7$i54$i = 0, $head94 = 0, $head97 = 0, $head99$i = 0, $idx$0$i = 0, $index$i = 0, $index$i$i = 0, $index$i189 = 0, $index$i29$i = 0, $index288$i$i = 0, $index356$i = 0, $magic$i$i = 0, $nb$0 = 0;
 var $neg = 0, $neg$i = 0, $neg$i$i = 0, $neg$i137 = 0, $neg$i190 = 0, $neg103$i = 0, $neg13 = 0, $neg132$i$i = 0, $neg48$i = 0, $neg73 = 0, $next$i = 0, $next$i$i = 0, $next$i$i$i = 0, $next231$i = 0, $not$cmp141$i = 0, $oldfirst$0$i$i = 0, $or$cond$i = 0, $or$cond$i168 = 0, $or$cond1$i = 0, $or$cond1$i165 = 0;
 var $or$cond11$i = 0, $or$cond2$i = 0, $or$cond4$i = 0, $or$cond5$i = 0, $or$cond7$i = 0, $or$cond8$i = 0, $or$cond8$not$i = 0, $or$cond97$i = 0, $or$cond98$i = 0, $or$i = 0, $or$i$i = 0, $or$i$i$i = 0, $or$i169 = 0, $or$i51$i = 0, $or101$i$i = 0, $or110 = 0, $or167 = 0, $or172 = 0, $or176 = 0, $or178$i = 0;
 var $or180 = 0, $or183$i = 0, $or186$i = 0, $or188$i = 0, $or19$i$i = 0, $or194 = 0, $or197 = 0, $or204$i = 0, $or210$i$i = 0, $or22$i$i = 0, $or23 = 0, $or232$i$i = 0, $or26 = 0, $or264$i = 0, $or267$i = 0, $or270$i = 0, $or275$i = 0, $or278$i = 0, $or28$i$i = 0, $or280$i = 0;
 var $or297$i = 0, $or300$i$i = 0, $or33$i$i = 0, $or368$i = 0, $or40 = 0, $or44$i$i = 0, $or93 = 0, $or96 = 0, $parent$i = 0, $parent$i$i = 0, $parent$i175 = 0, $parent$i27$i = 0, $parent135$i = 0, $parent138$i$i = 0, $parent149$i = 0, $parent162$i$i = 0, $parent165$i$i = 0, $parent166$i = 0, $parent179$i$i = 0, $parent196$i$i = 0;
 var $parent226$i = 0, $parent240$i = 0, $parent257$i = 0, $parent301$i$i = 0, $parent337$i$i = 0, $parent361$i$i = 0, $parent369$i = 0, $parent406$i = 0, $parent433$i = 0, $qsize$0$i$i = 0, $retval$0 = 0, $rsize$0$i = 0, $rsize$0$i162 = 0, $rsize$1$i = 0, $rsize$3$i = 0, $rsize$4$lcssa$i = 0, $rsize$418$i = 0, $rsize$418$i$ph = 0, $rst$0$i = 0, $rst$1$i = 0;
 var $sflags193$i = 0, $sflags235$i = 0, $shl = 0, $shl$i = 0, $shl$i$i = 0, $shl$i153 = 0, $shl102 = 0, $shl105 = 0, $shl116$i$i = 0, $shl12 = 0, $shl127$i$i = 0, $shl131$i$i = 0, $shl15$i = 0, $shl18$i = 0, $shl192$i = 0, $shl195$i = 0, $shl198$i = 0, $shl22 = 0, $shl222$i$i = 0, $shl226$i$i = 0;
 var $shl265$i$i = 0, $shl270$i$i = 0, $shl276$i$i = 0, $shl279$i$i = 0, $shl288$i = 0, $shl291$i = 0, $shl294$i$i = 0, $shl31$i = 0, $shl316$i$i = 0, $shl326$i$i = 0, $shl333$i = 0, $shl338$i = 0, $shl344$i = 0, $shl347$i = 0, $shl35 = 0, $shl362$i = 0, $shl37 = 0, $shl384$i = 0, $shl39$i$i = 0, $shl395$i = 0;
 var $shl48$i$i = 0, $shl60$i = 0, $shl65 = 0, $shl70$i$i = 0, $shl72 = 0, $shl75$i$i = 0, $shl81$i$i = 0, $shl84$i$i = 0, $shl9$i = 0, $shl90 = 0, $shl95$i$i = 0, $shr = 0, $shr$i = 0, $shr$i$i = 0, $shr$i148 = 0, $shr$i25$i = 0, $shr101 = 0, $shr11$i = 0, $shr11$i156 = 0, $shr110$i$i = 0;
 var $shr12$i = 0, $shr124$i$i = 0, $shr15$i = 0, $shr16$i = 0, $shr16$i157 = 0, $shr19$i = 0, $shr194$i = 0, $shr20$i = 0, $shr214$i$i = 0, $shr253$i$i = 0, $shr263$i$i = 0, $shr267$i$i = 0, $shr27$i = 0, $shr272$i$i = 0, $shr277$i$i = 0, $shr281$i$i = 0, $shr283$i = 0, $shr3 = 0, $shr310$i$i = 0, $shr318$i = 0;
 var $shr323$i$i = 0, $shr330$i = 0, $shr335$i = 0, $shr340$i = 0, $shr345$i = 0, $shr349$i = 0, $shr378$i = 0, $shr392$i = 0, $shr4$i = 0, $shr42$i = 0, $shr45 = 0, $shr47 = 0, $shr48 = 0, $shr5$i = 0, $shr5$i151 = 0, $shr51 = 0, $shr52 = 0, $shr55 = 0, $shr56 = 0, $shr58$i$i = 0;
 var $shr59 = 0, $shr60 = 0, $shr63 = 0, $shr68$i$i = 0, $shr7$i = 0, $shr7$i154 = 0, $shr72$i = 0, $shr72$i$i = 0, $shr75$i = 0, $shr76$i = 0, $shr77$i$i = 0, $shr79$i = 0, $shr8$i = 0, $shr80$i = 0, $shr82$i$i = 0, $shr83$i = 0, $shr84$i = 0, $shr86$i$i = 0, $shr87$i = 0, $shr88$i = 0;
 var $shr91$i = 0, $size$i$i = 0, $size$i$i$i = 0, $size$i$i$le = 0, $size188$i = 0, $size188$i$le = 0, $size245$i = 0, $sizebits$0$i = 0, $sp$0$i$i = 0, $sp$0$i$i$i = 0, $sp$0112$i = 0, $sp$1111$i = 0, $spec$select$i = 0, $spec$select$i171 = 0, $spec$select1$i = 0, $spec$select2$i = 0, $spec$select5$i = 0, $spec$select9$i = 0, $spec$select96$i = 0, $ssize$2$ph$i = 0;
 var $sub = 0, $sub$i = 0, $sub$i$i = 0, $sub$i$i$i = 0, $sub$i136 = 0, $sub$i147 = 0, $sub$i16$i = 0, $sub$i38$i = 0, $sub$i46$i = 0, $sub$ptr$lhs$cast$i = 0, $sub$ptr$lhs$cast$i$i = 0, $sub$ptr$lhs$cast$i19$i = 0, $sub$ptr$rhs$cast$i = 0, $sub$ptr$rhs$cast$i$i = 0, $sub$ptr$rhs$cast$i20$i = 0, $sub$ptr$sub$i = 0, $sub$ptr$sub$i$i = 0, $sub$ptr$sub$i21$i = 0, $sub10$i = 0, $sub101$i = 0;
 var $sub112$i = 0, $sub113$i$i = 0, $sub118$i = 0, $sub12$i$i = 0, $sub14$i = 0, $sub16$i$i = 0, $sub160 = 0, $sub172$i = 0, $sub18$i$i = 0, $sub190 = 0, $sub2$i = 0, $sub22$i = 0, $sub260$i = 0, $sub262$i$i = 0, $sub266$i$i = 0, $sub271$i$i = 0, $sub275$i$i = 0, $sub30$i = 0, $sub31$i = 0, $sub313$i$i = 0;
 var $sub329$i = 0, $sub33$i = 0, $sub334$i = 0, $sub339$i = 0, $sub343$i = 0, $sub381$i = 0, $sub4$i = 0, $sub41$i = 0, $sub42 = 0, $sub44 = 0, $sub5$i$i = 0, $sub5$i$i$i = 0, $sub5$i50$i = 0, $sub50$i = 0, $sub6$i = 0, $sub63$i = 0, $sub67$i = 0, $sub67$i$i = 0, $sub70$i = 0, $sub71$i$i = 0;
 var $sub76$i$i = 0, $sub80$i$i = 0, $sub91 = 0, $sub99$i = 0, $t$0$i = 0, $t$0$i161 = 0, $t$2$i = 0, $t$4$i = 0, $t$517$i = 0, $t$517$i$ph = 0, $tbase$795$i = 0, $tobool$i$i = 0, $tobool107 = 0, $tobool195$i = 0, $tobool200$i = 0, $tobool228$i$i = 0, $tobool237$i = 0, $tobool293$i = 0, $tobool296$i$i = 0, $tobool30$i = 0;
 var $tobool364$i = 0, $tobool97$i$i = 0, $tsize$2647482$i = 0, $tsize$4$i = 0, $tsize$794$i = 0, $v$0$i = 0, $v$0$i163 = 0, $v$1$i = 0, $v$3$i = 0, $v$3$i204 = 0, $v$4$lcssa$i = 0, $v$419$i = 0, $v$419$i$ph = 0, $xor$i$i = 0, label = 0, sp = 0;
 sp = STACKTOP;
 STACKTOP = STACKTOP + 16|0;
 $magic$i$i = sp;
 $cmp = ($bytes>>>0)<(245);
 do {
  if ($cmp) {
   $cmp1 = ($bytes>>>0)<(11);
   $add2 = (($bytes) + 11)|0;
   $and = $add2 & -8;
   $cond = $cmp1 ? 16 : $and;
   $shr = $cond >>> 3;
   $0 = HEAP32[8120]|0;
   $shr3 = $0 >>> $shr;
   $and4 = $shr3 & 3;
   $cmp5 = ($and4|0)==(0);
   if (!($cmp5)) {
    $neg = $shr3 & 1;
    $and7 = $neg ^ 1;
    $add8 = (($and7) + ($shr))|0;
    $shl = $add8 << 1;
    $arrayidx = (32520 + ($shl<<2)|0);
    $1 = ((($arrayidx)) + 8|0);
    $2 = HEAP32[$1>>2]|0;
    $fd9 = ((($2)) + 8|0);
    $3 = HEAP32[$fd9>>2]|0;
    $cmp10 = ($3|0)==($arrayidx|0);
    if ($cmp10) {
     $shl12 = 1 << $add8;
     $neg13 = $shl12 ^ -1;
     $and14 = $0 & $neg13;
     HEAP32[8120] = $and14;
    } else {
     $bk18 = ((($3)) + 12|0);
     HEAP32[$bk18>>2] = $arrayidx;
     HEAP32[$1>>2] = $3;
    }
    $shl22 = $add8 << 3;
    $or23 = $shl22 | 3;
    $head = ((($2)) + 4|0);
    HEAP32[$head>>2] = $or23;
    $add$ptr = (($2) + ($shl22)|0);
    $head25 = ((($add$ptr)) + 4|0);
    $4 = HEAP32[$head25>>2]|0;
    $or26 = $4 | 1;
    HEAP32[$head25>>2] = $or26;
    $retval$0 = $fd9;
    STACKTOP = sp;return ($retval$0|0);
   }
   $5 = HEAP32[(32488)>>2]|0;
   $cmp29 = ($cond>>>0)>($5>>>0);
   if ($cmp29) {
    $cmp31 = ($shr3|0)==(0);
    if (!($cmp31)) {
     $shl35 = $shr3 << $shr;
     $shl37 = 2 << $shr;
     $sub = (0 - ($shl37))|0;
     $or40 = $shl37 | $sub;
     $and41 = $shl35 & $or40;
     $sub42 = (0 - ($and41))|0;
     $and43 = $and41 & $sub42;
     $sub44 = (($and43) + -1)|0;
     $shr45 = $sub44 >>> 12;
     $and46 = $shr45 & 16;
     $shr47 = $sub44 >>> $and46;
     $shr48 = $shr47 >>> 5;
     $and49 = $shr48 & 8;
     $add50 = $and49 | $and46;
     $shr51 = $shr47 >>> $and49;
     $shr52 = $shr51 >>> 2;
     $and53 = $shr52 & 4;
     $add54 = $add50 | $and53;
     $shr55 = $shr51 >>> $and53;
     $shr56 = $shr55 >>> 1;
     $and57 = $shr56 & 2;
     $add58 = $add54 | $and57;
     $shr59 = $shr55 >>> $and57;
     $shr60 = $shr59 >>> 1;
     $and61 = $shr60 & 1;
     $add62 = $add58 | $and61;
     $shr63 = $shr59 >>> $and61;
     $add64 = (($add62) + ($shr63))|0;
     $shl65 = $add64 << 1;
     $arrayidx66 = (32520 + ($shl65<<2)|0);
     $6 = ((($arrayidx66)) + 8|0);
     $7 = HEAP32[$6>>2]|0;
     $fd69 = ((($7)) + 8|0);
     $8 = HEAP32[$fd69>>2]|0;
     $cmp70 = ($8|0)==($arrayidx66|0);
     if ($cmp70) {
      $shl72 = 1 << $add64;
      $neg73 = $shl72 ^ -1;
      $and74 = $0 & $neg73;
      HEAP32[8120] = $and74;
      $10 = $and74;
     } else {
      $bk85 = ((($8)) + 12|0);
      HEAP32[$bk85>>2] = $arrayidx66;
      HEAP32[$6>>2] = $8;
      $10 = $0;
     }
     $shl90 = $add64 << 3;
     $sub91 = (($shl90) - ($cond))|0;
     $or93 = $cond | 3;
     $head94 = ((($7)) + 4|0);
     HEAP32[$head94>>2] = $or93;
     $add$ptr95 = (($7) + ($cond)|0);
     $or96 = $sub91 | 1;
     $head97 = ((($add$ptr95)) + 4|0);
     HEAP32[$head97>>2] = $or96;
     $add$ptr98 = (($7) + ($shl90)|0);
     HEAP32[$add$ptr98>>2] = $sub91;
     $cmp99 = ($5|0)==(0);
     if (!($cmp99)) {
      $9 = HEAP32[(32500)>>2]|0;
      $shr101 = $5 >>> 3;
      $shl102 = $shr101 << 1;
      $arrayidx103 = (32520 + ($shl102<<2)|0);
      $shl105 = 1 << $shr101;
      $and106 = $10 & $shl105;
      $tobool107 = ($and106|0)==(0);
      if ($tobool107) {
       $or110 = $10 | $shl105;
       HEAP32[8120] = $or110;
       $$pre = ((($arrayidx103)) + 8|0);
       $$pre$phiZ2D = $$pre;$F104$0 = $arrayidx103;
      } else {
       $11 = ((($arrayidx103)) + 8|0);
       $12 = HEAP32[$11>>2]|0;
       $$pre$phiZ2D = $11;$F104$0 = $12;
      }
      HEAP32[$$pre$phiZ2D>>2] = $9;
      $bk122 = ((($F104$0)) + 12|0);
      HEAP32[$bk122>>2] = $9;
      $fd123 = ((($9)) + 8|0);
      HEAP32[$fd123>>2] = $F104$0;
      $bk124 = ((($9)) + 12|0);
      HEAP32[$bk124>>2] = $arrayidx103;
     }
     HEAP32[(32488)>>2] = $sub91;
     HEAP32[(32500)>>2] = $add$ptr95;
     $retval$0 = $fd69;
     STACKTOP = sp;return ($retval$0|0);
    }
    $13 = HEAP32[(32484)>>2]|0;
    $cmp128 = ($13|0)==(0);
    if ($cmp128) {
     $nb$0 = $cond;
    } else {
     $sub$i = (0 - ($13))|0;
     $and$i = $13 & $sub$i;
     $sub2$i = (($and$i) + -1)|0;
     $shr$i = $sub2$i >>> 12;
     $and3$i = $shr$i & 16;
     $shr4$i = $sub2$i >>> $and3$i;
     $shr5$i = $shr4$i >>> 5;
     $and6$i = $shr5$i & 8;
     $add$i = $and6$i | $and3$i;
     $shr7$i = $shr4$i >>> $and6$i;
     $shr8$i = $shr7$i >>> 2;
     $and9$i = $shr8$i & 4;
     $add10$i = $add$i | $and9$i;
     $shr11$i = $shr7$i >>> $and9$i;
     $shr12$i = $shr11$i >>> 1;
     $and13$i = $shr12$i & 2;
     $add14$i = $add10$i | $and13$i;
     $shr15$i = $shr11$i >>> $and13$i;
     $shr16$i = $shr15$i >>> 1;
     $and17$i = $shr16$i & 1;
     $add18$i = $add14$i | $and17$i;
     $shr19$i = $shr15$i >>> $and17$i;
     $add20$i = (($add18$i) + ($shr19$i))|0;
     $arrayidx$i = (32784 + ($add20$i<<2)|0);
     $14 = HEAP32[$arrayidx$i>>2]|0;
     $head$i = ((($14)) + 4|0);
     $15 = HEAP32[$head$i>>2]|0;
     $and21$i = $15 & -8;
     $sub22$i = (($and21$i) - ($cond))|0;
     $rsize$0$i = $sub22$i;$t$0$i = $14;$v$0$i = $14;
     while(1) {
      $arrayidx23$i = ((($t$0$i)) + 16|0);
      $16 = HEAP32[$arrayidx23$i>>2]|0;
      $cmp$i = ($16|0)==(0|0);
      if ($cmp$i) {
       $arrayidx27$i = ((($t$0$i)) + 20|0);
       $17 = HEAP32[$arrayidx27$i>>2]|0;
       $cmp28$i = ($17|0)==(0|0);
       if ($cmp28$i) {
        break;
       } else {
        $cond4$i = $17;
       }
      } else {
       $cond4$i = $16;
      }
      $head29$i = ((($cond4$i)) + 4|0);
      $18 = HEAP32[$head29$i>>2]|0;
      $and30$i = $18 & -8;
      $sub31$i = (($and30$i) - ($cond))|0;
      $cmp32$i = ($sub31$i>>>0)<($rsize$0$i>>>0);
      $spec$select$i = $cmp32$i ? $sub31$i : $rsize$0$i;
      $spec$select1$i = $cmp32$i ? $cond4$i : $v$0$i;
      $rsize$0$i = $spec$select$i;$t$0$i = $cond4$i;$v$0$i = $spec$select1$i;
     }
     $add$ptr$i = (($v$0$i) + ($cond)|0);
     $cmp35$i = ($add$ptr$i>>>0)>($v$0$i>>>0);
     if ($cmp35$i) {
      $parent$i = ((($v$0$i)) + 24|0);
      $19 = HEAP32[$parent$i>>2]|0;
      $bk$i = ((($v$0$i)) + 12|0);
      $20 = HEAP32[$bk$i>>2]|0;
      $cmp40$i = ($20|0)==($v$0$i|0);
      do {
       if ($cmp40$i) {
        $arrayidx61$i = ((($v$0$i)) + 20|0);
        $22 = HEAP32[$arrayidx61$i>>2]|0;
        $cmp62$i = ($22|0)==(0|0);
        if ($cmp62$i) {
         $arrayidx65$i = ((($v$0$i)) + 16|0);
         $23 = HEAP32[$arrayidx65$i>>2]|0;
         $cmp66$i = ($23|0)==(0|0);
         if ($cmp66$i) {
          $R$3$i = 0;
          break;
         } else {
          $R$1$i$ph = $23;$RP$1$i$ph = $arrayidx65$i;
         }
        } else {
         $R$1$i$ph = $22;$RP$1$i$ph = $arrayidx61$i;
        }
        $R$1$i = $R$1$i$ph;$RP$1$i = $RP$1$i$ph;
        while(1) {
         $arrayidx71$i = ((($R$1$i)) + 20|0);
         $24 = HEAP32[$arrayidx71$i>>2]|0;
         $cmp72$i = ($24|0)==(0|0);
         if ($cmp72$i) {
          $arrayidx75$i = ((($R$1$i)) + 16|0);
          $25 = HEAP32[$arrayidx75$i>>2]|0;
          $cmp76$i = ($25|0)==(0|0);
          if ($cmp76$i) {
           break;
          } else {
           $R$1$i$be = $25;$RP$1$i$be = $arrayidx75$i;
          }
         } else {
          $R$1$i$be = $24;$RP$1$i$be = $arrayidx71$i;
         }
         $R$1$i = $R$1$i$be;$RP$1$i = $RP$1$i$be;
        }
        HEAP32[$RP$1$i>>2] = 0;
        $R$3$i = $R$1$i;
       } else {
        $fd$i = ((($v$0$i)) + 8|0);
        $21 = HEAP32[$fd$i>>2]|0;
        $bk56$i = ((($21)) + 12|0);
        HEAP32[$bk56$i>>2] = $20;
        $fd57$i = ((($20)) + 8|0);
        HEAP32[$fd57$i>>2] = $21;
        $R$3$i = $20;
       }
      } while(0);
      $cmp90$i = ($19|0)==(0|0);
      do {
       if (!($cmp90$i)) {
        $index$i = ((($v$0$i)) + 28|0);
        $26 = HEAP32[$index$i>>2]|0;
        $arrayidx94$i = (32784 + ($26<<2)|0);
        $27 = HEAP32[$arrayidx94$i>>2]|0;
        $cmp95$i = ($v$0$i|0)==($27|0);
        if ($cmp95$i) {
         HEAP32[$arrayidx94$i>>2] = $R$3$i;
         $cond2$i = ($R$3$i|0)==(0|0);
         if ($cond2$i) {
          $shl$i = 1 << $26;
          $neg$i = $shl$i ^ -1;
          $and103$i = $13 & $neg$i;
          HEAP32[(32484)>>2] = $and103$i;
          break;
         }
        } else {
         $arrayidx113$i = ((($19)) + 16|0);
         $28 = HEAP32[$arrayidx113$i>>2]|0;
         $cmp114$i = ($28|0)==($v$0$i|0);
         $arrayidx121$i = ((($19)) + 20|0);
         $arrayidx121$i$sink = $cmp114$i ? $arrayidx113$i : $arrayidx121$i;
         HEAP32[$arrayidx121$i$sink>>2] = $R$3$i;
         $cmp126$i = ($R$3$i|0)==(0|0);
         if ($cmp126$i) {
          break;
         }
        }
        $parent135$i = ((($R$3$i)) + 24|0);
        HEAP32[$parent135$i>>2] = $19;
        $arrayidx137$i = ((($v$0$i)) + 16|0);
        $29 = HEAP32[$arrayidx137$i>>2]|0;
        $cmp138$i = ($29|0)==(0|0);
        if (!($cmp138$i)) {
         $arrayidx148$i = ((($R$3$i)) + 16|0);
         HEAP32[$arrayidx148$i>>2] = $29;
         $parent149$i = ((($29)) + 24|0);
         HEAP32[$parent149$i>>2] = $R$3$i;
        }
        $arrayidx154$i = ((($v$0$i)) + 20|0);
        $30 = HEAP32[$arrayidx154$i>>2]|0;
        $cmp155$i = ($30|0)==(0|0);
        if (!($cmp155$i)) {
         $arrayidx165$i = ((($R$3$i)) + 20|0);
         HEAP32[$arrayidx165$i>>2] = $30;
         $parent166$i = ((($30)) + 24|0);
         HEAP32[$parent166$i>>2] = $R$3$i;
        }
       }
      } while(0);
      $cmp174$i = ($rsize$0$i>>>0)<(16);
      if ($cmp174$i) {
       $add177$i = (($rsize$0$i) + ($cond))|0;
       $or178$i = $add177$i | 3;
       $head179$i = ((($v$0$i)) + 4|0);
       HEAP32[$head179$i>>2] = $or178$i;
       $add$ptr181$i = (($v$0$i) + ($add177$i)|0);
       $head182$i = ((($add$ptr181$i)) + 4|0);
       $31 = HEAP32[$head182$i>>2]|0;
       $or183$i = $31 | 1;
       HEAP32[$head182$i>>2] = $or183$i;
      } else {
       $or186$i = $cond | 3;
       $head187$i = ((($v$0$i)) + 4|0);
       HEAP32[$head187$i>>2] = $or186$i;
       $or188$i = $rsize$0$i | 1;
       $head189$i = ((($add$ptr$i)) + 4|0);
       HEAP32[$head189$i>>2] = $or188$i;
       $add$ptr190$i = (($add$ptr$i) + ($rsize$0$i)|0);
       HEAP32[$add$ptr190$i>>2] = $rsize$0$i;
       $cmp191$i = ($5|0)==(0);
       if (!($cmp191$i)) {
        $32 = HEAP32[(32500)>>2]|0;
        $shr194$i = $5 >>> 3;
        $shl195$i = $shr194$i << 1;
        $arrayidx196$i = (32520 + ($shl195$i<<2)|0);
        $shl198$i = 1 << $shr194$i;
        $and199$i = $shl198$i & $0;
        $tobool200$i = ($and199$i|0)==(0);
        if ($tobool200$i) {
         $or204$i = $shl198$i | $0;
         HEAP32[8120] = $or204$i;
         $$pre$i = ((($arrayidx196$i)) + 8|0);
         $$pre$phi$iZ2D = $$pre$i;$F197$0$i = $arrayidx196$i;
        } else {
         $33 = ((($arrayidx196$i)) + 8|0);
         $34 = HEAP32[$33>>2]|0;
         $$pre$phi$iZ2D = $33;$F197$0$i = $34;
        }
        HEAP32[$$pre$phi$iZ2D>>2] = $32;
        $bk218$i = ((($F197$0$i)) + 12|0);
        HEAP32[$bk218$i>>2] = $32;
        $fd219$i = ((($32)) + 8|0);
        HEAP32[$fd219$i>>2] = $F197$0$i;
        $bk220$i = ((($32)) + 12|0);
        HEAP32[$bk220$i>>2] = $arrayidx196$i;
       }
       HEAP32[(32488)>>2] = $rsize$0$i;
       HEAP32[(32500)>>2] = $add$ptr$i;
      }
      $add$ptr225$i = ((($v$0$i)) + 8|0);
      $retval$0 = $add$ptr225$i;
      STACKTOP = sp;return ($retval$0|0);
     } else {
      $nb$0 = $cond;
     }
    }
   } else {
    $nb$0 = $cond;
   }
  } else {
   $cmp139 = ($bytes>>>0)>(4294967231);
   if ($cmp139) {
    $nb$0 = -1;
   } else {
    $add144 = (($bytes) + 11)|0;
    $and145 = $add144 & -8;
    $35 = HEAP32[(32484)>>2]|0;
    $cmp146 = ($35|0)==(0);
    if ($cmp146) {
     $nb$0 = $and145;
    } else {
     $sub$i147 = (0 - ($and145))|0;
     $shr$i148 = $add144 >>> 8;
     $cmp$i149 = ($shr$i148|0)==(0);
     if ($cmp$i149) {
      $idx$0$i = 0;
     } else {
      $cmp1$i = ($and145>>>0)>(16777215);
      if ($cmp1$i) {
       $idx$0$i = 31;
      } else {
       $sub4$i = (($shr$i148) + 1048320)|0;
       $shr5$i151 = $sub4$i >>> 16;
       $and$i152 = $shr5$i151 & 8;
       $shl$i153 = $shr$i148 << $and$i152;
       $sub6$i = (($shl$i153) + 520192)|0;
       $shr7$i154 = $sub6$i >>> 16;
       $and8$i = $shr7$i154 & 4;
       $add$i155 = $and8$i | $and$i152;
       $shl9$i = $shl$i153 << $and8$i;
       $sub10$i = (($shl9$i) + 245760)|0;
       $shr11$i156 = $sub10$i >>> 16;
       $and12$i = $shr11$i156 & 2;
       $add13$i = $add$i155 | $and12$i;
       $sub14$i = (14 - ($add13$i))|0;
       $shl15$i = $shl9$i << $and12$i;
       $shr16$i157 = $shl15$i >>> 15;
       $add17$i158 = (($sub14$i) + ($shr16$i157))|0;
       $shl18$i = $add17$i158 << 1;
       $add19$i = (($add17$i158) + 7)|0;
       $shr20$i = $and145 >>> $add19$i;
       $and21$i159 = $shr20$i & 1;
       $add22$i = $and21$i159 | $shl18$i;
       $idx$0$i = $add22$i;
      }
     }
     $arrayidx$i160 = (32784 + ($idx$0$i<<2)|0);
     $36 = HEAP32[$arrayidx$i160>>2]|0;
     $cmp24$i = ($36|0)==(0|0);
     L79: do {
      if ($cmp24$i) {
       $rsize$3$i = $sub$i147;$t$2$i = 0;$v$3$i = 0;
       label = 61;
      } else {
       $cmp26$i = ($idx$0$i|0)==(31);
       $shr27$i = $idx$0$i >>> 1;
       $sub30$i = (25 - ($shr27$i))|0;
       $cond$i = $cmp26$i ? 0 : $sub30$i;
       $shl31$i = $and145 << $cond$i;
       $rsize$0$i162 = $sub$i147;$rst$0$i = 0;$sizebits$0$i = $shl31$i;$t$0$i161 = $36;$v$0$i163 = 0;
       while(1) {
        $head$i164 = ((($t$0$i161)) + 4|0);
        $37 = HEAP32[$head$i164>>2]|0;
        $and32$i = $37 & -8;
        $sub33$i = (($and32$i) - ($and145))|0;
        $cmp34$i = ($sub33$i>>>0)<($rsize$0$i162>>>0);
        if ($cmp34$i) {
         $cmp36$i = ($sub33$i|0)==(0);
         if ($cmp36$i) {
          $rsize$418$i$ph = 0;$t$517$i$ph = $t$0$i161;$v$419$i$ph = $t$0$i161;
          label = 65;
          break L79;
         } else {
          $rsize$1$i = $sub33$i;$v$1$i = $t$0$i161;
         }
        } else {
         $rsize$1$i = $rsize$0$i162;$v$1$i = $v$0$i163;
        }
        $arrayidx40$i = ((($t$0$i161)) + 20|0);
        $38 = HEAP32[$arrayidx40$i>>2]|0;
        $shr42$i = $sizebits$0$i >>> 31;
        $arrayidx44$i = (((($t$0$i161)) + 16|0) + ($shr42$i<<2)|0);
        $39 = HEAP32[$arrayidx44$i>>2]|0;
        $cmp45$i = ($38|0)==(0|0);
        $cmp46$i = ($38|0)==($39|0);
        $or$cond1$i165 = $cmp45$i | $cmp46$i;
        $rst$1$i = $or$cond1$i165 ? $rst$0$i : $38;
        $cmp49$i = ($39|0)==(0|0);
        $spec$select5$i = $sizebits$0$i << 1;
        if ($cmp49$i) {
         $rsize$3$i = $rsize$1$i;$t$2$i = $rst$1$i;$v$3$i = $v$1$i;
         label = 61;
         break;
        } else {
         $rsize$0$i162 = $rsize$1$i;$rst$0$i = $rst$1$i;$sizebits$0$i = $spec$select5$i;$t$0$i161 = $39;$v$0$i163 = $v$1$i;
        }
       }
      }
     } while(0);
     if ((label|0) == 61) {
      $cmp55$i166 = ($t$2$i|0)==(0|0);
      $cmp57$i167 = ($v$3$i|0)==(0|0);
      $or$cond$i168 = $cmp55$i166 & $cmp57$i167;
      if ($or$cond$i168) {
       $shl60$i = 2 << $idx$0$i;
       $sub63$i = (0 - ($shl60$i))|0;
       $or$i169 = $shl60$i | $sub63$i;
       $and64$i = $or$i169 & $35;
       $cmp65$i = ($and64$i|0)==(0);
       if ($cmp65$i) {
        $nb$0 = $and145;
        break;
       }
       $sub67$i = (0 - ($and64$i))|0;
       $and68$i = $and64$i & $sub67$i;
       $sub70$i = (($and68$i) + -1)|0;
       $shr72$i = $sub70$i >>> 12;
       $and73$i = $shr72$i & 16;
       $shr75$i = $sub70$i >>> $and73$i;
       $shr76$i = $shr75$i >>> 5;
       $and77$i = $shr76$i & 8;
       $add78$i = $and77$i | $and73$i;
       $shr79$i = $shr75$i >>> $and77$i;
       $shr80$i = $shr79$i >>> 2;
       $and81$i = $shr80$i & 4;
       $add82$i = $add78$i | $and81$i;
       $shr83$i = $shr79$i >>> $and81$i;
       $shr84$i = $shr83$i >>> 1;
       $and85$i = $shr84$i & 2;
       $add86$i = $add82$i | $and85$i;
       $shr87$i = $shr83$i >>> $and85$i;
       $shr88$i = $shr87$i >>> 1;
       $and89$i = $shr88$i & 1;
       $add90$i = $add86$i | $and89$i;
       $shr91$i = $shr87$i >>> $and89$i;
       $add92$i = (($add90$i) + ($shr91$i))|0;
       $arrayidx94$i170 = (32784 + ($add92$i<<2)|0);
       $40 = HEAP32[$arrayidx94$i170>>2]|0;
       $t$4$i = $40;$v$3$i204 = 0;
      } else {
       $t$4$i = $t$2$i;$v$3$i204 = $v$3$i;
      }
      $cmp9716$i = ($t$4$i|0)==(0|0);
      if ($cmp9716$i) {
       $rsize$4$lcssa$i = $rsize$3$i;$v$4$lcssa$i = $v$3$i204;
      } else {
       $rsize$418$i$ph = $rsize$3$i;$t$517$i$ph = $t$4$i;$v$419$i$ph = $v$3$i204;
       label = 65;
      }
     }
     if ((label|0) == 65) {
      $rsize$418$i = $rsize$418$i$ph;$t$517$i = $t$517$i$ph;$v$419$i = $v$419$i$ph;
      while(1) {
       $head99$i = ((($t$517$i)) + 4|0);
       $41 = HEAP32[$head99$i>>2]|0;
       $and100$i = $41 & -8;
       $sub101$i = (($and100$i) - ($and145))|0;
       $cmp102$i = ($sub101$i>>>0)<($rsize$418$i>>>0);
       $spec$select$i171 = $cmp102$i ? $sub101$i : $rsize$418$i;
       $spec$select2$i = $cmp102$i ? $t$517$i : $v$419$i;
       $arrayidx106$i = ((($t$517$i)) + 16|0);
       $42 = HEAP32[$arrayidx106$i>>2]|0;
       $cmp107$i = ($42|0)==(0|0);
       if ($cmp107$i) {
        $arrayidx113$i173 = ((($t$517$i)) + 20|0);
        $43 = HEAP32[$arrayidx113$i173>>2]|0;
        $cond115$i = $43;
       } else {
        $cond115$i = $42;
       }
       $cmp97$i = ($cond115$i|0)==(0|0);
       if ($cmp97$i) {
        $rsize$4$lcssa$i = $spec$select$i171;$v$4$lcssa$i = $spec$select2$i;
        break;
       } else {
        $rsize$418$i = $spec$select$i171;$t$517$i = $cond115$i;$v$419$i = $spec$select2$i;
       }
      }
     }
     $cmp116$i = ($v$4$lcssa$i|0)==(0|0);
     if ($cmp116$i) {
      $nb$0 = $and145;
     } else {
      $44 = HEAP32[(32488)>>2]|0;
      $sub118$i = (($44) - ($and145))|0;
      $cmp119$i = ($rsize$4$lcssa$i>>>0)<($sub118$i>>>0);
      if ($cmp119$i) {
       $add$ptr$i174 = (($v$4$lcssa$i) + ($and145)|0);
       $cmp123$i = ($add$ptr$i174>>>0)>($v$4$lcssa$i>>>0);
       if ($cmp123$i) {
        $parent$i175 = ((($v$4$lcssa$i)) + 24|0);
        $45 = HEAP32[$parent$i175>>2]|0;
        $bk$i176 = ((($v$4$lcssa$i)) + 12|0);
        $46 = HEAP32[$bk$i176>>2]|0;
        $cmp128$i = ($46|0)==($v$4$lcssa$i|0);
        do {
         if ($cmp128$i) {
          $arrayidx151$i = ((($v$4$lcssa$i)) + 20|0);
          $48 = HEAP32[$arrayidx151$i>>2]|0;
          $cmp152$i = ($48|0)==(0|0);
          if ($cmp152$i) {
           $arrayidx155$i = ((($v$4$lcssa$i)) + 16|0);
           $49 = HEAP32[$arrayidx155$i>>2]|0;
           $cmp156$i = ($49|0)==(0|0);
           if ($cmp156$i) {
            $R$3$i188 = 0;
            break;
           } else {
            $R$1$i183$ph = $49;$RP$1$i182$ph = $arrayidx155$i;
           }
          } else {
           $R$1$i183$ph = $48;$RP$1$i182$ph = $arrayidx151$i;
          }
          $R$1$i183 = $R$1$i183$ph;$RP$1$i182 = $RP$1$i182$ph;
          while(1) {
           $arrayidx161$i = ((($R$1$i183)) + 20|0);
           $50 = HEAP32[$arrayidx161$i>>2]|0;
           $cmp162$i184 = ($50|0)==(0|0);
           if ($cmp162$i184) {
            $arrayidx165$i185 = ((($R$1$i183)) + 16|0);
            $51 = HEAP32[$arrayidx165$i185>>2]|0;
            $cmp166$i = ($51|0)==(0|0);
            if ($cmp166$i) {
             break;
            } else {
             $R$1$i183$be = $51;$RP$1$i182$be = $arrayidx165$i185;
            }
           } else {
            $R$1$i183$be = $50;$RP$1$i182$be = $arrayidx161$i;
           }
           $R$1$i183 = $R$1$i183$be;$RP$1$i182 = $RP$1$i182$be;
          }
          HEAP32[$RP$1$i182>>2] = 0;
          $R$3$i188 = $R$1$i183;
         } else {
          $fd$i177 = ((($v$4$lcssa$i)) + 8|0);
          $47 = HEAP32[$fd$i177>>2]|0;
          $bk145$i = ((($47)) + 12|0);
          HEAP32[$bk145$i>>2] = $46;
          $fd146$i = ((($46)) + 8|0);
          HEAP32[$fd146$i>>2] = $47;
          $R$3$i188 = $46;
         }
        } while(0);
        $cmp180$i = ($45|0)==(0|0);
        do {
         if ($cmp180$i) {
          $61 = $35;
         } else {
          $index$i189 = ((($v$4$lcssa$i)) + 28|0);
          $52 = HEAP32[$index$i189>>2]|0;
          $arrayidx184$i = (32784 + ($52<<2)|0);
          $53 = HEAP32[$arrayidx184$i>>2]|0;
          $cmp185$i = ($v$4$lcssa$i|0)==($53|0);
          if ($cmp185$i) {
           HEAP32[$arrayidx184$i>>2] = $R$3$i188;
           $cond3$i = ($R$3$i188|0)==(0|0);
           if ($cond3$i) {
            $shl192$i = 1 << $52;
            $neg$i190 = $shl192$i ^ -1;
            $and194$i191 = $35 & $neg$i190;
            HEAP32[(32484)>>2] = $and194$i191;
            $61 = $and194$i191;
            break;
           }
          } else {
           $arrayidx204$i = ((($45)) + 16|0);
           $54 = HEAP32[$arrayidx204$i>>2]|0;
           $cmp205$i = ($54|0)==($v$4$lcssa$i|0);
           $arrayidx212$i = ((($45)) + 20|0);
           $arrayidx212$i$sink = $cmp205$i ? $arrayidx204$i : $arrayidx212$i;
           HEAP32[$arrayidx212$i$sink>>2] = $R$3$i188;
           $cmp217$i = ($R$3$i188|0)==(0|0);
           if ($cmp217$i) {
            $61 = $35;
            break;
           }
          }
          $parent226$i = ((($R$3$i188)) + 24|0);
          HEAP32[$parent226$i>>2] = $45;
          $arrayidx228$i = ((($v$4$lcssa$i)) + 16|0);
          $55 = HEAP32[$arrayidx228$i>>2]|0;
          $cmp229$i = ($55|0)==(0|0);
          if (!($cmp229$i)) {
           $arrayidx239$i = ((($R$3$i188)) + 16|0);
           HEAP32[$arrayidx239$i>>2] = $55;
           $parent240$i = ((($55)) + 24|0);
           HEAP32[$parent240$i>>2] = $R$3$i188;
          }
          $arrayidx245$i = ((($v$4$lcssa$i)) + 20|0);
          $56 = HEAP32[$arrayidx245$i>>2]|0;
          $cmp246$i = ($56|0)==(0|0);
          if ($cmp246$i) {
           $61 = $35;
          } else {
           $arrayidx256$i = ((($R$3$i188)) + 20|0);
           HEAP32[$arrayidx256$i>>2] = $56;
           $parent257$i = ((($56)) + 24|0);
           HEAP32[$parent257$i>>2] = $R$3$i188;
           $61 = $35;
          }
         }
        } while(0);
        $cmp265$i = ($rsize$4$lcssa$i>>>0)<(16);
        L128: do {
         if ($cmp265$i) {
          $add268$i = (($rsize$4$lcssa$i) + ($and145))|0;
          $or270$i = $add268$i | 3;
          $head271$i = ((($v$4$lcssa$i)) + 4|0);
          HEAP32[$head271$i>>2] = $or270$i;
          $add$ptr273$i = (($v$4$lcssa$i) + ($add268$i)|0);
          $head274$i = ((($add$ptr273$i)) + 4|0);
          $57 = HEAP32[$head274$i>>2]|0;
          $or275$i = $57 | 1;
          HEAP32[$head274$i>>2] = $or275$i;
         } else {
          $or278$i = $and145 | 3;
          $head279$i = ((($v$4$lcssa$i)) + 4|0);
          HEAP32[$head279$i>>2] = $or278$i;
          $or280$i = $rsize$4$lcssa$i | 1;
          $head281$i = ((($add$ptr$i174)) + 4|0);
          HEAP32[$head281$i>>2] = $or280$i;
          $add$ptr282$i = (($add$ptr$i174) + ($rsize$4$lcssa$i)|0);
          HEAP32[$add$ptr282$i>>2] = $rsize$4$lcssa$i;
          $shr283$i = $rsize$4$lcssa$i >>> 3;
          $cmp284$i = ($rsize$4$lcssa$i>>>0)<(256);
          if ($cmp284$i) {
           $shl288$i = $shr283$i << 1;
           $arrayidx289$i = (32520 + ($shl288$i<<2)|0);
           $58 = HEAP32[8120]|0;
           $shl291$i = 1 << $shr283$i;
           $and292$i = $58 & $shl291$i;
           $tobool293$i = ($and292$i|0)==(0);
           if ($tobool293$i) {
            $or297$i = $58 | $shl291$i;
            HEAP32[8120] = $or297$i;
            $$pre$i194 = ((($arrayidx289$i)) + 8|0);
            $$pre$phi$i195Z2D = $$pre$i194;$F290$0$i = $arrayidx289$i;
           } else {
            $59 = ((($arrayidx289$i)) + 8|0);
            $60 = HEAP32[$59>>2]|0;
            $$pre$phi$i195Z2D = $59;$F290$0$i = $60;
           }
           HEAP32[$$pre$phi$i195Z2D>>2] = $add$ptr$i174;
           $bk311$i = ((($F290$0$i)) + 12|0);
           HEAP32[$bk311$i>>2] = $add$ptr$i174;
           $fd312$i = ((($add$ptr$i174)) + 8|0);
           HEAP32[$fd312$i>>2] = $F290$0$i;
           $bk313$i = ((($add$ptr$i174)) + 12|0);
           HEAP32[$bk313$i>>2] = $arrayidx289$i;
           break;
          }
          $shr318$i = $rsize$4$lcssa$i >>> 8;
          $cmp319$i = ($shr318$i|0)==(0);
          if ($cmp319$i) {
           $I316$0$i = 0;
          } else {
           $cmp323$i = ($rsize$4$lcssa$i>>>0)>(16777215);
           if ($cmp323$i) {
            $I316$0$i = 31;
           } else {
            $sub329$i = (($shr318$i) + 1048320)|0;
            $shr330$i = $sub329$i >>> 16;
            $and331$i = $shr330$i & 8;
            $shl333$i = $shr318$i << $and331$i;
            $sub334$i = (($shl333$i) + 520192)|0;
            $shr335$i = $sub334$i >>> 16;
            $and336$i = $shr335$i & 4;
            $add337$i = $and336$i | $and331$i;
            $shl338$i = $shl333$i << $and336$i;
            $sub339$i = (($shl338$i) + 245760)|0;
            $shr340$i = $sub339$i >>> 16;
            $and341$i = $shr340$i & 2;
            $add342$i = $add337$i | $and341$i;
            $sub343$i = (14 - ($add342$i))|0;
            $shl344$i = $shl338$i << $and341$i;
            $shr345$i = $shl344$i >>> 15;
            $add346$i = (($sub343$i) + ($shr345$i))|0;
            $shl347$i = $add346$i << 1;
            $add348$i = (($add346$i) + 7)|0;
            $shr349$i = $rsize$4$lcssa$i >>> $add348$i;
            $and350$i = $shr349$i & 1;
            $add351$i = $and350$i | $shl347$i;
            $I316$0$i = $add351$i;
           }
          }
          $arrayidx355$i = (32784 + ($I316$0$i<<2)|0);
          $index356$i = ((($add$ptr$i174)) + 28|0);
          HEAP32[$index356$i>>2] = $I316$0$i;
          $child357$i = ((($add$ptr$i174)) + 16|0);
          $arrayidx358$i = ((($child357$i)) + 4|0);
          HEAP32[$arrayidx358$i>>2] = 0;
          HEAP32[$child357$i>>2] = 0;
          $shl362$i = 1 << $I316$0$i;
          $and363$i = $61 & $shl362$i;
          $tobool364$i = ($and363$i|0)==(0);
          if ($tobool364$i) {
           $or368$i = $61 | $shl362$i;
           HEAP32[(32484)>>2] = $or368$i;
           HEAP32[$arrayidx355$i>>2] = $add$ptr$i174;
           $parent369$i = ((($add$ptr$i174)) + 24|0);
           HEAP32[$parent369$i>>2] = $arrayidx355$i;
           $bk370$i = ((($add$ptr$i174)) + 12|0);
           HEAP32[$bk370$i>>2] = $add$ptr$i174;
           $fd371$i = ((($add$ptr$i174)) + 8|0);
           HEAP32[$fd371$i>>2] = $add$ptr$i174;
           break;
          }
          $62 = HEAP32[$arrayidx355$i>>2]|0;
          $head38611$i = ((($62)) + 4|0);
          $63 = HEAP32[$head38611$i>>2]|0;
          $and38712$i = $63 & -8;
          $cmp38813$i = ($and38712$i|0)==($rsize$4$lcssa$i|0);
          L145: do {
           if ($cmp38813$i) {
            $T$0$lcssa$i = $62;
           } else {
            $cmp374$i = ($I316$0$i|0)==(31);
            $shr378$i = $I316$0$i >>> 1;
            $sub381$i = (25 - ($shr378$i))|0;
            $cond383$i = $cmp374$i ? 0 : $sub381$i;
            $shl384$i = $rsize$4$lcssa$i << $cond383$i;
            $K373$015$i = $shl384$i;$T$014$i = $62;
            while(1) {
             $shr392$i = $K373$015$i >>> 31;
             $arrayidx394$i = (((($T$014$i)) + 16|0) + ($shr392$i<<2)|0);
             $64 = HEAP32[$arrayidx394$i>>2]|0;
             $cmp396$i = ($64|0)==(0|0);
             if ($cmp396$i) {
              break;
             }
             $shl395$i = $K373$015$i << 1;
             $head386$i = ((($64)) + 4|0);
             $65 = HEAP32[$head386$i>>2]|0;
             $and387$i = $65 & -8;
             $cmp388$i = ($and387$i|0)==($rsize$4$lcssa$i|0);
             if ($cmp388$i) {
              $T$0$lcssa$i = $64;
              break L145;
             } else {
              $K373$015$i = $shl395$i;$T$014$i = $64;
             }
            }
            HEAP32[$arrayidx394$i>>2] = $add$ptr$i174;
            $parent406$i = ((($add$ptr$i174)) + 24|0);
            HEAP32[$parent406$i>>2] = $T$014$i;
            $bk407$i = ((($add$ptr$i174)) + 12|0);
            HEAP32[$bk407$i>>2] = $add$ptr$i174;
            $fd408$i = ((($add$ptr$i174)) + 8|0);
            HEAP32[$fd408$i>>2] = $add$ptr$i174;
            break L128;
           }
          } while(0);
          $fd416$i = ((($T$0$lcssa$i)) + 8|0);
          $66 = HEAP32[$fd416$i>>2]|0;
          $bk429$i = ((($66)) + 12|0);
          HEAP32[$bk429$i>>2] = $add$ptr$i174;
          HEAP32[$fd416$i>>2] = $add$ptr$i174;
          $fd431$i = ((($add$ptr$i174)) + 8|0);
          HEAP32[$fd431$i>>2] = $66;
          $bk432$i = ((($add$ptr$i174)) + 12|0);
          HEAP32[$bk432$i>>2] = $T$0$lcssa$i;
          $parent433$i = ((($add$ptr$i174)) + 24|0);
          HEAP32[$parent433$i>>2] = 0;
         }
        } while(0);
        $add$ptr441$i = ((($v$4$lcssa$i)) + 8|0);
        $retval$0 = $add$ptr441$i;
        STACKTOP = sp;return ($retval$0|0);
       } else {
        $nb$0 = $and145;
       }
      } else {
       $nb$0 = $and145;
      }
     }
    }
   }
  }
 } while(0);
 $67 = HEAP32[(32488)>>2]|0;
 $cmp156 = ($67>>>0)<($nb$0>>>0);
 if (!($cmp156)) {
  $sub160 = (($67) - ($nb$0))|0;
  $68 = HEAP32[(32500)>>2]|0;
  $cmp162 = ($sub160>>>0)>(15);
  if ($cmp162) {
   $add$ptr166 = (($68) + ($nb$0)|0);
   HEAP32[(32500)>>2] = $add$ptr166;
   HEAP32[(32488)>>2] = $sub160;
   $or167 = $sub160 | 1;
   $head168 = ((($add$ptr166)) + 4|0);
   HEAP32[$head168>>2] = $or167;
   $add$ptr169 = (($68) + ($67)|0);
   HEAP32[$add$ptr169>>2] = $sub160;
   $or172 = $nb$0 | 3;
   $head173 = ((($68)) + 4|0);
   HEAP32[$head173>>2] = $or172;
  } else {
   HEAP32[(32488)>>2] = 0;
   HEAP32[(32500)>>2] = 0;
   $or176 = $67 | 3;
   $head177 = ((($68)) + 4|0);
   HEAP32[$head177>>2] = $or176;
   $add$ptr178 = (($68) + ($67)|0);
   $head179 = ((($add$ptr178)) + 4|0);
   $69 = HEAP32[$head179>>2]|0;
   $or180 = $69 | 1;
   HEAP32[$head179>>2] = $or180;
  }
  $add$ptr182 = ((($68)) + 8|0);
  $retval$0 = $add$ptr182;
  STACKTOP = sp;return ($retval$0|0);
 }
 $70 = HEAP32[(32492)>>2]|0;
 $cmp186 = ($70>>>0)>($nb$0>>>0);
 if ($cmp186) {
  $sub190 = (($70) - ($nb$0))|0;
  HEAP32[(32492)>>2] = $sub190;
  $71 = HEAP32[(32504)>>2]|0;
  $add$ptr193 = (($71) + ($nb$0)|0);
  HEAP32[(32504)>>2] = $add$ptr193;
  $or194 = $sub190 | 1;
  $head195 = ((($add$ptr193)) + 4|0);
  HEAP32[$head195>>2] = $or194;
  $or197 = $nb$0 | 3;
  $head198 = ((($71)) + 4|0);
  HEAP32[$head198>>2] = $or197;
  $add$ptr199 = ((($71)) + 8|0);
  $retval$0 = $add$ptr199;
  STACKTOP = sp;return ($retval$0|0);
 }
 $72 = HEAP32[8238]|0;
 $cmp$i133 = ($72|0)==(0);
 if ($cmp$i133) {
  HEAP32[(32960)>>2] = 4096;
  HEAP32[(32956)>>2] = 4096;
  HEAP32[(32964)>>2] = -1;
  HEAP32[(32968)>>2] = -1;
  HEAP32[(32972)>>2] = 0;
  HEAP32[(32924)>>2] = 0;
  $73 = $magic$i$i;
  $xor$i$i = $73 & -16;
  $and6$i$i = $xor$i$i ^ 1431655768;
  HEAP32[8238] = $and6$i$i;
  $74 = 4096;
 } else {
  $$pre$i134 = HEAP32[(32960)>>2]|0;
  $74 = $$pre$i134;
 }
 $add$i135 = (($nb$0) + 48)|0;
 $sub$i136 = (($nb$0) + 47)|0;
 $add9$i = (($74) + ($sub$i136))|0;
 $neg$i137 = (0 - ($74))|0;
 $and11$i = $add9$i & $neg$i137;
 $cmp12$i = ($and11$i>>>0)>($nb$0>>>0);
 if (!($cmp12$i)) {
  $retval$0 = 0;
  STACKTOP = sp;return ($retval$0|0);
 }
 $75 = HEAP32[(32920)>>2]|0;
 $cmp15$i = ($75|0)==(0);
 if (!($cmp15$i)) {
  $76 = HEAP32[(32912)>>2]|0;
  $add17$i = (($76) + ($and11$i))|0;
  $cmp19$i = ($add17$i>>>0)<=($76>>>0);
  $cmp21$i = ($add17$i>>>0)>($75>>>0);
  $or$cond1$i = $cmp19$i | $cmp21$i;
  if ($or$cond1$i) {
   $retval$0 = 0;
   STACKTOP = sp;return ($retval$0|0);
  }
 }
 $77 = HEAP32[(32924)>>2]|0;
 $and29$i = $77 & 4;
 $tobool30$i = ($and29$i|0)==(0);
 L178: do {
  if ($tobool30$i) {
   $78 = HEAP32[(32504)>>2]|0;
   $cmp32$i138 = ($78|0)==(0|0);
   L180: do {
    if ($cmp32$i138) {
     label = 128;
    } else {
     $sp$0$i$i = (32928);
     while(1) {
      $79 = HEAP32[$sp$0$i$i>>2]|0;
      $cmp$i55$i = ($79>>>0)>($78>>>0);
      if (!($cmp$i55$i)) {
       $size$i$i = ((($sp$0$i$i)) + 4|0);
       $80 = HEAP32[$size$i$i>>2]|0;
       $add$ptr$i57$i = (($79) + ($80)|0);
       $cmp2$i$i = ($add$ptr$i57$i>>>0)>($78>>>0);
       if ($cmp2$i$i) {
        break;
       }
      }
      $next$i$i = ((($sp$0$i$i)) + 8|0);
      $81 = HEAP32[$next$i$i>>2]|0;
      $cmp3$i$i = ($81|0)==(0|0);
      if ($cmp3$i$i) {
       label = 128;
       break L180;
      } else {
       $sp$0$i$i = $81;
      }
     }
     $add77$i = (($add9$i) - ($70))|0;
     $and80$i = $add77$i & $neg$i137;
     $cmp81$i = ($and80$i>>>0)<(2147483647);
     if ($cmp81$i) {
      $size$i$i$le = ((($sp$0$i$i)) + 4|0);
      $call83$i = (_sbrk(($and80$i|0))|0);
      $86 = HEAP32[$sp$0$i$i>>2]|0;
      $87 = HEAP32[$size$i$i$le>>2]|0;
      $add$ptr$i141 = (($86) + ($87)|0);
      $cmp85$i = ($call83$i|0)==($add$ptr$i141|0);
      if ($cmp85$i) {
       $cmp89$i = ($call83$i|0)==((-1)|0);
       if ($cmp89$i) {
        $tsize$2647482$i = $and80$i;
       } else {
        $tbase$795$i = $call83$i;$tsize$794$i = $and80$i;
        label = 145;
        break L178;
       }
      } else {
       $br$2$ph$i = $call83$i;$ssize$2$ph$i = $and80$i;
       label = 136;
      }
     } else {
      $tsize$2647482$i = 0;
     }
    }
   } while(0);
   do {
    if ((label|0) == 128) {
     $call37$i = (_sbrk(0)|0);
     $cmp38$i = ($call37$i|0)==((-1)|0);
     if ($cmp38$i) {
      $tsize$2647482$i = 0;
     } else {
      $82 = $call37$i;
      $83 = HEAP32[(32956)>>2]|0;
      $sub41$i = (($83) + -1)|0;
      $and42$i = $sub41$i & $82;
      $cmp43$i = ($and42$i|0)==(0);
      $add46$i = (($sub41$i) + ($82))|0;
      $neg48$i = (0 - ($83))|0;
      $and49$i = $add46$i & $neg48$i;
      $sub50$i = (($and49$i) - ($82))|0;
      $add51$i = $cmp43$i ? 0 : $sub50$i;
      $spec$select96$i = (($add51$i) + ($and11$i))|0;
      $84 = HEAP32[(32912)>>2]|0;
      $add54$i = (($spec$select96$i) + ($84))|0;
      $cmp55$i = ($spec$select96$i>>>0)>($nb$0>>>0);
      $cmp57$i = ($spec$select96$i>>>0)<(2147483647);
      $or$cond$i = $cmp55$i & $cmp57$i;
      if ($or$cond$i) {
       $85 = HEAP32[(32920)>>2]|0;
       $cmp60$i = ($85|0)==(0);
       if (!($cmp60$i)) {
        $cmp63$i = ($add54$i>>>0)<=($84>>>0);
        $cmp66$i140 = ($add54$i>>>0)>($85>>>0);
        $or$cond2$i = $cmp63$i | $cmp66$i140;
        if ($or$cond2$i) {
         $tsize$2647482$i = 0;
         break;
        }
       }
       $call68$i = (_sbrk(($spec$select96$i|0))|0);
       $cmp69$i = ($call68$i|0)==($call37$i|0);
       if ($cmp69$i) {
        $tbase$795$i = $call37$i;$tsize$794$i = $spec$select96$i;
        label = 145;
        break L178;
       } else {
        $br$2$ph$i = $call68$i;$ssize$2$ph$i = $spec$select96$i;
        label = 136;
       }
      } else {
       $tsize$2647482$i = 0;
      }
     }
    }
   } while(0);
   do {
    if ((label|0) == 136) {
     $sub112$i = (0 - ($ssize$2$ph$i))|0;
     $cmp91$i = ($br$2$ph$i|0)!=((-1)|0);
     $cmp93$i = ($ssize$2$ph$i>>>0)<(2147483647);
     $or$cond5$i = $cmp93$i & $cmp91$i;
     $cmp96$i = ($add$i135>>>0)>($ssize$2$ph$i>>>0);
     $or$cond7$i = $cmp96$i & $or$cond5$i;
     if (!($or$cond7$i)) {
      $cmp118$i = ($br$2$ph$i|0)==((-1)|0);
      if ($cmp118$i) {
       $tsize$2647482$i = 0;
       break;
      } else {
       $tbase$795$i = $br$2$ph$i;$tsize$794$i = $ssize$2$ph$i;
       label = 145;
       break L178;
      }
     }
     $88 = HEAP32[(32960)>>2]|0;
     $sub99$i = (($sub$i136) - ($ssize$2$ph$i))|0;
     $add101$i = (($sub99$i) + ($88))|0;
     $neg103$i = (0 - ($88))|0;
     $and104$i = $add101$i & $neg103$i;
     $cmp105$i = ($and104$i>>>0)<(2147483647);
     if (!($cmp105$i)) {
      $tbase$795$i = $br$2$ph$i;$tsize$794$i = $ssize$2$ph$i;
      label = 145;
      break L178;
     }
     $call107$i = (_sbrk(($and104$i|0))|0);
     $cmp108$i = ($call107$i|0)==((-1)|0);
     if ($cmp108$i) {
      (_sbrk(($sub112$i|0))|0);
      $tsize$2647482$i = 0;
      break;
     } else {
      $add110$i = (($and104$i) + ($ssize$2$ph$i))|0;
      $tbase$795$i = $br$2$ph$i;$tsize$794$i = $add110$i;
      label = 145;
      break L178;
     }
    }
   } while(0);
   $89 = HEAP32[(32924)>>2]|0;
   $or$i = $89 | 4;
   HEAP32[(32924)>>2] = $or$i;
   $tsize$4$i = $tsize$2647482$i;
   label = 143;
  } else {
   $tsize$4$i = 0;
   label = 143;
  }
 } while(0);
 if ((label|0) == 143) {
  $cmp127$i = ($and11$i>>>0)<(2147483647);
  if ($cmp127$i) {
   $call131$i = (_sbrk(($and11$i|0))|0);
   $call132$i = (_sbrk(0)|0);
   $cmp133$i = ($call131$i|0)!=((-1)|0);
   $cmp135$i = ($call132$i|0)!=((-1)|0);
   $or$cond4$i = $cmp133$i & $cmp135$i;
   $cmp137$i = ($call131$i>>>0)<($call132$i>>>0);
   $or$cond8$i = $cmp137$i & $or$cond4$i;
   $sub$ptr$lhs$cast$i = $call132$i;
   $sub$ptr$rhs$cast$i = $call131$i;
   $sub$ptr$sub$i = (($sub$ptr$lhs$cast$i) - ($sub$ptr$rhs$cast$i))|0;
   $add140$i = (($nb$0) + 40)|0;
   $cmp141$i = ($sub$ptr$sub$i>>>0)>($add140$i>>>0);
   $spec$select9$i = $cmp141$i ? $sub$ptr$sub$i : $tsize$4$i;
   $or$cond8$not$i = $or$cond8$i ^ 1;
   $cmp14799$i = ($call131$i|0)==((-1)|0);
   $not$cmp141$i = $cmp141$i ^ 1;
   $cmp147$i = $cmp14799$i | $not$cmp141$i;
   $or$cond97$i = $cmp147$i | $or$cond8$not$i;
   if (!($or$cond97$i)) {
    $tbase$795$i = $call131$i;$tsize$794$i = $spec$select9$i;
    label = 145;
   }
  }
 }
 if ((label|0) == 145) {
  $90 = HEAP32[(32912)>>2]|0;
  $add150$i = (($90) + ($tsize$794$i))|0;
  HEAP32[(32912)>>2] = $add150$i;
  $91 = HEAP32[(32916)>>2]|0;
  $cmp151$i = ($add150$i>>>0)>($91>>>0);
  if ($cmp151$i) {
   HEAP32[(32916)>>2] = $add150$i;
  }
  $92 = HEAP32[(32504)>>2]|0;
  $cmp157$i = ($92|0)==(0|0);
  L215: do {
   if ($cmp157$i) {
    $93 = HEAP32[(32496)>>2]|0;
    $cmp159$i = ($93|0)==(0|0);
    $cmp162$i = ($tbase$795$i>>>0)<($93>>>0);
    $or$cond11$i = $cmp159$i | $cmp162$i;
    if ($or$cond11$i) {
     HEAP32[(32496)>>2] = $tbase$795$i;
    }
    HEAP32[(32928)>>2] = $tbase$795$i;
    HEAP32[(32932)>>2] = $tsize$794$i;
    HEAP32[(32940)>>2] = 0;
    $94 = HEAP32[8238]|0;
    HEAP32[(32516)>>2] = $94;
    HEAP32[(32512)>>2] = -1;
    HEAP32[(32532)>>2] = (32520);
    HEAP32[(32528)>>2] = (32520);
    HEAP32[(32540)>>2] = (32528);
    HEAP32[(32536)>>2] = (32528);
    HEAP32[(32548)>>2] = (32536);
    HEAP32[(32544)>>2] = (32536);
    HEAP32[(32556)>>2] = (32544);
    HEAP32[(32552)>>2] = (32544);
    HEAP32[(32564)>>2] = (32552);
    HEAP32[(32560)>>2] = (32552);
    HEAP32[(32572)>>2] = (32560);
    HEAP32[(32568)>>2] = (32560);
    HEAP32[(32580)>>2] = (32568);
    HEAP32[(32576)>>2] = (32568);
    HEAP32[(32588)>>2] = (32576);
    HEAP32[(32584)>>2] = (32576);
    HEAP32[(32596)>>2] = (32584);
    HEAP32[(32592)>>2] = (32584);
    HEAP32[(32604)>>2] = (32592);
    HEAP32[(32600)>>2] = (32592);
    HEAP32[(32612)>>2] = (32600);
    HEAP32[(32608)>>2] = (32600);
    HEAP32[(32620)>>2] = (32608);
    HEAP32[(32616)>>2] = (32608);
    HEAP32[(32628)>>2] = (32616);
    HEAP32[(32624)>>2] = (32616);
    HEAP32[(32636)>>2] = (32624);
    HEAP32[(32632)>>2] = (32624);
    HEAP32[(32644)>>2] = (32632);
    HEAP32[(32640)>>2] = (32632);
    HEAP32[(32652)>>2] = (32640);
    HEAP32[(32648)>>2] = (32640);
    HEAP32[(32660)>>2] = (32648);
    HEAP32[(32656)>>2] = (32648);
    HEAP32[(32668)>>2] = (32656);
    HEAP32[(32664)>>2] = (32656);
    HEAP32[(32676)>>2] = (32664);
    HEAP32[(32672)>>2] = (32664);
    HEAP32[(32684)>>2] = (32672);
    HEAP32[(32680)>>2] = (32672);
    HEAP32[(32692)>>2] = (32680);
    HEAP32[(32688)>>2] = (32680);
    HEAP32[(32700)>>2] = (32688);
    HEAP32[(32696)>>2] = (32688);
    HEAP32[(32708)>>2] = (32696);
    HEAP32[(32704)>>2] = (32696);
    HEAP32[(32716)>>2] = (32704);
    HEAP32[(32712)>>2] = (32704);
    HEAP32[(32724)>>2] = (32712);
    HEAP32[(32720)>>2] = (32712);
    HEAP32[(32732)>>2] = (32720);
    HEAP32[(32728)>>2] = (32720);
    HEAP32[(32740)>>2] = (32728);
    HEAP32[(32736)>>2] = (32728);
    HEAP32[(32748)>>2] = (32736);
    HEAP32[(32744)>>2] = (32736);
    HEAP32[(32756)>>2] = (32744);
    HEAP32[(32752)>>2] = (32744);
    HEAP32[(32764)>>2] = (32752);
    HEAP32[(32760)>>2] = (32752);
    HEAP32[(32772)>>2] = (32760);
    HEAP32[(32768)>>2] = (32760);
    HEAP32[(32780)>>2] = (32768);
    HEAP32[(32776)>>2] = (32768);
    $sub172$i = (($tsize$794$i) + -40)|0;
    $add$ptr$i43$i = ((($tbase$795$i)) + 8|0);
    $95 = $add$ptr$i43$i;
    $and$i44$i = $95 & 7;
    $cmp$i45$i = ($and$i44$i|0)==(0);
    $sub$i46$i = (0 - ($95))|0;
    $and3$i47$i = $sub$i46$i & 7;
    $cond$i48$i = $cmp$i45$i ? 0 : $and3$i47$i;
    $add$ptr4$i49$i = (($tbase$795$i) + ($cond$i48$i)|0);
    $sub5$i50$i = (($sub172$i) - ($cond$i48$i))|0;
    HEAP32[(32504)>>2] = $add$ptr4$i49$i;
    HEAP32[(32492)>>2] = $sub5$i50$i;
    $or$i51$i = $sub5$i50$i | 1;
    $head$i52$i = ((($add$ptr4$i49$i)) + 4|0);
    HEAP32[$head$i52$i>>2] = $or$i51$i;
    $add$ptr6$i53$i = (($tbase$795$i) + ($sub172$i)|0);
    $head7$i54$i = ((($add$ptr6$i53$i)) + 4|0);
    HEAP32[$head7$i54$i>>2] = 40;
    $96 = HEAP32[(32968)>>2]|0;
    HEAP32[(32508)>>2] = $96;
   } else {
    $sp$0112$i = (32928);
    while(1) {
     $97 = HEAP32[$sp$0112$i>>2]|0;
     $size188$i = ((($sp$0112$i)) + 4|0);
     $98 = HEAP32[$size188$i>>2]|0;
     $add$ptr189$i = (($97) + ($98)|0);
     $cmp190$i = ($tbase$795$i|0)==($add$ptr189$i|0);
     if ($cmp190$i) {
      label = 154;
      break;
     }
     $next$i = ((($sp$0112$i)) + 8|0);
     $99 = HEAP32[$next$i>>2]|0;
     $cmp186$i = ($99|0)==(0|0);
     if ($cmp186$i) {
      break;
     } else {
      $sp$0112$i = $99;
     }
    }
    if ((label|0) == 154) {
     $size188$i$le = ((($sp$0112$i)) + 4|0);
     $sflags193$i = ((($sp$0112$i)) + 12|0);
     $100 = HEAP32[$sflags193$i>>2]|0;
     $and194$i = $100 & 8;
     $tobool195$i = ($and194$i|0)==(0);
     if ($tobool195$i) {
      $cmp203$i = ($97>>>0)<=($92>>>0);
      $cmp209$i = ($tbase$795$i>>>0)>($92>>>0);
      $or$cond98$i = $cmp209$i & $cmp203$i;
      if ($or$cond98$i) {
       $add212$i = (($98) + ($tsize$794$i))|0;
       HEAP32[$size188$i$le>>2] = $add212$i;
       $101 = HEAP32[(32492)>>2]|0;
       $add215$i = (($101) + ($tsize$794$i))|0;
       $add$ptr$i35$i = ((($92)) + 8|0);
       $102 = $add$ptr$i35$i;
       $and$i36$i = $102 & 7;
       $cmp$i37$i = ($and$i36$i|0)==(0);
       $sub$i38$i = (0 - ($102))|0;
       $and3$i39$i = $sub$i38$i & 7;
       $cond$i40$i = $cmp$i37$i ? 0 : $and3$i39$i;
       $add$ptr4$i41$i = (($92) + ($cond$i40$i)|0);
       $sub5$i$i = (($add215$i) - ($cond$i40$i))|0;
       HEAP32[(32504)>>2] = $add$ptr4$i41$i;
       HEAP32[(32492)>>2] = $sub5$i$i;
       $or$i$i = $sub5$i$i | 1;
       $head$i42$i = ((($add$ptr4$i41$i)) + 4|0);
       HEAP32[$head$i42$i>>2] = $or$i$i;
       $add$ptr6$i$i = (($92) + ($add215$i)|0);
       $head7$i$i = ((($add$ptr6$i$i)) + 4|0);
       HEAP32[$head7$i$i>>2] = 40;
       $103 = HEAP32[(32968)>>2]|0;
       HEAP32[(32508)>>2] = $103;
       break;
      }
     }
    }
    $104 = HEAP32[(32496)>>2]|0;
    $cmp218$i = ($tbase$795$i>>>0)<($104>>>0);
    if ($cmp218$i) {
     HEAP32[(32496)>>2] = $tbase$795$i;
    }
    $add$ptr227$i = (($tbase$795$i) + ($tsize$794$i)|0);
    $sp$1111$i = (32928);
    while(1) {
     $105 = HEAP32[$sp$1111$i>>2]|0;
     $cmp228$i = ($105|0)==($add$ptr227$i|0);
     if ($cmp228$i) {
      label = 162;
      break;
     }
     $next231$i = ((($sp$1111$i)) + 8|0);
     $106 = HEAP32[$next231$i>>2]|0;
     $cmp224$i = ($106|0)==(0|0);
     if ($cmp224$i) {
      break;
     } else {
      $sp$1111$i = $106;
     }
    }
    if ((label|0) == 162) {
     $sflags235$i = ((($sp$1111$i)) + 12|0);
     $107 = HEAP32[$sflags235$i>>2]|0;
     $and236$i = $107 & 8;
     $tobool237$i = ($and236$i|0)==(0);
     if ($tobool237$i) {
      HEAP32[$sp$1111$i>>2] = $tbase$795$i;
      $size245$i = ((($sp$1111$i)) + 4|0);
      $108 = HEAP32[$size245$i>>2]|0;
      $add246$i = (($108) + ($tsize$794$i))|0;
      HEAP32[$size245$i>>2] = $add246$i;
      $add$ptr$i$i = ((($tbase$795$i)) + 8|0);
      $109 = $add$ptr$i$i;
      $and$i14$i = $109 & 7;
      $cmp$i15$i = ($and$i14$i|0)==(0);
      $sub$i16$i = (0 - ($109))|0;
      $and3$i$i = $sub$i16$i & 7;
      $cond$i17$i = $cmp$i15$i ? 0 : $and3$i$i;
      $add$ptr4$i$i = (($tbase$795$i) + ($cond$i17$i)|0);
      $add$ptr5$i$i = ((($add$ptr227$i)) + 8|0);
      $110 = $add$ptr5$i$i;
      $and6$i18$i = $110 & 7;
      $cmp7$i$i = ($and6$i18$i|0)==(0);
      $sub12$i$i = (0 - ($110))|0;
      $and13$i$i = $sub12$i$i & 7;
      $cond15$i$i = $cmp7$i$i ? 0 : $and13$i$i;
      $add$ptr16$i$i = (($add$ptr227$i) + ($cond15$i$i)|0);
      $sub$ptr$lhs$cast$i19$i = $add$ptr16$i$i;
      $sub$ptr$rhs$cast$i20$i = $add$ptr4$i$i;
      $sub$ptr$sub$i21$i = (($sub$ptr$lhs$cast$i19$i) - ($sub$ptr$rhs$cast$i20$i))|0;
      $add$ptr17$i$i = (($add$ptr4$i$i) + ($nb$0)|0);
      $sub18$i$i = (($sub$ptr$sub$i21$i) - ($nb$0))|0;
      $or19$i$i = $nb$0 | 3;
      $head$i22$i = ((($add$ptr4$i$i)) + 4|0);
      HEAP32[$head$i22$i>>2] = $or19$i$i;
      $cmp20$i$i = ($92|0)==($add$ptr16$i$i|0);
      L238: do {
       if ($cmp20$i$i) {
        $111 = HEAP32[(32492)>>2]|0;
        $add$i$i = (($111) + ($sub18$i$i))|0;
        HEAP32[(32492)>>2] = $add$i$i;
        HEAP32[(32504)>>2] = $add$ptr17$i$i;
        $or22$i$i = $add$i$i | 1;
        $head23$i$i = ((($add$ptr17$i$i)) + 4|0);
        HEAP32[$head23$i$i>>2] = $or22$i$i;
       } else {
        $112 = HEAP32[(32500)>>2]|0;
        $cmp24$i$i = ($112|0)==($add$ptr16$i$i|0);
        if ($cmp24$i$i) {
         $113 = HEAP32[(32488)>>2]|0;
         $add26$i$i = (($113) + ($sub18$i$i))|0;
         HEAP32[(32488)>>2] = $add26$i$i;
         HEAP32[(32500)>>2] = $add$ptr17$i$i;
         $or28$i$i = $add26$i$i | 1;
         $head29$i$i = ((($add$ptr17$i$i)) + 4|0);
         HEAP32[$head29$i$i>>2] = $or28$i$i;
         $add$ptr30$i$i = (($add$ptr17$i$i) + ($add26$i$i)|0);
         HEAP32[$add$ptr30$i$i>>2] = $add26$i$i;
         break;
        }
        $head32$i$i = ((($add$ptr16$i$i)) + 4|0);
        $114 = HEAP32[$head32$i$i>>2]|0;
        $and33$i$i = $114 & 3;
        $cmp34$i$i = ($and33$i$i|0)==(1);
        if ($cmp34$i$i) {
         $and37$i$i = $114 & -8;
         $shr$i25$i = $114 >>> 3;
         $cmp38$i$i = ($114>>>0)<(256);
         L246: do {
          if ($cmp38$i$i) {
           $fd$i$i = ((($add$ptr16$i$i)) + 8|0);
           $115 = HEAP32[$fd$i$i>>2]|0;
           $bk$i26$i = ((($add$ptr16$i$i)) + 12|0);
           $116 = HEAP32[$bk$i26$i>>2]|0;
           $cmp46$i$i = ($116|0)==($115|0);
           if ($cmp46$i$i) {
            $shl48$i$i = 1 << $shr$i25$i;
            $neg$i$i = $shl48$i$i ^ -1;
            $117 = HEAP32[8120]|0;
            $and49$i$i = $117 & $neg$i$i;
            HEAP32[8120] = $and49$i$i;
            break;
           } else {
            $bk67$i$i = ((($115)) + 12|0);
            HEAP32[$bk67$i$i>>2] = $116;
            $fd68$i$i = ((($116)) + 8|0);
            HEAP32[$fd68$i$i>>2] = $115;
            break;
           }
          } else {
           $parent$i27$i = ((($add$ptr16$i$i)) + 24|0);
           $118 = HEAP32[$parent$i27$i>>2]|0;
           $bk74$i$i = ((($add$ptr16$i$i)) + 12|0);
           $119 = HEAP32[$bk74$i$i>>2]|0;
           $cmp75$i$i = ($119|0)==($add$ptr16$i$i|0);
           do {
            if ($cmp75$i$i) {
             $child$i$i = ((($add$ptr16$i$i)) + 16|0);
             $arrayidx96$i$i = ((($child$i$i)) + 4|0);
             $121 = HEAP32[$arrayidx96$i$i>>2]|0;
             $cmp97$i$i = ($121|0)==(0|0);
             if ($cmp97$i$i) {
              $122 = HEAP32[$child$i$i>>2]|0;
              $cmp100$i$i = ($122|0)==(0|0);
              if ($cmp100$i$i) {
               $R$3$i$i = 0;
               break;
              } else {
               $R$1$i$i$ph = $122;$RP$1$i$i$ph = $child$i$i;
              }
             } else {
              $R$1$i$i$ph = $121;$RP$1$i$i$ph = $arrayidx96$i$i;
             }
             $R$1$i$i = $R$1$i$i$ph;$RP$1$i$i = $RP$1$i$i$ph;
             while(1) {
              $arrayidx103$i$i = ((($R$1$i$i)) + 20|0);
              $123 = HEAP32[$arrayidx103$i$i>>2]|0;
              $cmp104$i$i = ($123|0)==(0|0);
              if ($cmp104$i$i) {
               $arrayidx107$i$i = ((($R$1$i$i)) + 16|0);
               $124 = HEAP32[$arrayidx107$i$i>>2]|0;
               $cmp108$i$i = ($124|0)==(0|0);
               if ($cmp108$i$i) {
                break;
               } else {
                $R$1$i$i$be = $124;$RP$1$i$i$be = $arrayidx107$i$i;
               }
              } else {
               $R$1$i$i$be = $123;$RP$1$i$i$be = $arrayidx103$i$i;
              }
              $R$1$i$i = $R$1$i$i$be;$RP$1$i$i = $RP$1$i$i$be;
             }
             HEAP32[$RP$1$i$i>>2] = 0;
             $R$3$i$i = $R$1$i$i;
            } else {
             $fd78$i$i = ((($add$ptr16$i$i)) + 8|0);
             $120 = HEAP32[$fd78$i$i>>2]|0;
             $bk91$i$i = ((($120)) + 12|0);
             HEAP32[$bk91$i$i>>2] = $119;
             $fd92$i$i = ((($119)) + 8|0);
             HEAP32[$fd92$i$i>>2] = $120;
             $R$3$i$i = $119;
            }
           } while(0);
           $cmp120$i28$i = ($118|0)==(0|0);
           if ($cmp120$i28$i) {
            break;
           }
           $index$i29$i = ((($add$ptr16$i$i)) + 28|0);
           $125 = HEAP32[$index$i29$i>>2]|0;
           $arrayidx123$i$i = (32784 + ($125<<2)|0);
           $126 = HEAP32[$arrayidx123$i$i>>2]|0;
           $cmp124$i$i = ($126|0)==($add$ptr16$i$i|0);
           do {
            if ($cmp124$i$i) {
             HEAP32[$arrayidx123$i$i>>2] = $R$3$i$i;
             $cond1$i$i = ($R$3$i$i|0)==(0|0);
             if (!($cond1$i$i)) {
              break;
             }
             $shl131$i$i = 1 << $125;
             $neg132$i$i = $shl131$i$i ^ -1;
             $127 = HEAP32[(32484)>>2]|0;
             $and133$i$i = $127 & $neg132$i$i;
             HEAP32[(32484)>>2] = $and133$i$i;
             break L246;
            } else {
             $arrayidx143$i$i = ((($118)) + 16|0);
             $128 = HEAP32[$arrayidx143$i$i>>2]|0;
             $cmp144$i$i = ($128|0)==($add$ptr16$i$i|0);
             $arrayidx151$i$i = ((($118)) + 20|0);
             $arrayidx151$i$i$sink = $cmp144$i$i ? $arrayidx143$i$i : $arrayidx151$i$i;
             HEAP32[$arrayidx151$i$i$sink>>2] = $R$3$i$i;
             $cmp156$i$i = ($R$3$i$i|0)==(0|0);
             if ($cmp156$i$i) {
              break L246;
             }
            }
           } while(0);
           $parent165$i$i = ((($R$3$i$i)) + 24|0);
           HEAP32[$parent165$i$i>>2] = $118;
           $child166$i$i = ((($add$ptr16$i$i)) + 16|0);
           $129 = HEAP32[$child166$i$i>>2]|0;
           $cmp168$i$i = ($129|0)==(0|0);
           if (!($cmp168$i$i)) {
            $arrayidx178$i$i = ((($R$3$i$i)) + 16|0);
            HEAP32[$arrayidx178$i$i>>2] = $129;
            $parent179$i$i = ((($129)) + 24|0);
            HEAP32[$parent179$i$i>>2] = $R$3$i$i;
           }
           $arrayidx184$i$i = ((($child166$i$i)) + 4|0);
           $130 = HEAP32[$arrayidx184$i$i>>2]|0;
           $cmp185$i$i = ($130|0)==(0|0);
           if ($cmp185$i$i) {
            break;
           }
           $arrayidx195$i$i = ((($R$3$i$i)) + 20|0);
           HEAP32[$arrayidx195$i$i>>2] = $130;
           $parent196$i$i = ((($130)) + 24|0);
           HEAP32[$parent196$i$i>>2] = $R$3$i$i;
          }
         } while(0);
         $add$ptr205$i$i = (($add$ptr16$i$i) + ($and37$i$i)|0);
         $add206$i$i = (($and37$i$i) + ($sub18$i$i))|0;
         $oldfirst$0$i$i = $add$ptr205$i$i;$qsize$0$i$i = $add206$i$i;
        } else {
         $oldfirst$0$i$i = $add$ptr16$i$i;$qsize$0$i$i = $sub18$i$i;
        }
        $head208$i$i = ((($oldfirst$0$i$i)) + 4|0);
        $131 = HEAP32[$head208$i$i>>2]|0;
        $and209$i$i = $131 & -2;
        HEAP32[$head208$i$i>>2] = $and209$i$i;
        $or210$i$i = $qsize$0$i$i | 1;
        $head211$i$i = ((($add$ptr17$i$i)) + 4|0);
        HEAP32[$head211$i$i>>2] = $or210$i$i;
        $add$ptr212$i$i = (($add$ptr17$i$i) + ($qsize$0$i$i)|0);
        HEAP32[$add$ptr212$i$i>>2] = $qsize$0$i$i;
        $shr214$i$i = $qsize$0$i$i >>> 3;
        $cmp215$i$i = ($qsize$0$i$i>>>0)<(256);
        if ($cmp215$i$i) {
         $shl222$i$i = $shr214$i$i << 1;
         $arrayidx223$i$i = (32520 + ($shl222$i$i<<2)|0);
         $132 = HEAP32[8120]|0;
         $shl226$i$i = 1 << $shr214$i$i;
         $and227$i$i = $132 & $shl226$i$i;
         $tobool228$i$i = ($and227$i$i|0)==(0);
         if ($tobool228$i$i) {
          $or232$i$i = $132 | $shl226$i$i;
          HEAP32[8120] = $or232$i$i;
          $$pre$i31$i = ((($arrayidx223$i$i)) + 8|0);
          $$pre$phi$i32$iZ2D = $$pre$i31$i;$F224$0$i$i = $arrayidx223$i$i;
         } else {
          $133 = ((($arrayidx223$i$i)) + 8|0);
          $134 = HEAP32[$133>>2]|0;
          $$pre$phi$i32$iZ2D = $133;$F224$0$i$i = $134;
         }
         HEAP32[$$pre$phi$i32$iZ2D>>2] = $add$ptr17$i$i;
         $bk246$i$i = ((($F224$0$i$i)) + 12|0);
         HEAP32[$bk246$i$i>>2] = $add$ptr17$i$i;
         $fd247$i$i = ((($add$ptr17$i$i)) + 8|0);
         HEAP32[$fd247$i$i>>2] = $F224$0$i$i;
         $bk248$i$i = ((($add$ptr17$i$i)) + 12|0);
         HEAP32[$bk248$i$i>>2] = $arrayidx223$i$i;
         break;
        }
        $shr253$i$i = $qsize$0$i$i >>> 8;
        $cmp254$i$i = ($shr253$i$i|0)==(0);
        do {
         if ($cmp254$i$i) {
          $I252$0$i$i = 0;
         } else {
          $cmp258$i$i = ($qsize$0$i$i>>>0)>(16777215);
          if ($cmp258$i$i) {
           $I252$0$i$i = 31;
           break;
          }
          $sub262$i$i = (($shr253$i$i) + 1048320)|0;
          $shr263$i$i = $sub262$i$i >>> 16;
          $and264$i$i = $shr263$i$i & 8;
          $shl265$i$i = $shr253$i$i << $and264$i$i;
          $sub266$i$i = (($shl265$i$i) + 520192)|0;
          $shr267$i$i = $sub266$i$i >>> 16;
          $and268$i$i = $shr267$i$i & 4;
          $add269$i$i = $and268$i$i | $and264$i$i;
          $shl270$i$i = $shl265$i$i << $and268$i$i;
          $sub271$i$i = (($shl270$i$i) + 245760)|0;
          $shr272$i$i = $sub271$i$i >>> 16;
          $and273$i$i = $shr272$i$i & 2;
          $add274$i$i = $add269$i$i | $and273$i$i;
          $sub275$i$i = (14 - ($add274$i$i))|0;
          $shl276$i$i = $shl270$i$i << $and273$i$i;
          $shr277$i$i = $shl276$i$i >>> 15;
          $add278$i$i = (($sub275$i$i) + ($shr277$i$i))|0;
          $shl279$i$i = $add278$i$i << 1;
          $add280$i$i = (($add278$i$i) + 7)|0;
          $shr281$i$i = $qsize$0$i$i >>> $add280$i$i;
          $and282$i$i = $shr281$i$i & 1;
          $add283$i$i = $and282$i$i | $shl279$i$i;
          $I252$0$i$i = $add283$i$i;
         }
        } while(0);
        $arrayidx287$i$i = (32784 + ($I252$0$i$i<<2)|0);
        $index288$i$i = ((($add$ptr17$i$i)) + 28|0);
        HEAP32[$index288$i$i>>2] = $I252$0$i$i;
        $child289$i$i = ((($add$ptr17$i$i)) + 16|0);
        $arrayidx290$i$i = ((($child289$i$i)) + 4|0);
        HEAP32[$arrayidx290$i$i>>2] = 0;
        HEAP32[$child289$i$i>>2] = 0;
        $135 = HEAP32[(32484)>>2]|0;
        $shl294$i$i = 1 << $I252$0$i$i;
        $and295$i$i = $135 & $shl294$i$i;
        $tobool296$i$i = ($and295$i$i|0)==(0);
        if ($tobool296$i$i) {
         $or300$i$i = $135 | $shl294$i$i;
         HEAP32[(32484)>>2] = $or300$i$i;
         HEAP32[$arrayidx287$i$i>>2] = $add$ptr17$i$i;
         $parent301$i$i = ((($add$ptr17$i$i)) + 24|0);
         HEAP32[$parent301$i$i>>2] = $arrayidx287$i$i;
         $bk302$i$i = ((($add$ptr17$i$i)) + 12|0);
         HEAP32[$bk302$i$i>>2] = $add$ptr17$i$i;
         $fd303$i$i = ((($add$ptr17$i$i)) + 8|0);
         HEAP32[$fd303$i$i>>2] = $add$ptr17$i$i;
         break;
        }
        $136 = HEAP32[$arrayidx287$i$i>>2]|0;
        $head3174$i$i = ((($136)) + 4|0);
        $137 = HEAP32[$head3174$i$i>>2]|0;
        $and3185$i$i = $137 & -8;
        $cmp3196$i$i = ($and3185$i$i|0)==($qsize$0$i$i|0);
        L291: do {
         if ($cmp3196$i$i) {
          $T$0$lcssa$i34$i = $136;
         } else {
          $cmp306$i$i = ($I252$0$i$i|0)==(31);
          $shr310$i$i = $I252$0$i$i >>> 1;
          $sub313$i$i = (25 - ($shr310$i$i))|0;
          $cond315$i$i = $cmp306$i$i ? 0 : $sub313$i$i;
          $shl316$i$i = $qsize$0$i$i << $cond315$i$i;
          $K305$08$i$i = $shl316$i$i;$T$07$i$i = $136;
          while(1) {
           $shr323$i$i = $K305$08$i$i >>> 31;
           $arrayidx325$i$i = (((($T$07$i$i)) + 16|0) + ($shr323$i$i<<2)|0);
           $138 = HEAP32[$arrayidx325$i$i>>2]|0;
           $cmp327$i$i = ($138|0)==(0|0);
           if ($cmp327$i$i) {
            break;
           }
           $shl326$i$i = $K305$08$i$i << 1;
           $head317$i$i = ((($138)) + 4|0);
           $139 = HEAP32[$head317$i$i>>2]|0;
           $and318$i$i = $139 & -8;
           $cmp319$i$i = ($and318$i$i|0)==($qsize$0$i$i|0);
           if ($cmp319$i$i) {
            $T$0$lcssa$i34$i = $138;
            break L291;
           } else {
            $K305$08$i$i = $shl326$i$i;$T$07$i$i = $138;
           }
          }
          HEAP32[$arrayidx325$i$i>>2] = $add$ptr17$i$i;
          $parent337$i$i = ((($add$ptr17$i$i)) + 24|0);
          HEAP32[$parent337$i$i>>2] = $T$07$i$i;
          $bk338$i$i = ((($add$ptr17$i$i)) + 12|0);
          HEAP32[$bk338$i$i>>2] = $add$ptr17$i$i;
          $fd339$i$i = ((($add$ptr17$i$i)) + 8|0);
          HEAP32[$fd339$i$i>>2] = $add$ptr17$i$i;
          break L238;
         }
        } while(0);
        $fd344$i$i = ((($T$0$lcssa$i34$i)) + 8|0);
        $140 = HEAP32[$fd344$i$i>>2]|0;
        $bk357$i$i = ((($140)) + 12|0);
        HEAP32[$bk357$i$i>>2] = $add$ptr17$i$i;
        HEAP32[$fd344$i$i>>2] = $add$ptr17$i$i;
        $fd359$i$i = ((($add$ptr17$i$i)) + 8|0);
        HEAP32[$fd359$i$i>>2] = $140;
        $bk360$i$i = ((($add$ptr17$i$i)) + 12|0);
        HEAP32[$bk360$i$i>>2] = $T$0$lcssa$i34$i;
        $parent361$i$i = ((($add$ptr17$i$i)) + 24|0);
        HEAP32[$parent361$i$i>>2] = 0;
       }
      } while(0);
      $add$ptr369$i$i = ((($add$ptr4$i$i)) + 8|0);
      $retval$0 = $add$ptr369$i$i;
      STACKTOP = sp;return ($retval$0|0);
     }
    }
    $sp$0$i$i$i = (32928);
    while(1) {
     $141 = HEAP32[$sp$0$i$i$i>>2]|0;
     $cmp$i$i$i = ($141>>>0)>($92>>>0);
     if (!($cmp$i$i$i)) {
      $size$i$i$i = ((($sp$0$i$i$i)) + 4|0);
      $142 = HEAP32[$size$i$i$i>>2]|0;
      $add$ptr$i$i$i = (($141) + ($142)|0);
      $cmp2$i$i$i = ($add$ptr$i$i$i>>>0)>($92>>>0);
      if ($cmp2$i$i$i) {
       break;
      }
     }
     $next$i$i$i = ((($sp$0$i$i$i)) + 8|0);
     $143 = HEAP32[$next$i$i$i>>2]|0;
     $sp$0$i$i$i = $143;
    }
    $add$ptr2$i$i = ((($add$ptr$i$i$i)) + -47|0);
    $add$ptr3$i$i = ((($add$ptr2$i$i)) + 8|0);
    $144 = $add$ptr3$i$i;
    $and$i$i = $144 & 7;
    $cmp$i12$i = ($and$i$i|0)==(0);
    $sub$i$i = (0 - ($144))|0;
    $and6$i13$i = $sub$i$i & 7;
    $cond$i$i = $cmp$i12$i ? 0 : $and6$i13$i;
    $add$ptr7$i$i = (($add$ptr2$i$i) + ($cond$i$i)|0);
    $add$ptr81$i$i = ((($92)) + 16|0);
    $cmp9$i$i = ($add$ptr7$i$i>>>0)<($add$ptr81$i$i>>>0);
    $cond13$i$i = $cmp9$i$i ? $92 : $add$ptr7$i$i;
    $add$ptr14$i$i = ((($cond13$i$i)) + 8|0);
    $add$ptr15$i$i = ((($cond13$i$i)) + 24|0);
    $sub16$i$i = (($tsize$794$i) + -40)|0;
    $add$ptr$i2$i$i = ((($tbase$795$i)) + 8|0);
    $145 = $add$ptr$i2$i$i;
    $and$i$i$i = $145 & 7;
    $cmp$i3$i$i = ($and$i$i$i|0)==(0);
    $sub$i$i$i = (0 - ($145))|0;
    $and3$i$i$i = $sub$i$i$i & 7;
    $cond$i$i$i = $cmp$i3$i$i ? 0 : $and3$i$i$i;
    $add$ptr4$i$i$i = (($tbase$795$i) + ($cond$i$i$i)|0);
    $sub5$i$i$i = (($sub16$i$i) - ($cond$i$i$i))|0;
    HEAP32[(32504)>>2] = $add$ptr4$i$i$i;
    HEAP32[(32492)>>2] = $sub5$i$i$i;
    $or$i$i$i = $sub5$i$i$i | 1;
    $head$i$i$i = ((($add$ptr4$i$i$i)) + 4|0);
    HEAP32[$head$i$i$i>>2] = $or$i$i$i;
    $add$ptr6$i$i$i = (($tbase$795$i) + ($sub16$i$i)|0);
    $head7$i$i$i = ((($add$ptr6$i$i$i)) + 4|0);
    HEAP32[$head7$i$i$i>>2] = 40;
    $146 = HEAP32[(32968)>>2]|0;
    HEAP32[(32508)>>2] = $146;
    $head$i$i = ((($cond13$i$i)) + 4|0);
    HEAP32[$head$i$i>>2] = 27;
    ;HEAP32[$add$ptr14$i$i>>2]=HEAP32[(32928)>>2]|0;HEAP32[$add$ptr14$i$i+4>>2]=HEAP32[(32928)+4>>2]|0;HEAP32[$add$ptr14$i$i+8>>2]=HEAP32[(32928)+8>>2]|0;HEAP32[$add$ptr14$i$i+12>>2]=HEAP32[(32928)+12>>2]|0;
    HEAP32[(32928)>>2] = $tbase$795$i;
    HEAP32[(32932)>>2] = $tsize$794$i;
    HEAP32[(32940)>>2] = 0;
    HEAP32[(32936)>>2] = $add$ptr14$i$i;
    $147 = $add$ptr15$i$i;
    while(1) {
     $add$ptr24$i$i = ((($147)) + 4|0);
     HEAP32[$add$ptr24$i$i>>2] = 7;
     $head26$i$i = ((($147)) + 8|0);
     $cmp27$i$i = ($head26$i$i>>>0)<($add$ptr$i$i$i>>>0);
     if ($cmp27$i$i) {
      $147 = $add$ptr24$i$i;
     } else {
      break;
     }
    }
    $cmp28$i$i = ($cond13$i$i|0)==($92|0);
    if (!($cmp28$i$i)) {
     $sub$ptr$lhs$cast$i$i = $cond13$i$i;
     $sub$ptr$rhs$cast$i$i = $92;
     $sub$ptr$sub$i$i = (($sub$ptr$lhs$cast$i$i) - ($sub$ptr$rhs$cast$i$i))|0;
     $148 = HEAP32[$head$i$i>>2]|0;
     $and32$i$i = $148 & -2;
     HEAP32[$head$i$i>>2] = $and32$i$i;
     $or33$i$i = $sub$ptr$sub$i$i | 1;
     $head34$i$i = ((($92)) + 4|0);
     HEAP32[$head34$i$i>>2] = $or33$i$i;
     HEAP32[$cond13$i$i>>2] = $sub$ptr$sub$i$i;
     $shr$i$i = $sub$ptr$sub$i$i >>> 3;
     $cmp36$i$i = ($sub$ptr$sub$i$i>>>0)<(256);
     if ($cmp36$i$i) {
      $shl$i$i = $shr$i$i << 1;
      $arrayidx$i$i = (32520 + ($shl$i$i<<2)|0);
      $149 = HEAP32[8120]|0;
      $shl39$i$i = 1 << $shr$i$i;
      $and40$i$i = $149 & $shl39$i$i;
      $tobool$i$i = ($and40$i$i|0)==(0);
      if ($tobool$i$i) {
       $or44$i$i = $149 | $shl39$i$i;
       HEAP32[8120] = $or44$i$i;
       $$pre$i$i = ((($arrayidx$i$i)) + 8|0);
       $$pre$phi$i$iZ2D = $$pre$i$i;$F$0$i$i = $arrayidx$i$i;
      } else {
       $150 = ((($arrayidx$i$i)) + 8|0);
       $151 = HEAP32[$150>>2]|0;
       $$pre$phi$i$iZ2D = $150;$F$0$i$i = $151;
      }
      HEAP32[$$pre$phi$i$iZ2D>>2] = $92;
      $bk$i$i = ((($F$0$i$i)) + 12|0);
      HEAP32[$bk$i$i>>2] = $92;
      $fd54$i$i = ((($92)) + 8|0);
      HEAP32[$fd54$i$i>>2] = $F$0$i$i;
      $bk55$i$i = ((($92)) + 12|0);
      HEAP32[$bk55$i$i>>2] = $arrayidx$i$i;
      break;
     }
     $shr58$i$i = $sub$ptr$sub$i$i >>> 8;
     $cmp59$i$i = ($shr58$i$i|0)==(0);
     if ($cmp59$i$i) {
      $I57$0$i$i = 0;
     } else {
      $cmp63$i$i = ($sub$ptr$sub$i$i>>>0)>(16777215);
      if ($cmp63$i$i) {
       $I57$0$i$i = 31;
      } else {
       $sub67$i$i = (($shr58$i$i) + 1048320)|0;
       $shr68$i$i = $sub67$i$i >>> 16;
       $and69$i$i = $shr68$i$i & 8;
       $shl70$i$i = $shr58$i$i << $and69$i$i;
       $sub71$i$i = (($shl70$i$i) + 520192)|0;
       $shr72$i$i = $sub71$i$i >>> 16;
       $and73$i$i = $shr72$i$i & 4;
       $add74$i$i = $and73$i$i | $and69$i$i;
       $shl75$i$i = $shl70$i$i << $and73$i$i;
       $sub76$i$i = (($shl75$i$i) + 245760)|0;
       $shr77$i$i = $sub76$i$i >>> 16;
       $and78$i$i = $shr77$i$i & 2;
       $add79$i$i = $add74$i$i | $and78$i$i;
       $sub80$i$i = (14 - ($add79$i$i))|0;
       $shl81$i$i = $shl75$i$i << $and78$i$i;
       $shr82$i$i = $shl81$i$i >>> 15;
       $add83$i$i = (($sub80$i$i) + ($shr82$i$i))|0;
       $shl84$i$i = $add83$i$i << 1;
       $add85$i$i = (($add83$i$i) + 7)|0;
       $shr86$i$i = $sub$ptr$sub$i$i >>> $add85$i$i;
       $and87$i$i = $shr86$i$i & 1;
       $add88$i$i = $and87$i$i | $shl84$i$i;
       $I57$0$i$i = $add88$i$i;
      }
     }
     $arrayidx91$i$i = (32784 + ($I57$0$i$i<<2)|0);
     $index$i$i = ((($92)) + 28|0);
     HEAP32[$index$i$i>>2] = $I57$0$i$i;
     $arrayidx92$i$i = ((($92)) + 20|0);
     HEAP32[$arrayidx92$i$i>>2] = 0;
     HEAP32[$add$ptr81$i$i>>2] = 0;
     $152 = HEAP32[(32484)>>2]|0;
     $shl95$i$i = 1 << $I57$0$i$i;
     $and96$i$i = $152 & $shl95$i$i;
     $tobool97$i$i = ($and96$i$i|0)==(0);
     if ($tobool97$i$i) {
      $or101$i$i = $152 | $shl95$i$i;
      HEAP32[(32484)>>2] = $or101$i$i;
      HEAP32[$arrayidx91$i$i>>2] = $92;
      $parent$i$i = ((($92)) + 24|0);
      HEAP32[$parent$i$i>>2] = $arrayidx91$i$i;
      $bk102$i$i = ((($92)) + 12|0);
      HEAP32[$bk102$i$i>>2] = $92;
      $fd103$i$i = ((($92)) + 8|0);
      HEAP32[$fd103$i$i>>2] = $92;
      break;
     }
     $153 = HEAP32[$arrayidx91$i$i>>2]|0;
     $head1186$i$i = ((($153)) + 4|0);
     $154 = HEAP32[$head1186$i$i>>2]|0;
     $and1197$i$i = $154 & -8;
     $cmp1208$i$i = ($and1197$i$i|0)==($sub$ptr$sub$i$i|0);
     L325: do {
      if ($cmp1208$i$i) {
       $T$0$lcssa$i$i = $153;
      } else {
       $cmp106$i$i = ($I57$0$i$i|0)==(31);
       $shr110$i$i = $I57$0$i$i >>> 1;
       $sub113$i$i = (25 - ($shr110$i$i))|0;
       $cond115$i$i = $cmp106$i$i ? 0 : $sub113$i$i;
       $shl116$i$i = $sub$ptr$sub$i$i << $cond115$i$i;
       $K105$010$i$i = $shl116$i$i;$T$09$i$i = $153;
       while(1) {
        $shr124$i$i = $K105$010$i$i >>> 31;
        $arrayidx126$i$i = (((($T$09$i$i)) + 16|0) + ($shr124$i$i<<2)|0);
        $155 = HEAP32[$arrayidx126$i$i>>2]|0;
        $cmp128$i$i = ($155|0)==(0|0);
        if ($cmp128$i$i) {
         break;
        }
        $shl127$i$i = $K105$010$i$i << 1;
        $head118$i$i = ((($155)) + 4|0);
        $156 = HEAP32[$head118$i$i>>2]|0;
        $and119$i$i = $156 & -8;
        $cmp120$i$i = ($and119$i$i|0)==($sub$ptr$sub$i$i|0);
        if ($cmp120$i$i) {
         $T$0$lcssa$i$i = $155;
         break L325;
        } else {
         $K105$010$i$i = $shl127$i$i;$T$09$i$i = $155;
        }
       }
       HEAP32[$arrayidx126$i$i>>2] = $92;
       $parent138$i$i = ((($92)) + 24|0);
       HEAP32[$parent138$i$i>>2] = $T$09$i$i;
       $bk139$i$i = ((($92)) + 12|0);
       HEAP32[$bk139$i$i>>2] = $92;
       $fd140$i$i = ((($92)) + 8|0);
       HEAP32[$fd140$i$i>>2] = $92;
       break L215;
      }
     } while(0);
     $fd148$i$i = ((($T$0$lcssa$i$i)) + 8|0);
     $157 = HEAP32[$fd148$i$i>>2]|0;
     $bk158$i$i = ((($157)) + 12|0);
     HEAP32[$bk158$i$i>>2] = $92;
     HEAP32[$fd148$i$i>>2] = $92;
     $fd160$i$i = ((($92)) + 8|0);
     HEAP32[$fd160$i$i>>2] = $157;
     $bk161$i$i = ((($92)) + 12|0);
     HEAP32[$bk161$i$i>>2] = $T$0$lcssa$i$i;
     $parent162$i$i = ((($92)) + 24|0);
     HEAP32[$parent162$i$i>>2] = 0;
    }
   }
  } while(0);
  $158 = HEAP32[(32492)>>2]|0;
  $cmp257$i = ($158>>>0)>($nb$0>>>0);
  if ($cmp257$i) {
   $sub260$i = (($158) - ($nb$0))|0;
   HEAP32[(32492)>>2] = $sub260$i;
   $159 = HEAP32[(32504)>>2]|0;
   $add$ptr262$i = (($159) + ($nb$0)|0);
   HEAP32[(32504)>>2] = $add$ptr262$i;
   $or264$i = $sub260$i | 1;
   $head265$i = ((($add$ptr262$i)) + 4|0);
   HEAP32[$head265$i>>2] = $or264$i;
   $or267$i = $nb$0 | 3;
   $head268$i = ((($159)) + 4|0);
   HEAP32[$head268$i>>2] = $or267$i;
   $add$ptr269$i = ((($159)) + 8|0);
   $retval$0 = $add$ptr269$i;
   STACKTOP = sp;return ($retval$0|0);
  }
 }
 $call275$i = (___errno_location()|0);
 HEAP32[$call275$i>>2] = 12;
 $retval$0 = 0;
 STACKTOP = sp;return ($retval$0|0);
}
function _free($mem) {
 $mem = $mem|0;
 var $$pre = 0, $$pre$phiZ2D = 0, $0 = 0, $1 = 0, $10 = 0, $11 = 0, $12 = 0, $13 = 0, $14 = 0, $15 = 0, $16 = 0, $17 = 0, $18 = 0, $19 = 0, $2 = 0, $20 = 0, $21 = 0, $22 = 0, $23 = 0, $24 = 0;
 var $25 = 0, $26 = 0, $27 = 0, $28 = 0, $29 = 0, $3 = 0, $30 = 0, $31 = 0, $32 = 0, $33 = 0, $34 = 0, $35 = 0, $36 = 0, $37 = 0, $38 = 0, $39 = 0, $4 = 0, $40 = 0, $41 = 0, $42 = 0;
 var $43 = 0, $44 = 0, $45 = 0, $46 = 0, $47 = 0, $48 = 0, $49 = 0, $5 = 0, $50 = 0, $51 = 0, $52 = 0, $53 = 0, $54 = 0, $6 = 0, $7 = 0, $8 = 0, $9 = 0, $F510$0 = 0, $I534$0 = 0, $K583$0266 = 0;
 var $R$1 = 0, $R$1$be = 0, $R$1$ph = 0, $R$3 = 0, $R332$1 = 0, $R332$1$be = 0, $R332$1$ph = 0, $R332$3 = 0, $RP$1 = 0, $RP$1$be = 0, $RP$1$ph = 0, $RP360$1 = 0, $RP360$1$be = 0, $RP360$1$ph = 0, $T$0$lcssa = 0, $T$0265 = 0, $add$ptr = 0, $add$ptr16 = 0, $add$ptr217 = 0, $add$ptr261 = 0;
 var $add$ptr482 = 0, $add$ptr498 = 0, $add$ptr6 = 0, $add17 = 0, $add246 = 0, $add258 = 0, $add267 = 0, $add550 = 0, $add555 = 0, $add559 = 0, $add561 = 0, $add564 = 0, $and12 = 0, $and140 = 0, $and210 = 0, $and215 = 0, $and232 = 0, $and240 = 0, $and266 = 0, $and301 = 0;
 var $and410 = 0, $and46 = 0, $and495 = 0, $and5 = 0, $and512 = 0, $and545 = 0, $and549 = 0, $and554 = 0, $and563 = 0, $and574 = 0, $and592 = 0, $and592263 = 0, $and8 = 0, $arrayidx108 = 0, $arrayidx113 = 0, $arrayidx130 = 0, $arrayidx149 = 0, $arrayidx157 = 0, $arrayidx157$sink = 0, $arrayidx182 = 0;
 var $arrayidx188 = 0, $arrayidx198 = 0, $arrayidx362 = 0, $arrayidx374 = 0, $arrayidx379 = 0, $arrayidx400 = 0, $arrayidx419 = 0, $arrayidx427 = 0, $arrayidx427$sink = 0, $arrayidx454 = 0, $arrayidx460 = 0, $arrayidx470 = 0, $arrayidx509 = 0, $arrayidx567 = 0, $arrayidx570 = 0, $arrayidx599 = 0, $arrayidx99 = 0, $bk = 0, $bk275 = 0, $bk321 = 0;
 var $bk333 = 0, $bk355 = 0, $bk529 = 0, $bk531 = 0, $bk580 = 0, $bk611 = 0, $bk631 = 0, $bk634 = 0, $bk66 = 0, $bk73 = 0, $bk94 = 0, $child = 0, $child171 = 0, $child361 = 0, $child443 = 0, $child569 = 0, $cmp = 0, $cmp$i = 0, $cmp100 = 0, $cmp104 = 0;
 var $cmp109 = 0, $cmp114 = 0, $cmp127 = 0, $cmp13 = 0, $cmp131 = 0, $cmp150 = 0, $cmp162 = 0, $cmp173 = 0, $cmp18 = 0, $cmp189 = 0, $cmp211 = 0, $cmp22 = 0, $cmp228 = 0, $cmp243 = 0, $cmp249 = 0, $cmp25 = 0, $cmp255 = 0, $cmp269 = 0, $cmp296 = 0, $cmp334 = 0;
 var $cmp363 = 0, $cmp368 = 0, $cmp375 = 0, $cmp380 = 0, $cmp395 = 0, $cmp401 = 0, $cmp42 = 0, $cmp420 = 0, $cmp432 = 0, $cmp445 = 0, $cmp461 = 0, $cmp484 = 0, $cmp502 = 0, $cmp536 = 0, $cmp540 = 0, $cmp584 = 0, $cmp593 = 0, $cmp593264 = 0, $cmp601 = 0, $cmp640 = 0;
 var $cmp74 = 0, $cond = 0, $cond254 = 0, $cond255 = 0, $dec = 0, $fd = 0, $fd273 = 0, $fd322 = 0, $fd338 = 0, $fd356 = 0, $fd530 = 0, $fd581 = 0, $fd612 = 0, $fd620 = 0, $fd633 = 0, $fd67 = 0, $fd78 = 0, $fd95 = 0, $head209 = 0, $head216 = 0;
 var $head231 = 0, $head248 = 0, $head260 = 0, $head4 = 0, $head481 = 0, $head497 = 0, $head591 = 0, $head591262 = 0, $idx$neg = 0, $index = 0, $index399 = 0, $index568 = 0, $neg = 0, $neg139 = 0, $neg300 = 0, $neg409 = 0, $next4$i = 0, $or = 0, $or247 = 0, $or259 = 0;
 var $or480 = 0, $or496 = 0, $or516 = 0, $or578 = 0, $p$1 = 0, $parent = 0, $parent170 = 0, $parent183 = 0, $parent199 = 0, $parent331 = 0, $parent442 = 0, $parent455 = 0, $parent471 = 0, $parent579 = 0, $parent610 = 0, $parent635 = 0, $psize$1 = 0, $psize$2 = 0, $shl138 = 0, $shl299 = 0;
 var $shl408 = 0, $shl45 = 0, $shl508 = 0, $shl511 = 0, $shl546 = 0, $shl551 = 0, $shl557 = 0, $shl560 = 0, $shl573 = 0, $shl590 = 0, $shl600 = 0, $shr = 0, $shr268 = 0, $shr501 = 0, $shr535 = 0, $shr544 = 0, $shr548 = 0, $shr553 = 0, $shr558 = 0, $shr562 = 0;
 var $shr586 = 0, $shr597 = 0, $sp$0$i = 0, $sp$0$in$i = 0, $sub = 0, $sub547 = 0, $sub552 = 0, $sub556 = 0, $sub589 = 0, $tobool233 = 0, $tobool241 = 0, $tobool513 = 0, $tobool575 = 0, $tobool9 = 0, label = 0, sp = 0;
 sp = STACKTOP;
 $cmp = ($mem|0)==(0|0);
 if ($cmp) {
  return;
 }
 $add$ptr = ((($mem)) + -8|0);
 $0 = HEAP32[(32496)>>2]|0;
 $head4 = ((($mem)) + -4|0);
 $1 = HEAP32[$head4>>2]|0;
 $and5 = $1 & -8;
 $add$ptr6 = (($add$ptr) + ($and5)|0);
 $and8 = $1 & 1;
 $tobool9 = ($and8|0)==(0);
 do {
  if ($tobool9) {
   $2 = HEAP32[$add$ptr>>2]|0;
   $and12 = $1 & 3;
   $cmp13 = ($and12|0)==(0);
   if ($cmp13) {
    return;
   }
   $idx$neg = (0 - ($2))|0;
   $add$ptr16 = (($add$ptr) + ($idx$neg)|0);
   $add17 = (($2) + ($and5))|0;
   $cmp18 = ($add$ptr16>>>0)<($0>>>0);
   if ($cmp18) {
    return;
   }
   $3 = HEAP32[(32500)>>2]|0;
   $cmp22 = ($3|0)==($add$ptr16|0);
   if ($cmp22) {
    $head209 = ((($add$ptr6)) + 4|0);
    $20 = HEAP32[$head209>>2]|0;
    $and210 = $20 & 3;
    $cmp211 = ($and210|0)==(3);
    if (!($cmp211)) {
     $21 = $add$ptr16;$p$1 = $add$ptr16;$psize$1 = $add17;
     break;
    }
    $add$ptr217 = (($add$ptr16) + ($add17)|0);
    $head216 = ((($add$ptr16)) + 4|0);
    $or = $add17 | 1;
    $and215 = $20 & -2;
    HEAP32[(32488)>>2] = $add17;
    HEAP32[$head209>>2] = $and215;
    HEAP32[$head216>>2] = $or;
    HEAP32[$add$ptr217>>2] = $add17;
    return;
   }
   $shr = $2 >>> 3;
   $cmp25 = ($2>>>0)<(256);
   if ($cmp25) {
    $fd = ((($add$ptr16)) + 8|0);
    $4 = HEAP32[$fd>>2]|0;
    $bk = ((($add$ptr16)) + 12|0);
    $5 = HEAP32[$bk>>2]|0;
    $cmp42 = ($5|0)==($4|0);
    if ($cmp42) {
     $shl45 = 1 << $shr;
     $neg = $shl45 ^ -1;
     $6 = HEAP32[8120]|0;
     $and46 = $6 & $neg;
     HEAP32[8120] = $and46;
     $21 = $add$ptr16;$p$1 = $add$ptr16;$psize$1 = $add17;
     break;
    } else {
     $bk66 = ((($4)) + 12|0);
     HEAP32[$bk66>>2] = $5;
     $fd67 = ((($5)) + 8|0);
     HEAP32[$fd67>>2] = $4;
     $21 = $add$ptr16;$p$1 = $add$ptr16;$psize$1 = $add17;
     break;
    }
   }
   $parent = ((($add$ptr16)) + 24|0);
   $7 = HEAP32[$parent>>2]|0;
   $bk73 = ((($add$ptr16)) + 12|0);
   $8 = HEAP32[$bk73>>2]|0;
   $cmp74 = ($8|0)==($add$ptr16|0);
   do {
    if ($cmp74) {
     $child = ((($add$ptr16)) + 16|0);
     $arrayidx99 = ((($child)) + 4|0);
     $10 = HEAP32[$arrayidx99>>2]|0;
     $cmp100 = ($10|0)==(0|0);
     if ($cmp100) {
      $11 = HEAP32[$child>>2]|0;
      $cmp104 = ($11|0)==(0|0);
      if ($cmp104) {
       $R$3 = 0;
       break;
      } else {
       $R$1$ph = $11;$RP$1$ph = $child;
      }
     } else {
      $R$1$ph = $10;$RP$1$ph = $arrayidx99;
     }
     $R$1 = $R$1$ph;$RP$1 = $RP$1$ph;
     while(1) {
      $arrayidx108 = ((($R$1)) + 20|0);
      $12 = HEAP32[$arrayidx108>>2]|0;
      $cmp109 = ($12|0)==(0|0);
      if ($cmp109) {
       $arrayidx113 = ((($R$1)) + 16|0);
       $13 = HEAP32[$arrayidx113>>2]|0;
       $cmp114 = ($13|0)==(0|0);
       if ($cmp114) {
        break;
       } else {
        $R$1$be = $13;$RP$1$be = $arrayidx113;
       }
      } else {
       $R$1$be = $12;$RP$1$be = $arrayidx108;
      }
      $R$1 = $R$1$be;$RP$1 = $RP$1$be;
     }
     HEAP32[$RP$1>>2] = 0;
     $R$3 = $R$1;
    } else {
     $fd78 = ((($add$ptr16)) + 8|0);
     $9 = HEAP32[$fd78>>2]|0;
     $bk94 = ((($9)) + 12|0);
     HEAP32[$bk94>>2] = $8;
     $fd95 = ((($8)) + 8|0);
     HEAP32[$fd95>>2] = $9;
     $R$3 = $8;
    }
   } while(0);
   $cmp127 = ($7|0)==(0|0);
   if ($cmp127) {
    $21 = $add$ptr16;$p$1 = $add$ptr16;$psize$1 = $add17;
   } else {
    $index = ((($add$ptr16)) + 28|0);
    $14 = HEAP32[$index>>2]|0;
    $arrayidx130 = (32784 + ($14<<2)|0);
    $15 = HEAP32[$arrayidx130>>2]|0;
    $cmp131 = ($15|0)==($add$ptr16|0);
    if ($cmp131) {
     HEAP32[$arrayidx130>>2] = $R$3;
     $cond254 = ($R$3|0)==(0|0);
     if ($cond254) {
      $shl138 = 1 << $14;
      $neg139 = $shl138 ^ -1;
      $16 = HEAP32[(32484)>>2]|0;
      $and140 = $16 & $neg139;
      HEAP32[(32484)>>2] = $and140;
      $21 = $add$ptr16;$p$1 = $add$ptr16;$psize$1 = $add17;
      break;
     }
    } else {
     $arrayidx149 = ((($7)) + 16|0);
     $17 = HEAP32[$arrayidx149>>2]|0;
     $cmp150 = ($17|0)==($add$ptr16|0);
     $arrayidx157 = ((($7)) + 20|0);
     $arrayidx157$sink = $cmp150 ? $arrayidx149 : $arrayidx157;
     HEAP32[$arrayidx157$sink>>2] = $R$3;
     $cmp162 = ($R$3|0)==(0|0);
     if ($cmp162) {
      $21 = $add$ptr16;$p$1 = $add$ptr16;$psize$1 = $add17;
      break;
     }
    }
    $parent170 = ((($R$3)) + 24|0);
    HEAP32[$parent170>>2] = $7;
    $child171 = ((($add$ptr16)) + 16|0);
    $18 = HEAP32[$child171>>2]|0;
    $cmp173 = ($18|0)==(0|0);
    if (!($cmp173)) {
     $arrayidx182 = ((($R$3)) + 16|0);
     HEAP32[$arrayidx182>>2] = $18;
     $parent183 = ((($18)) + 24|0);
     HEAP32[$parent183>>2] = $R$3;
    }
    $arrayidx188 = ((($child171)) + 4|0);
    $19 = HEAP32[$arrayidx188>>2]|0;
    $cmp189 = ($19|0)==(0|0);
    if ($cmp189) {
     $21 = $add$ptr16;$p$1 = $add$ptr16;$psize$1 = $add17;
    } else {
     $arrayidx198 = ((($R$3)) + 20|0);
     HEAP32[$arrayidx198>>2] = $19;
     $parent199 = ((($19)) + 24|0);
     HEAP32[$parent199>>2] = $R$3;
     $21 = $add$ptr16;$p$1 = $add$ptr16;$psize$1 = $add17;
    }
   }
  } else {
   $21 = $add$ptr;$p$1 = $add$ptr;$psize$1 = $and5;
  }
 } while(0);
 $cmp228 = ($21>>>0)<($add$ptr6>>>0);
 if (!($cmp228)) {
  return;
 }
 $head231 = ((($add$ptr6)) + 4|0);
 $22 = HEAP32[$head231>>2]|0;
 $and232 = $22 & 1;
 $tobool233 = ($and232|0)==(0);
 if ($tobool233) {
  return;
 }
 $and240 = $22 & 2;
 $tobool241 = ($and240|0)==(0);
 if ($tobool241) {
  $23 = HEAP32[(32504)>>2]|0;
  $cmp243 = ($23|0)==($add$ptr6|0);
  if ($cmp243) {
   $24 = HEAP32[(32492)>>2]|0;
   $add246 = (($24) + ($psize$1))|0;
   HEAP32[(32492)>>2] = $add246;
   HEAP32[(32504)>>2] = $p$1;
   $or247 = $add246 | 1;
   $head248 = ((($p$1)) + 4|0);
   HEAP32[$head248>>2] = $or247;
   $25 = HEAP32[(32500)>>2]|0;
   $cmp249 = ($p$1|0)==($25|0);
   if (!($cmp249)) {
    return;
   }
   HEAP32[(32500)>>2] = 0;
   HEAP32[(32488)>>2] = 0;
   return;
  }
  $26 = HEAP32[(32500)>>2]|0;
  $cmp255 = ($26|0)==($add$ptr6|0);
  if ($cmp255) {
   $27 = HEAP32[(32488)>>2]|0;
   $add258 = (($27) + ($psize$1))|0;
   HEAP32[(32488)>>2] = $add258;
   HEAP32[(32500)>>2] = $21;
   $or259 = $add258 | 1;
   $head260 = ((($p$1)) + 4|0);
   HEAP32[$head260>>2] = $or259;
   $add$ptr261 = (($21) + ($add258)|0);
   HEAP32[$add$ptr261>>2] = $add258;
   return;
  }
  $and266 = $22 & -8;
  $add267 = (($and266) + ($psize$1))|0;
  $shr268 = $22 >>> 3;
  $cmp269 = ($22>>>0)<(256);
  do {
   if ($cmp269) {
    $fd273 = ((($add$ptr6)) + 8|0);
    $28 = HEAP32[$fd273>>2]|0;
    $bk275 = ((($add$ptr6)) + 12|0);
    $29 = HEAP32[$bk275>>2]|0;
    $cmp296 = ($29|0)==($28|0);
    if ($cmp296) {
     $shl299 = 1 << $shr268;
     $neg300 = $shl299 ^ -1;
     $30 = HEAP32[8120]|0;
     $and301 = $30 & $neg300;
     HEAP32[8120] = $and301;
     break;
    } else {
     $bk321 = ((($28)) + 12|0);
     HEAP32[$bk321>>2] = $29;
     $fd322 = ((($29)) + 8|0);
     HEAP32[$fd322>>2] = $28;
     break;
    }
   } else {
    $parent331 = ((($add$ptr6)) + 24|0);
    $31 = HEAP32[$parent331>>2]|0;
    $bk333 = ((($add$ptr6)) + 12|0);
    $32 = HEAP32[$bk333>>2]|0;
    $cmp334 = ($32|0)==($add$ptr6|0);
    do {
     if ($cmp334) {
      $child361 = ((($add$ptr6)) + 16|0);
      $arrayidx362 = ((($child361)) + 4|0);
      $34 = HEAP32[$arrayidx362>>2]|0;
      $cmp363 = ($34|0)==(0|0);
      if ($cmp363) {
       $35 = HEAP32[$child361>>2]|0;
       $cmp368 = ($35|0)==(0|0);
       if ($cmp368) {
        $R332$3 = 0;
        break;
       } else {
        $R332$1$ph = $35;$RP360$1$ph = $child361;
       }
      } else {
       $R332$1$ph = $34;$RP360$1$ph = $arrayidx362;
      }
      $R332$1 = $R332$1$ph;$RP360$1 = $RP360$1$ph;
      while(1) {
       $arrayidx374 = ((($R332$1)) + 20|0);
       $36 = HEAP32[$arrayidx374>>2]|0;
       $cmp375 = ($36|0)==(0|0);
       if ($cmp375) {
        $arrayidx379 = ((($R332$1)) + 16|0);
        $37 = HEAP32[$arrayidx379>>2]|0;
        $cmp380 = ($37|0)==(0|0);
        if ($cmp380) {
         break;
        } else {
         $R332$1$be = $37;$RP360$1$be = $arrayidx379;
        }
       } else {
        $R332$1$be = $36;$RP360$1$be = $arrayidx374;
       }
       $R332$1 = $R332$1$be;$RP360$1 = $RP360$1$be;
      }
      HEAP32[$RP360$1>>2] = 0;
      $R332$3 = $R332$1;
     } else {
      $fd338 = ((($add$ptr6)) + 8|0);
      $33 = HEAP32[$fd338>>2]|0;
      $bk355 = ((($33)) + 12|0);
      HEAP32[$bk355>>2] = $32;
      $fd356 = ((($32)) + 8|0);
      HEAP32[$fd356>>2] = $33;
      $R332$3 = $32;
     }
    } while(0);
    $cmp395 = ($31|0)==(0|0);
    if (!($cmp395)) {
     $index399 = ((($add$ptr6)) + 28|0);
     $38 = HEAP32[$index399>>2]|0;
     $arrayidx400 = (32784 + ($38<<2)|0);
     $39 = HEAP32[$arrayidx400>>2]|0;
     $cmp401 = ($39|0)==($add$ptr6|0);
     if ($cmp401) {
      HEAP32[$arrayidx400>>2] = $R332$3;
      $cond255 = ($R332$3|0)==(0|0);
      if ($cond255) {
       $shl408 = 1 << $38;
       $neg409 = $shl408 ^ -1;
       $40 = HEAP32[(32484)>>2]|0;
       $and410 = $40 & $neg409;
       HEAP32[(32484)>>2] = $and410;
       break;
      }
     } else {
      $arrayidx419 = ((($31)) + 16|0);
      $41 = HEAP32[$arrayidx419>>2]|0;
      $cmp420 = ($41|0)==($add$ptr6|0);
      $arrayidx427 = ((($31)) + 20|0);
      $arrayidx427$sink = $cmp420 ? $arrayidx419 : $arrayidx427;
      HEAP32[$arrayidx427$sink>>2] = $R332$3;
      $cmp432 = ($R332$3|0)==(0|0);
      if ($cmp432) {
       break;
      }
     }
     $parent442 = ((($R332$3)) + 24|0);
     HEAP32[$parent442>>2] = $31;
     $child443 = ((($add$ptr6)) + 16|0);
     $42 = HEAP32[$child443>>2]|0;
     $cmp445 = ($42|0)==(0|0);
     if (!($cmp445)) {
      $arrayidx454 = ((($R332$3)) + 16|0);
      HEAP32[$arrayidx454>>2] = $42;
      $parent455 = ((($42)) + 24|0);
      HEAP32[$parent455>>2] = $R332$3;
     }
     $arrayidx460 = ((($child443)) + 4|0);
     $43 = HEAP32[$arrayidx460>>2]|0;
     $cmp461 = ($43|0)==(0|0);
     if (!($cmp461)) {
      $arrayidx470 = ((($R332$3)) + 20|0);
      HEAP32[$arrayidx470>>2] = $43;
      $parent471 = ((($43)) + 24|0);
      HEAP32[$parent471>>2] = $R332$3;
     }
    }
   }
  } while(0);
  $or480 = $add267 | 1;
  $head481 = ((($p$1)) + 4|0);
  HEAP32[$head481>>2] = $or480;
  $add$ptr482 = (($21) + ($add267)|0);
  HEAP32[$add$ptr482>>2] = $add267;
  $44 = HEAP32[(32500)>>2]|0;
  $cmp484 = ($p$1|0)==($44|0);
  if ($cmp484) {
   HEAP32[(32488)>>2] = $add267;
   return;
  } else {
   $psize$2 = $add267;
  }
 } else {
  $and495 = $22 & -2;
  HEAP32[$head231>>2] = $and495;
  $or496 = $psize$1 | 1;
  $head497 = ((($p$1)) + 4|0);
  HEAP32[$head497>>2] = $or496;
  $add$ptr498 = (($21) + ($psize$1)|0);
  HEAP32[$add$ptr498>>2] = $psize$1;
  $psize$2 = $psize$1;
 }
 $shr501 = $psize$2 >>> 3;
 $cmp502 = ($psize$2>>>0)<(256);
 if ($cmp502) {
  $shl508 = $shr501 << 1;
  $arrayidx509 = (32520 + ($shl508<<2)|0);
  $45 = HEAP32[8120]|0;
  $shl511 = 1 << $shr501;
  $and512 = $45 & $shl511;
  $tobool513 = ($and512|0)==(0);
  if ($tobool513) {
   $or516 = $45 | $shl511;
   HEAP32[8120] = $or516;
   $$pre = ((($arrayidx509)) + 8|0);
   $$pre$phiZ2D = $$pre;$F510$0 = $arrayidx509;
  } else {
   $46 = ((($arrayidx509)) + 8|0);
   $47 = HEAP32[$46>>2]|0;
   $$pre$phiZ2D = $46;$F510$0 = $47;
  }
  HEAP32[$$pre$phiZ2D>>2] = $p$1;
  $bk529 = ((($F510$0)) + 12|0);
  HEAP32[$bk529>>2] = $p$1;
  $fd530 = ((($p$1)) + 8|0);
  HEAP32[$fd530>>2] = $F510$0;
  $bk531 = ((($p$1)) + 12|0);
  HEAP32[$bk531>>2] = $arrayidx509;
  return;
 }
 $shr535 = $psize$2 >>> 8;
 $cmp536 = ($shr535|0)==(0);
 if ($cmp536) {
  $I534$0 = 0;
 } else {
  $cmp540 = ($psize$2>>>0)>(16777215);
  if ($cmp540) {
   $I534$0 = 31;
  } else {
   $sub = (($shr535) + 1048320)|0;
   $shr544 = $sub >>> 16;
   $and545 = $shr544 & 8;
   $shl546 = $shr535 << $and545;
   $sub547 = (($shl546) + 520192)|0;
   $shr548 = $sub547 >>> 16;
   $and549 = $shr548 & 4;
   $add550 = $and549 | $and545;
   $shl551 = $shl546 << $and549;
   $sub552 = (($shl551) + 245760)|0;
   $shr553 = $sub552 >>> 16;
   $and554 = $shr553 & 2;
   $add555 = $add550 | $and554;
   $sub556 = (14 - ($add555))|0;
   $shl557 = $shl551 << $and554;
   $shr558 = $shl557 >>> 15;
   $add559 = (($sub556) + ($shr558))|0;
   $shl560 = $add559 << 1;
   $add561 = (($add559) + 7)|0;
   $shr562 = $psize$2 >>> $add561;
   $and563 = $shr562 & 1;
   $add564 = $and563 | $shl560;
   $I534$0 = $add564;
  }
 }
 $arrayidx567 = (32784 + ($I534$0<<2)|0);
 $index568 = ((($p$1)) + 28|0);
 HEAP32[$index568>>2] = $I534$0;
 $child569 = ((($p$1)) + 16|0);
 $arrayidx570 = ((($p$1)) + 20|0);
 HEAP32[$arrayidx570>>2] = 0;
 HEAP32[$child569>>2] = 0;
 $48 = HEAP32[(32484)>>2]|0;
 $shl573 = 1 << $I534$0;
 $and574 = $48 & $shl573;
 $tobool575 = ($and574|0)==(0);
 L112: do {
  if ($tobool575) {
   $or578 = $48 | $shl573;
   HEAP32[(32484)>>2] = $or578;
   HEAP32[$arrayidx567>>2] = $p$1;
   $parent579 = ((($p$1)) + 24|0);
   HEAP32[$parent579>>2] = $arrayidx567;
   $bk580 = ((($p$1)) + 12|0);
   HEAP32[$bk580>>2] = $p$1;
   $fd581 = ((($p$1)) + 8|0);
   HEAP32[$fd581>>2] = $p$1;
  } else {
   $49 = HEAP32[$arrayidx567>>2]|0;
   $head591262 = ((($49)) + 4|0);
   $50 = HEAP32[$head591262>>2]|0;
   $and592263 = $50 & -8;
   $cmp593264 = ($and592263|0)==($psize$2|0);
   L115: do {
    if ($cmp593264) {
     $T$0$lcssa = $49;
    } else {
     $cmp584 = ($I534$0|0)==(31);
     $shr586 = $I534$0 >>> 1;
     $sub589 = (25 - ($shr586))|0;
     $cond = $cmp584 ? 0 : $sub589;
     $shl590 = $psize$2 << $cond;
     $K583$0266 = $shl590;$T$0265 = $49;
     while(1) {
      $shr597 = $K583$0266 >>> 31;
      $arrayidx599 = (((($T$0265)) + 16|0) + ($shr597<<2)|0);
      $51 = HEAP32[$arrayidx599>>2]|0;
      $cmp601 = ($51|0)==(0|0);
      if ($cmp601) {
       break;
      }
      $shl600 = $K583$0266 << 1;
      $head591 = ((($51)) + 4|0);
      $52 = HEAP32[$head591>>2]|0;
      $and592 = $52 & -8;
      $cmp593 = ($and592|0)==($psize$2|0);
      if ($cmp593) {
       $T$0$lcssa = $51;
       break L115;
      } else {
       $K583$0266 = $shl600;$T$0265 = $51;
      }
     }
     HEAP32[$arrayidx599>>2] = $p$1;
     $parent610 = ((($p$1)) + 24|0);
     HEAP32[$parent610>>2] = $T$0265;
     $bk611 = ((($p$1)) + 12|0);
     HEAP32[$bk611>>2] = $p$1;
     $fd612 = ((($p$1)) + 8|0);
     HEAP32[$fd612>>2] = $p$1;
     break L112;
    }
   } while(0);
   $fd620 = ((($T$0$lcssa)) + 8|0);
   $53 = HEAP32[$fd620>>2]|0;
   $bk631 = ((($53)) + 12|0);
   HEAP32[$bk631>>2] = $p$1;
   HEAP32[$fd620>>2] = $p$1;
   $fd633 = ((($p$1)) + 8|0);
   HEAP32[$fd633>>2] = $53;
   $bk634 = ((($p$1)) + 12|0);
   HEAP32[$bk634>>2] = $T$0$lcssa;
   $parent635 = ((($p$1)) + 24|0);
   HEAP32[$parent635>>2] = 0;
  }
 } while(0);
 $54 = HEAP32[(32512)>>2]|0;
 $dec = (($54) + -1)|0;
 HEAP32[(32512)>>2] = $dec;
 $cmp640 = ($dec|0)==(0);
 if (!($cmp640)) {
  return;
 }
 $sp$0$in$i = (32936);
 while(1) {
  $sp$0$i = HEAP32[$sp$0$in$i>>2]|0;
  $cmp$i = ($sp$0$i|0)==(0|0);
  $next4$i = ((($sp$0$i)) + 8|0);
  if ($cmp$i) {
   break;
  } else {
   $sp$0$in$i = $next4$i;
  }
 }
 HEAP32[(32512)>>2] = -1;
 return;
}
function ___errno_location() {
 var label = 0, sp = 0;
 sp = STACKTOP;
 return (32976|0);
}
function ___muldsi3($a, $b) {
    $a = $a | 0;
    $b = $b | 0;
    var $1 = 0, $2 = 0, $3 = 0, $6 = 0, $8 = 0, $11 = 0, $12 = 0;
    $1 = $a & 65535;
    $2 = $b & 65535;
    $3 = Math_imul($2, $1) | 0;
    $6 = $a >>> 16;
    $8 = ($3 >>> 16) + (Math_imul($2, $6) | 0) | 0;
    $11 = $b >>> 16;
    $12 = Math_imul($11, $1) | 0;
    return (setTempRet0(((($8 >>> 16) + (Math_imul($11, $6) | 0) | 0) + ((($8 & 65535) + $12 | 0) >>> 16) | 0) | 0), 0 | ($8 + $12 << 16 | $3 & 65535)) | 0;
}
function ___muldi3($a$0, $a$1, $b$0, $b$1) {
    $a$0 = $a$0 | 0;
    $a$1 = $a$1 | 0;
    $b$0 = $b$0 | 0;
    $b$1 = $b$1 | 0;
    var $x_sroa_0_0_extract_trunc = 0, $y_sroa_0_0_extract_trunc = 0, $1$0 = 0, $1$1 = 0, $2 = 0;
    $x_sroa_0_0_extract_trunc = $a$0;
    $y_sroa_0_0_extract_trunc = $b$0;
    $1$0 = ___muldsi3($x_sroa_0_0_extract_trunc, $y_sroa_0_0_extract_trunc) | 0;
    $1$1 = (getTempRet0() | 0);
    $2 = Math_imul($a$1, $y_sroa_0_0_extract_trunc) | 0;
    return (setTempRet0((((Math_imul($b$1, $x_sroa_0_0_extract_trunc) | 0) + $2 | 0) + $1$1 | $1$1 & 0) | 0), 0 | $1$0 & -1) | 0;
}
function _bitshift64Ashr(low, high, bits) {
    low = low|0; high = high|0; bits = bits|0;
    var ander = 0;
    if ((bits|0) < 32) {
      ander = ((1 << bits) - 1)|0;
      setTempRet0((high >> bits) | 0);
      return (low >>> bits) | ((high&ander) << (32 - bits));
    }
    setTempRet0(((high|0) < 0 ? -1 : 0) | 0);
    return (high >> (bits - 32))|0;
}
function _bitshift64Lshr(low, high, bits) {
    low = low|0; high = high|0; bits = bits|0;
    var ander = 0;
    if ((bits|0) < 32) {
      ander = ((1 << bits) - 1)|0;
      setTempRet0((high >>> bits) | 0);
      return (low >>> bits) | ((high&ander) << (32 - bits));
    }
    setTempRet0((0) | 0);
    return (high >>> (bits - 32))|0;
}
function _bitshift64Shl(low, high, bits) {
    low = low|0; high = high|0; bits = bits|0;
    var ander = 0;
    if ((bits|0) < 32) {
      ander = ((1 << bits) - 1)|0;
      setTempRet0(((high << bits) | ((low&(ander << (32 - bits))) >>> (32 - bits))) | 0);
      return low << bits;
    }
    setTempRet0((low << (bits - 32)) | 0);
    return 0;
}
function _i64Add(a, b, c, d) {
    /*
      x = a + b*2^32
      y = c + d*2^32
      result = l + h*2^32
    */
    a = a|0; b = b|0; c = c|0; d = d|0;
    var l = 0, h = 0;
    l = (a + c)>>>0;
    h = (b + d + (((l>>>0) < (a>>>0))|0))>>>0; // Add carry from low word to high word on overflow.
    return ((setTempRet0((h) | 0),l|0)|0);
}
function _i64Subtract(a, b, c, d) {
    a = a|0; b = b|0; c = c|0; d = d|0;
    var l = 0, h = 0;
    l = (a - c)>>>0;
    h = (b - d)>>>0;
    h = (b - d - (((c>>>0) > (a>>>0))|0))>>>0; // Borrow one from high word to low word on underflow.
    return ((setTempRet0((h) | 0),l|0)|0);
}
function _memcpy(dest, src, num) {
    dest = dest|0; src = src|0; num = num|0;
    var ret = 0;
    var aligned_dest_end = 0;
    var block_aligned_dest_end = 0;
    var dest_end = 0;
    // Test against a benchmarked cutoff limit for when HEAPU8.set() becomes faster to use.
    if ((num|0) >= 8192) {
      _emscripten_memcpy_big(dest|0, src|0, num|0)|0;
      return dest|0;
    }

    ret = dest|0;
    dest_end = (dest + num)|0;
    if ((dest&3) == (src&3)) {
      // The initial unaligned < 4-byte front.
      while (dest & 3) {
        if ((num|0) == 0) return ret|0;
        HEAP8[((dest)>>0)]=((HEAP8[((src)>>0)])|0);
        dest = (dest+1)|0;
        src = (src+1)|0;
        num = (num-1)|0;
      }
      aligned_dest_end = (dest_end & -4)|0;
      block_aligned_dest_end = (aligned_dest_end - 64)|0;
      while ((dest|0) <= (block_aligned_dest_end|0) ) {
        HEAP32[((dest)>>2)]=((HEAP32[((src)>>2)])|0);
        HEAP32[(((dest)+(4))>>2)]=((HEAP32[(((src)+(4))>>2)])|0);
        HEAP32[(((dest)+(8))>>2)]=((HEAP32[(((src)+(8))>>2)])|0);
        HEAP32[(((dest)+(12))>>2)]=((HEAP32[(((src)+(12))>>2)])|0);
        HEAP32[(((dest)+(16))>>2)]=((HEAP32[(((src)+(16))>>2)])|0);
        HEAP32[(((dest)+(20))>>2)]=((HEAP32[(((src)+(20))>>2)])|0);
        HEAP32[(((dest)+(24))>>2)]=((HEAP32[(((src)+(24))>>2)])|0);
        HEAP32[(((dest)+(28))>>2)]=((HEAP32[(((src)+(28))>>2)])|0);
        HEAP32[(((dest)+(32))>>2)]=((HEAP32[(((src)+(32))>>2)])|0);
        HEAP32[(((dest)+(36))>>2)]=((HEAP32[(((src)+(36))>>2)])|0);
        HEAP32[(((dest)+(40))>>2)]=((HEAP32[(((src)+(40))>>2)])|0);
        HEAP32[(((dest)+(44))>>2)]=((HEAP32[(((src)+(44))>>2)])|0);
        HEAP32[(((dest)+(48))>>2)]=((HEAP32[(((src)+(48))>>2)])|0);
        HEAP32[(((dest)+(52))>>2)]=((HEAP32[(((src)+(52))>>2)])|0);
        HEAP32[(((dest)+(56))>>2)]=((HEAP32[(((src)+(56))>>2)])|0);
        HEAP32[(((dest)+(60))>>2)]=((HEAP32[(((src)+(60))>>2)])|0);
        dest = (dest+64)|0;
        src = (src+64)|0;
      }
      while ((dest|0) < (aligned_dest_end|0) ) {
        HEAP32[((dest)>>2)]=((HEAP32[((src)>>2)])|0);
        dest = (dest+4)|0;
        src = (src+4)|0;
      }
    } else {
      // In the unaligned copy case, unroll a bit as well.
      aligned_dest_end = (dest_end - 4)|0;
      while ((dest|0) < (aligned_dest_end|0) ) {
        HEAP8[((dest)>>0)]=((HEAP8[((src)>>0)])|0);
        HEAP8[(((dest)+(1))>>0)]=((HEAP8[(((src)+(1))>>0)])|0);
        HEAP8[(((dest)+(2))>>0)]=((HEAP8[(((src)+(2))>>0)])|0);
        HEAP8[(((dest)+(3))>>0)]=((HEAP8[(((src)+(3))>>0)])|0);
        dest = (dest+4)|0;
        src = (src+4)|0;
      }
    }
    // The remaining unaligned < 4 byte tail.
    while ((dest|0) < (dest_end|0)) {
      HEAP8[((dest)>>0)]=((HEAP8[((src)>>0)])|0);
      dest = (dest+1)|0;
      src = (src+1)|0;
    }
    return ret|0;
}
function _memset(ptr, value, num) {
    ptr = ptr|0; value = value|0; num = num|0;
    var end = 0, aligned_end = 0, block_aligned_end = 0, value4 = 0;
    end = (ptr + num)|0;

    value = value & 0xff;
    if ((num|0) >= 67 /* 64 bytes for an unrolled loop + 3 bytes for unaligned head*/) {
      while ((ptr&3) != 0) {
        HEAP8[((ptr)>>0)]=value;
        ptr = (ptr+1)|0;
      }

      aligned_end = (end & -4)|0;
      value4 = value | (value << 8) | (value << 16) | (value << 24);

      block_aligned_end = (aligned_end - 64)|0;

      while((ptr|0) <= (block_aligned_end|0)) {
        HEAP32[((ptr)>>2)]=value4;
        HEAP32[(((ptr)+(4))>>2)]=value4;
        HEAP32[(((ptr)+(8))>>2)]=value4;
        HEAP32[(((ptr)+(12))>>2)]=value4;
        HEAP32[(((ptr)+(16))>>2)]=value4;
        HEAP32[(((ptr)+(20))>>2)]=value4;
        HEAP32[(((ptr)+(24))>>2)]=value4;
        HEAP32[(((ptr)+(28))>>2)]=value4;
        HEAP32[(((ptr)+(32))>>2)]=value4;
        HEAP32[(((ptr)+(36))>>2)]=value4;
        HEAP32[(((ptr)+(40))>>2)]=value4;
        HEAP32[(((ptr)+(44))>>2)]=value4;
        HEAP32[(((ptr)+(48))>>2)]=value4;
        HEAP32[(((ptr)+(52))>>2)]=value4;
        HEAP32[(((ptr)+(56))>>2)]=value4;
        HEAP32[(((ptr)+(60))>>2)]=value4;
        ptr = (ptr + 64)|0;
      }

      while ((ptr|0) < (aligned_end|0) ) {
        HEAP32[((ptr)>>2)]=value4;
        ptr = (ptr+4)|0;
      }
    }
    // The remaining bytes.
    while ((ptr|0) < (end|0)) {
      HEAP8[((ptr)>>0)]=value;
      ptr = (ptr+1)|0;
    }
    return (end-num)|0;
}
function _sbrk(increment) {
    increment = increment|0;
    var oldDynamicTop = 0;
    var oldDynamicTopOnChange = 0;
    var newDynamicTop = 0;
    var totalMemory = 0;
    totalMemory = _emscripten_get_heap_size()|0;

      oldDynamicTop = HEAP32[DYNAMICTOP_PTR>>2]|0;
      newDynamicTop = oldDynamicTop + increment | 0;

      if (((increment|0) > 0 & (newDynamicTop|0) < (oldDynamicTop|0)) // Detect and fail if we would wrap around signed 32-bit int.
        | (newDynamicTop|0) < 0) { // Also underflow, sbrk() should be able to be used to subtract.
        abortOnCannotGrowMemory(newDynamicTop|0)|0;
        ___setErrNo(12);
        return -1;
      }

      if ((newDynamicTop|0) > (totalMemory|0)) {
        if (_emscripten_resize_heap(newDynamicTop|0)|0) {
          // We resized the heap. Start another loop iteration if we need to.
        } else {
          // We failed to resize the heap.
          ___setErrNo(12);
          return -1;
        }
      }

      HEAP32[DYNAMICTOP_PTR>>2] = newDynamicTop|0;

    return oldDynamicTop|0;
}

  


// EMSCRIPTEN_END_FUNCS


  return { ___errno_location: ___errno_location, ___muldi3: ___muldi3, _bitshift64Ashr: _bitshift64Ashr, _bitshift64Lshr: _bitshift64Lshr, _bitshift64Shl: _bitshift64Shl, _create_keypair: _create_keypair, _free: _free, _i64Add: _i64Add, _i64Subtract: _i64Subtract, _malloc: _malloc, _memcpy: _memcpy, _memset: _memset, _sbrk: _sbrk, _sign: _sign, _verify: _verify, establishStackSpace: establishStackSpace, stackAlloc: stackAlloc, stackRestore: stackRestore, stackSave: stackSave };
})
// EMSCRIPTEN_END_ASM
(asmGlobalArg, asmLibraryArg, buffer);

var ___errno_location = Module["___errno_location"] = asm["___errno_location"];
var ___muldi3 = Module["___muldi3"] = asm["___muldi3"];
var _bitshift64Ashr = Module["_bitshift64Ashr"] = asm["_bitshift64Ashr"];
var _bitshift64Lshr = Module["_bitshift64Lshr"] = asm["_bitshift64Lshr"];
var _bitshift64Shl = Module["_bitshift64Shl"] = asm["_bitshift64Shl"];
var _create_keypair = Module["_create_keypair"] = asm["_create_keypair"];
var _free = Module["_free"] = asm["_free"];
var _i64Add = Module["_i64Add"] = asm["_i64Add"];
var _i64Subtract = Module["_i64Subtract"] = asm["_i64Subtract"];
var _malloc = Module["_malloc"] = asm["_malloc"];
var _memcpy = Module["_memcpy"] = asm["_memcpy"];
var _memset = Module["_memset"] = asm["_memset"];
var _sbrk = Module["_sbrk"] = asm["_sbrk"];
var _sign = Module["_sign"] = asm["_sign"];
var _verify = Module["_verify"] = asm["_verify"];
var establishStackSpace = Module["establishStackSpace"] = asm["establishStackSpace"];
var stackAlloc = Module["stackAlloc"] = asm["stackAlloc"];
var stackRestore = Module["stackRestore"] = asm["stackRestore"];
var stackSave = Module["stackSave"] = asm["stackSave"];
;



// === Auto-generated postamble setup entry stuff ===

Module['asm'] = asm;











































































if (memoryInitializer) {
  if (!isDataURI(memoryInitializer)) {
    memoryInitializer = locateFile(memoryInitializer);
  }
  if (ENVIRONMENT_IS_NODE || ENVIRONMENT_IS_SHELL) {
    var data = Module['readBinary'](memoryInitializer);
    HEAPU8.set(data, GLOBAL_BASE);
  } else {
    addRunDependency('memory initializer');
    var applyMemoryInitializer = function(data) {
      if (data.byteLength) data = new Uint8Array(data);
      HEAPU8.set(data, GLOBAL_BASE);
      // Delete the typed array that contains the large blob of the memory initializer request response so that
      // we won't keep unnecessary memory lying around. However, keep the XHR object itself alive so that e.g.
      // its .status field can still be accessed later.
      if (Module['memoryInitializerRequest']) delete Module['memoryInitializerRequest'].response;
      removeRunDependency('memory initializer');
    }
    var doBrowserLoad = function() {
      Module['readAsync'](memoryInitializer, applyMemoryInitializer, function() {
        throw 'could not load memory initializer ' + memoryInitializer;
      });
    }
    var memoryInitializerBytes = tryParseAsDataURI(memoryInitializer);
    if (memoryInitializerBytes) {
      applyMemoryInitializer(memoryInitializerBytes.buffer);
    } else
    if (Module['memoryInitializerRequest']) {
      // a network request has already been created, just use that
      var useRequest = function() {
        var request = Module['memoryInitializerRequest'];
        var response = request.response;
        if (request.status !== 200 && request.status !== 0) {
          var data = tryParseAsDataURI(Module['memoryInitializerRequestURL']);
          if (data) {
            response = data.buffer;
          } else {
            // If you see this warning, the issue may be that you are using locateFile and defining it in JS. That
            // means that the HTML file doesn't know about it, and when it tries to create the mem init request early, does it to the wrong place.
            // Look in your browser's devtools network console to see what's going on.
            console.warn('a problem seems to have happened with Module.memoryInitializerRequest, status: ' + request.status + ', retrying ' + memoryInitializer);
            doBrowserLoad();
            return;
          }
        }
        applyMemoryInitializer(response);
      }
      if (Module['memoryInitializerRequest'].response) {
        setTimeout(useRequest, 0); // it's already here; but, apply it asynchronously
      } else {
        Module['memoryInitializerRequest'].addEventListener('load', useRequest); // wait for it
      }
    } else {
      // fetch it from the network ourselves
      doBrowserLoad();
    }
  }
}



/**
 * @constructor
 * @extends {Error}
 * @this {ExitStatus}
 */
function ExitStatus(status) {
  this.name = "ExitStatus";
  this.message = "Program terminated with exit(" + status + ")";
  this.status = status;
};
ExitStatus.prototype = new Error();
ExitStatus.prototype.constructor = ExitStatus;

var calledMain = false;

dependenciesFulfilled = function runCaller() {
  // If run has never been called, and we should call run (INVOKE_RUN is true, and Module.noInitialRun is not false)
  if (!Module['calledRun']) run();
  if (!Module['calledRun']) dependenciesFulfilled = runCaller; // try this again later, after new deps are fulfilled
}





/** @type {function(Array=)} */
function run(args) {
  args = args || Module['arguments'];

  if (runDependencies > 0) {
    return;
  }


  preRun();

  if (runDependencies > 0) return; // a preRun added a dependency, run will be called later
  if (Module['calledRun']) return; // run may have just been called through dependencies being fulfilled just in this very frame

  function doRun() {
    if (Module['calledRun']) return; // run may have just been called while the async setStatus time below was happening
    Module['calledRun'] = true;

    if (ABORT) return;

    ensureInitRuntime();

    preMain();

    if (Module['onRuntimeInitialized']) Module['onRuntimeInitialized']();


    postRun();
  }

  if (Module['setStatus']) {
    Module['setStatus']('Running...');
    setTimeout(function() {
      setTimeout(function() {
        Module['setStatus']('');
      }, 1);
      doRun();
    }, 1);
  } else {
    doRun();
  }
}
Module['run'] = run;


function exit(status, implicit) {

  // if this is just main exit-ing implicitly, and the status is 0, then we
  // don't need to do anything here and can just leave. if the status is
  // non-zero, though, then we need to report it.
  // (we may have warned about this earlier, if a situation justifies doing so)
  if (implicit && Module['noExitRuntime'] && status === 0) {
    return;
  }

  if (Module['noExitRuntime']) {
  } else {

    ABORT = true;
    EXITSTATUS = status;

    exitRuntime();

    if (Module['onExit']) Module['onExit'](status);
  }

  Module['quit'](status, new ExitStatus(status));
}

var abortDecorators = [];

function abort(what) {
  if (Module['onAbort']) {
    Module['onAbort'](what);
  }

  if (what !== undefined) {
    out(what);
    err(what);
    what = '"' + what + '"';
  } else {
    what = '';
  }

  ABORT = true;
  EXITSTATUS = 1;

  throw 'abort(' + what + '). Build with -s ASSERTIONS=1 for more info.';
}
Module['abort'] = abort;

if (Module['preInit']) {
  if (typeof Module['preInit'] == 'function') Module['preInit'] = [Module['preInit']];
  while (Module['preInit'].length > 0) {
    Module['preInit'].pop()();
  }
}


  Module["noExitRuntime"] = true;

run();





// {{MODULE_ADDITIONS}}



if ('undefined' !== typeof module) module.exports = Module;
