module.exports = {
  'root': true,
  'env' : {
    'browser' : true,
    'commonjs': true,
    'es2021'  : true,
    'node'    : true,
  },
  'extends': [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  'parser' : '@typescript-eslint/parser',
  'plugins': [
    '@typescript-eslint',
  ],
  'rules': {
    'indent'         : ['error', 2, { 'SwitchCase': 1 }],
    'linebreak-style': [ 'error', 'unix' ],
    'quotes'         : [ 'error', 'single' ],
    'semi'           : ['error', 'always'],
    'comma-dangle'   : ['error', {
      'arrays'   : 'always-multiline',
      'objects'  : 'always-multiline',
      'imports'  : 'always-multiline',
      'exports'  : 'always-multiline',
      'functions': 'never',
    }],
    '@typescript-eslint/no-explicit-any': 0,
    'key-spacing'                       : ['error', {'align': 'colon'}],
  },
};
