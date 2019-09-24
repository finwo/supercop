#!/usr/bin/env node

// Makes usage easier to write
function print(str, ...args) {
  for (let index in args) {
    if (!Object.prototype.hasOwnPropert.call(args,index)) continue;
    str = str.split('{'+index+'}').join(args[index]);
  }
  return process.stdout.write(str);
}

// We'll use this a lot
function getRef(ref, path) {
  if ('string' === typeof path) path = path.split('.');
  if (!Array.isArray(path)) return undefined;
  path = path.slice();
  while (path.length) {
    let key = path.shift();
    ref     = ref[key] = ref[key] || {};
  }
  return ref;
}

function pathParent(path) {
  if ('string' === typeof path) path = path.split('.');
  path = path.slice();
  path.pop();
  return path;
}

function pathBase(path) {
  if ('string' === typeof path) path = path.split('.');
  return path.slice().pop();
}

const fs       = require('fs');
const argv     = require('minimist')(process.argv.slice(2));
const commands = {
  set: {
    args: 2,
    fn  : function(db, key, value) {
      let last = pathBase(key);
      let ref  = getRef(db,pathParent(key));
      try {
        ref[last] = JSON.parse(value);
      } catch (e) {
        ref[last] = value;
      }
    },
  },
  push: {
    args: 2,
    fn  : function(db, key, value) {
      let last = pathBase(key);
      let ref  = getRef(db,pathParent(key));
      ref      = ref[last] = ref[last] || [];
      try {
        ref.push(JSON.parse(value));
      } catch (e) {
        ref.push(value);
      }
    },
  },
};


// Handle help (including subjects)
if (argv.help) {
  switch (argv.help) {
    default:
      print('\n');
      print('Usage: {0} --file <file> [options] command {arguments} [ command {arguments} [..] ]\n', process.argv[1].split('/').pop());
      print('\n');
      print('Options:\n');
      print('  --help [subject]    Show global usage or subject specific\n');
      print('\n');
      print('Commands:\n');
      print('  set  <key> <value>  Set value at a specific path\n');
      print('  push <key> <value>  Push value at a specific path\n');
      print('\n');
      break;
  }
  process.exit(0);
}

// Load the file
const db = require(process.cwd()+'/'+argv.file);

(async function next () {
  if (!argv._.length) return;
  const command = argv._.shift();
  if (!commands[command]) return next();
  const cmd  = commands[command];
  const args = argv._.slice(0,cmd.args);
  argv._     = argv._.slice(cmd.args);
  await cmd.fn(db,...args);
  fs.writeFile(process.cwd()+'/'+argv.file, JSON.stringify(db,null,2)+'\n', err => {
    if (err) throw err;
    next();
  });
})();
