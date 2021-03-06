module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/eslint-recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript',
    'prettier/@typescript-eslint',
  ],
  rules: {
    'no-empty-function': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    'no-irregular-whitespace': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    'no-var-requires': 'off',
    '@typescript-eslint/no-var-requires': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-use-before-define': 'off',
    'no-fallthrough': 'off',
    '@typescript-eslint/camelcase': 'off',
  },
  env: {
    browser: true,
    node: true,
  },
};
