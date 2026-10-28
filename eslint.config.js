// Delux crew — ESLint flat config (root).
//   npm run lint        ESLint over the source and the server scripts
//   npm run lint:fix    apply what can be applied automatically
//
// The office is plain ESM JavaScript: one bundled browser scene under src/,
// Node server scripts at the root, and node:test files. The rules below keep
// the real failure modes loud (undefined names, unreachable code, mistyped
// globals) while staying silent on this codebase's house style, which Prettier
// owns.
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

// `src/braingraph.js` is imported by both the browser bundle and `check.mjs`,
// so the scene files legitimately touch browser and Node globals alike.
const sharedGlobals = { ...globals.node, ...globals.browser };

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'data/**',
      'brain/**',
      'assets/**',
      'coverage/**',
      '.vercel/**',
      '.wrangler/**',
    ],
  },

  js.configs.recommended,

  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: sharedGlobals,
    },
    rules: {
      // Unused bindings are a warning, not a wall: this codebase carries a few
      // deliberate placeholders, but a typo'd variable still shows up.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      // `try {} catch {}` is used on purpose for optional machine features
      // (Claude login, connectors, provider probes).
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-constant-condition': ['error', { checkLoops: false }],
      // The office strips ANSI colour codes out of `claude mcp list` before
      // parsing it (mcp.mjs) — a control character in a regex is the point
      // there, not an accident.
      'no-control-regex': 'off',
      'no-console': 'off',
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  // Tests run under `node --test`, which injects the runner globals.
  {
    files: ['**/*.test.mjs'],
    languageOptions: {
      globals: { ...sharedGlobals, ...globals.nodeBuiltin },
    },
  },

  // Keep Prettier last so it can only disable conflicting stylistic rules.
  prettier,
];
