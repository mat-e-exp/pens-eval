/**
 * Git Hook Manager
 *
 * Installs and manages pre-commit hooks. Hooks are shell scripts
 * that call `devflow check --pre-commit`. They work on all platforms
 * including Windows (Git Bash).
 *
 * From spec: pre-commit must complete in < 15 seconds.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const HOOK_MARKER = '# devflow-managed — do not edit below this line';

/**
 * Generate the pre-commit hook script content.
 * Uses POSIX shell for Git Bash compatibility on Windows.
 *
 * @returns {string}
 */
function generatePreCommitScript() {
  return `#!/bin/sh
${HOOK_MARKER}
# Pre-commit hook installed by devflow
# Runs enforcement checks on staged files before commit

# Prefer the engine vendored in this repository: it is the version this repo
# pins, it needs nothing installed beyond Node, and it is the same code CI runs.
ENGINE=".devflow/engine/cli/index.js"

if [ -f "$ENGINE" ] && command -v node >/dev/null 2>&1; then
  DEVFLOW="node $ENGINE"
else
  DEVFLOW=$(command -v devflow 2>/dev/null)
  if [ -z "$DEVFLOW" ]; then
    if npx --no-install devflow version >/dev/null 2>&1; then
      DEVFLOW="npx --no-install devflow"
    else
      echo "devflow: not found, and no vendored engine in .devflow/engine/."
      echo "Commit checks are NOT running. Some gates exist only here and are"
      echo "not repeated in CI — run 'devflow init' to restore enforcement."
      exit 0
    fi
  fi
fi

# Run pre-commit checks
$DEVFLOW check --pre-commit --staged-only

EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "devflow: pre-commit checks failed."
  echo "Fix the issues above, or use 'devflow override' to document a bypass."
  echo ""
  exit 1
fi

exit 0
`;
}

/**
 * Install the pre-commit hook in a repository.
 *
 * @param {string} repoRoot - Absolute path to repository root
 * @returns {{ installed: boolean, path: string, existing: boolean }}
 */
function installPreCommitHook(repoRoot) {
  const hooksDir = path.join(repoRoot, '.git', 'hooks');
  const hookPath = path.join(hooksDir, 'pre-commit');

  // Check if .git exists
  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    throw new Error('Not a git repository. Run git init first.');
  }

  // Ensure hooks directory exists
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  // Check for existing hook
  let existing = false;
  if (fs.existsSync(hookPath)) {
    const content = fs.readFileSync(hookPath, 'utf8');
    if (content.includes(HOOK_MARKER)) {
      // Already installed by devflow — overwrite with latest
      existing = true;
    } else {
      // User has their own hook — prepend devflow before it so both run.
      // Strip the shebang from the existing hook (devflow's script provides one).
      const existingBody = content.replace(/^#!.*\n/, '');
      const devflowScript = generatePreCommitScript();
      // Remove the final "exit 0" from devflow's script so the existing hook runs after
      const devflowBody = devflowScript.replace(/\nexit 0\n$/, '\n');
      const merged = devflowBody + '\n# --- Original pre-commit hook ---\n' + existingBody;
      fs.writeFileSync(hookPath, merged);
      fs.chmodSync(hookPath, '755');
      return { installed: true, path: hookPath, existing: true };
    }
  }

  fs.writeFileSync(hookPath, generatePreCommitScript());
  fs.chmodSync(hookPath, '755');

  return { installed: true, path: hookPath, existing };
}

/**
 * Generate the pre-push hook script content.
 * Runs tests before push. Killed if exceeding timeout.
 *
 * @param {number} [timeout=30] - Timeout in seconds
 * @returns {string}
 */
function generatePrePushScript(timeout = 30) {
  return `#!/bin/sh
${HOOK_MARKER}
# Pre-push hook installed by devflow
# Runs tests before push to catch breakage early

# Prefer the engine vendored in this repository (see the pre-commit hook).
ENGINE=".devflow/engine/cli/index.js"

if [ -f "$ENGINE" ] && command -v node >/dev/null 2>&1; then
  DEVFLOW="node $ENGINE"
else
  DEVFLOW=$(command -v devflow 2>/dev/null)
  if [ -z "$DEVFLOW" ]; then
    if npx --no-install devflow version >/dev/null 2>&1; then
      DEVFLOW="npx --no-install devflow"
    else
      echo "devflow: not found. Skipping pre-push tests."
      exit 0
    fi
  fi
fi

# Run tests with timeout
echo "devflow: running tests before push..."
if command -v timeout >/dev/null 2>&1; then
  timeout ${timeout} $DEVFLOW check --pre-push
elif command -v gtimeout >/dev/null 2>&1; then
  gtimeout ${timeout} $DEVFLOW check --pre-push
else
  $DEVFLOW check --pre-push
fi

EXIT_CODE=$?

if [ $EXIT_CODE -eq 124 ]; then
  echo ""
  echo "devflow: tests exceeded ${timeout}s timeout. Push allowed — CI will gate."
  exit 0
fi

if [ $EXIT_CODE -ne 0 ]; then
  echo ""
  echo "devflow: tests failed. Fix before pushing, or push with --no-verify."
  echo ""
  exit 1
fi

exit 0
`;
}

/**
 * Install the pre-push hook in a repository.
 *
 * @param {string} repoRoot - Absolute path to repository root
 * @param {Object} [options]
 * @param {number} [options.timeout=30] - Timeout in seconds
 * @returns {{ installed: boolean, path: string, existing: boolean }}
 */
function installPrePushHook(repoRoot, options = {}) {
  const hooksDir = path.join(repoRoot, '.git', 'hooks');
  const hookPath = path.join(hooksDir, 'pre-push');
  const timeout = options.timeout || 30;

  if (!fs.existsSync(path.join(repoRoot, '.git'))) {
    throw new Error('Not a git repository. Run git init first.');
  }

  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  let existing = false;
  if (fs.existsSync(hookPath)) {
    const content = fs.readFileSync(hookPath, 'utf8');
    if (content.includes(HOOK_MARKER)) {
      existing = true;
    } else {
      // User has their own hook — prepend devflow
      const existingBody = content.replace(/^#!.*\n/, '');
      const devflowScript = generatePrePushScript(timeout);
      const devflowBody = devflowScript.replace(/\nexit 0\n$/, '\n');
      const merged = devflowBody + '\n# --- Original pre-push hook ---\n' + existingBody;
      fs.writeFileSync(hookPath, merged);
      fs.chmodSync(hookPath, '755');
      return { installed: true, path: hookPath, existing: true };
    }
  }

  fs.writeFileSync(hookPath, generatePrePushScript(timeout));
  fs.chmodSync(hookPath, '755');

  return { installed: true, path: hookPath, existing };
}

/**
 * Remove the devflow pre-push hook.
 *
 * @param {string} repoRoot
 * @returns {boolean}
 */
function removePrePushHook(repoRoot) {
  const hookPath = path.join(repoRoot, '.git', 'hooks', 'pre-push');

  if (!fs.existsSync(hookPath)) return false;

  const content = fs.readFileSync(hookPath, 'utf8');
  if (!content.includes(HOOK_MARKER)) return false;

  const ORIGINAL_MARKER = '# --- Original pre-push hook ---';

  if (!content.includes(ORIGINAL_MARKER)) {
    fs.unlinkSync(hookPath);
    return true;
  }

  const idx = content.indexOf(ORIGINAL_MARKER);
  const originalBody = content.slice(idx + ORIGINAL_MARKER.length).trimStart();
  const restored = '#!/bin/sh\n' + originalBody;
  fs.writeFileSync(hookPath, restored);
  fs.chmodSync(hookPath, '755');
  return true;
}

/**
 * Check if devflow pre-push hook is installed.
 *
 * @param {string} repoRoot
 * @returns {boolean}
 */
function isPrePushHookInstalled(repoRoot) {
  const hookPath = path.join(repoRoot, '.git', 'hooks', 'pre-push');
  if (!fs.existsSync(hookPath)) return false;
  const content = fs.readFileSync(hookPath, 'utf8');
  return content.includes(HOOK_MARKER);
}

/**
 * Remove the devflow pre-commit hook.
 *
 * @param {string} repoRoot
 * @returns {boolean} Whether a hook was removed
 */
function removePreCommitHook(repoRoot) {
  const hookPath = path.join(repoRoot, '.git', 'hooks', 'pre-commit');

  if (!fs.existsSync(hookPath)) return false;

  const content = fs.readFileSync(hookPath, 'utf8');
  if (!content.includes(HOOK_MARKER)) return false;

  const ORIGINAL_MARKER = '# --- Original pre-commit hook ---';

  // If no original hook was merged, the entire file is devflow's — remove it
  if (!content.includes(ORIGINAL_MARKER)) {
    fs.unlinkSync(hookPath);
    return true;
  }

  // Restore the original hook (everything after the separator)
  const idx = content.indexOf(ORIGINAL_MARKER);
  const originalBody = content.slice(idx + ORIGINAL_MARKER.length).trimStart();
  const restored = '#!/bin/sh\n' + originalBody;
  fs.writeFileSync(hookPath, restored);
  fs.chmodSync(hookPath, '755');
  return true;
}

/**
 * Check if devflow pre-commit hook is installed.
 *
 * @param {string} repoRoot
 * @returns {boolean}
 */
function isHookInstalled(repoRoot) {
  const hookPath = path.join(repoRoot, '.git', 'hooks', 'pre-commit');
  if (!fs.existsSync(hookPath)) return false;
  const content = fs.readFileSync(hookPath, 'utf8');
  return content.includes(HOOK_MARKER);
}

module.exports = {
  generatePreCommitScript,
  installPreCommitHook,
  removePreCommitHook,
  isHookInstalled,
  generatePrePushScript,
  installPrePushHook,
  removePrePushHook,
  isPrePushHookInstalled,
  HOOK_MARKER,
};
