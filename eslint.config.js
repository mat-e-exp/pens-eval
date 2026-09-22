// Lint config for the browser dashboard (script.js). No package.json in this
// repo, so rules are listed directly rather than imported from @eslint/js.
// Lint is warning-only under devflow; it never blocks a commit.
export default [
    {
        files: ['script.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'script',
            globals: {
                window: 'readonly', document: 'readonly', console: 'readonly', fetch: 'readonly',
                localStorage: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
                setInterval: 'readonly', clearInterval: 'readonly', alert: 'readonly',
                FileReader: 'readonly', getComputedStyle: 'readonly', requestAnimationFrame: 'readonly',
                URLSearchParams: 'readonly', Intl: 'readonly', L: 'readonly'
            }
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { caughtErrors: 'none' }],
            'no-redeclare': 'error',
            'no-dupe-keys': 'error',
            'no-unreachable': 'error',
            'no-constant-condition': 'warn',
            'no-empty': ['warn', { allowEmptyCatch: true }],
            'eqeqeq': ['warn', 'smart']
        }
    }
];
