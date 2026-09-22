/**
 * Suppression Scanner
 *
 * Detects inline comments and annotations that silence a linter, type
 * checker, security scanner, coverage tool, or test runner. Every other
 * devflow gate trusts the tool's exit code — this one catches the case
 * where the code was changed to make the tool stop looking.
 *
 * Two modes:
 *   - staged: scans only ADDED lines in the staged diff. Used by pre-commit.
 *     Existing suppressions are never re-flagged, so retrofits do not block.
 *   - tracked: scans every tracked code file. Used by full `devflow check`
 *     to report existing suppression debt.
 *
 * Patterns are scoped by file extension so prose and config files that
 * mention a suppression token by name are not flagged.
 *
 * Config (.devflow/config.yml):
 *   suppressionAllow: [pattern-id, ...]      # pattern IDs to ignore
 *   suppressionIgnorePaths: [path, ...]      # path prefixes or **\/name globs to skip
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const JS = ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte'];
const PY = ['py', 'pyi'];
const GO = ['go'];
const RS = ['rs'];
const RB = ['rb', 'rake'];
const JAVA = ['java', 'kt', 'kts', 'scala'];
const IAC = ['tf', 'hcl', 'yaml', 'yml', 'json'];
const ALL_CODE = [...new Set([...JS, ...PY, ...GO, ...RS, ...RB, ...JAVA, ...IAC])];

/**
 * @typedef {Object} SuppressionPattern
 * @property {string} id - Stable identifier, usable in suppressionAllow
 * @property {string} category - "lint" | "type" | "security" | "coverage" | "test"
 * @property {RegExp} regex - Matched against a single line
 * @property {string[]} extensions - File extensions this pattern applies to
 * @property {string} description - What the token does
 */

/** @type {SuppressionPattern[]} */
const PATTERNS = [
  // ---- lint ----
  { id: 'eslint-disable', category: 'lint', extensions: JS,
    regex: /eslint-disable(?:-next-line|-line)?\b/,
    description: 'Disables ESLint for a line, block, or file' },
  { id: 'noqa', category: 'lint', extensions: PY,
    regex: /#\s*(?:ruff:\s*)?noqa\b/i,
    description: 'Silences Ruff/flake8 for a line or file' },
  { id: 'pylint-disable', category: 'lint', extensions: PY,
    regex: /#\s*pylint:\s*disable/i,
    description: 'Disables pylint checks' },
  { id: 'nolint', category: 'lint', extensions: GO,
    regex: /\/\/\s*nolint\b/,
    description: 'Silences golangci-lint' },
  { id: 'rubocop-disable', category: 'lint', extensions: RB,
    regex: /#\s*rubocop:\s*(?:disable|todo)\b/,
    description: 'Disables RuboCop cops' },
  { id: 'rust-allow', category: 'lint', extensions: RS,
    regex: /#!?\[allow\(/,
    description: 'Allows a Rust compiler or Clippy lint' },
  { id: 'suppress-warnings', category: 'lint', extensions: JAVA,
    regex: /@SuppressWarnings\s*\(/,
    description: 'Suppresses Java/Kotlin compiler and static analysis warnings' },

  // ---- type ----
  { id: 'ts-ignore', category: 'type', extensions: JS,
    regex: /@ts-ignore\b/,
    description: 'Hides a TypeScript error on the next line' },
  { id: 'ts-nocheck', category: 'type', extensions: JS,
    regex: /@ts-nocheck\b/,
    description: 'Disables TypeScript checking for the whole file' },
  { id: 'type-ignore', category: 'type', extensions: PY,
    regex: /#\s*type:\s*ignore\b/,
    description: 'Hides a mypy/pyright error' },

  // ---- security ----
  { id: 'nosec', category: 'security', extensions: [...PY, ...GO],
    regex: /#\s*nosec\b/,
    description: 'Silences Bandit or gosec' },
  { id: 'nosemgrep', category: 'security', extensions: ALL_CODE,
    regex: /(?:#|\/\/|\/\*)\s*nosemgrep\b/,
    description: 'Silences Semgrep' },
  { id: 'tfsec-ignore', category: 'security', extensions: IAC,
    regex: /#\s*tfsec:ignore/,
    description: 'Silences tfsec' },
  { id: 'trivy-ignore', category: 'security', extensions: IAC,
    regex: /#\s*trivy:ignore/,
    description: 'Silences Trivy misconfiguration checks' },
  { id: 'checkov-skip', category: 'security', extensions: IAC,
    regex: /#\s*checkov:skip/,
    description: 'Silences Checkov' },
  { id: 'tflint-ignore', category: 'security', extensions: IAC,
    regex: /#\s*tflint-ignore/,
    description: 'Silences tflint' },

  // ---- coverage ----
  { id: 'no-cover', category: 'coverage', extensions: PY,
    regex: /#\s*pragma:\s*no\s*cover\b/,
    description: 'Excludes code from Python coverage' },
  { id: 'coverage-ignore', category: 'coverage', extensions: JS,
    regex: /\/\*\s*(?:istanbul|c8|v8)\s+ignore/,
    description: 'Excludes code from JavaScript coverage' },

  // ---- test ----
  { id: 'test-only', category: 'test', extensions: JS,
    regex: /\b(?:it|test|describe)\.only\s*\(/,
    description: 'Runs only this test — silently skips the rest of the suite' },
  { id: 'test-skip', category: 'test', extensions: [...JS, ...RB],
    regex: /\b(?:it|test|describe)\.skip\s*\(|\bx(?:it|describe|test|context|specify)\b\s*[('"]/,
    description: 'Skips a test' },
  { id: 'pytest-skip', category: 'test', extensions: PY,
    regex: /@pytest\.mark\.(?:skip|skipif|xfail)\b|@unittest\.skip/,
    description: 'Skips or expects failure of a Python test' },
  { id: 'go-skip', category: 'test', extensions: GO,
    regex: /\bt\.Skip(?:f|Now)?\s*\(/,
    description: 'Skips a Go test' },
  { id: 'rust-ignore', category: 'test', extensions: RS,
    regex: /#\[ignore\b/,
    description: 'Ignores a Rust test' },
];

const DEFAULT_IGNORE_PATHS = [
  'node_modules/',
  'vendor/',
  'dist/',
  'build/',
  '.devflow/',
  '.git/',
  '**/*.min.js',
];

const MAX_FILE_BYTES = 1024 * 1024;

/**
 * @typedef {Object} SuppressionHit
 * @property {string} file
 * @property {number} line
 * @property {string} patternId
 * @property {string} category
 * @property {string} description
 * @property {string} text - Trimmed source line (max 120 chars)
 */

/**
 * Resolve scanner options from repo config.
 */
function resolveOptions(config = {}) {
  const allow = new Set(Array.isArray(config.suppressionAllow) ? config.suppressionAllow : []);
  const extraIgnore = Array.isArray(config.suppressionIgnorePaths) ? config.suppressionIgnorePaths : [];
  return {
    patterns: PATTERNS.filter(p => !allow.has(p.id)),
    ignorePaths: [...DEFAULT_IGNORE_PATHS, ...extraIgnore],
  };
}

function fileExtension(file) {
  const base = path.basename(file);
  const idx = base.lastIndexOf('.');
  return idx === -1 ? '' : base.slice(idx + 1).toLowerCase();
}

/**
 * Minimal path matcher — prefix, "**\/name", or "*.ext". No dependency.
 */
function isIgnored(file, ignorePaths) {
  const normalised = file.replace(/\\/g, '/');
  for (const pattern of ignorePaths) {
    if (pattern.startsWith('**/')) {
      const rest = pattern.slice(3);
      if (rest.startsWith('*.')) {
        if (normalised.endsWith(rest.slice(1))) return true;
      } else if (normalised === rest || normalised.endsWith('/' + rest)) {
        return true;
      }
    } else if (pattern.startsWith('*.')) {
      if (normalised.endsWith(pattern.slice(1))) return true;
    } else if (normalised === pattern || normalised.startsWith(pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Scan a set of lines. Returns hits for every pattern whose extension
 * list includes the file's extension.
 *
 * @param {string} file - Repo-relative path
 * @param {Array<{line:number, text:string}>} lines
 * @param {Object} options - From resolveOptions()
 * @returns {SuppressionHit[]}
 */
function scanLines(file, lines, options) {
  const ext = fileExtension(file);
  const applicable = options.patterns.filter(p => p.extensions.includes(ext));
  if (applicable.length === 0) return [];

  const hits = [];
  for (const { line, text } of lines) {
    for (const pattern of applicable) {
      if (pattern.regex.test(text)) {
        hits.push({
          file,
          line,
          patternId: pattern.id,
          category: pattern.category,
          description: pattern.description,
          text: text.trim().slice(0, 120),
        });
      }
    }
  }
  return hits;
}

/**
 * Scan full file content.
 */
function scanContent(file, content, options) {
  const lines = content.split('\n').map((text, i) => ({ line: i + 1, text }));
  return scanLines(file, lines, options);
}

/**
 * Parse `git diff -U0` output into added lines with their new line numbers.
 *
 * @param {string} diff
 * @returns {Array<{line:number, text:string}>}
 */
function parseAddedLines(diff) {
  const added = [];
  let newLine = 0;
  for (const raw of diff.split('\n')) {
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = parseInt(hunk[1], 10);
      continue;
    }
    if (raw.startsWith('+++') || raw.startsWith('---')) continue;
    if (raw.startsWith('+')) {
      added.push({ line: newLine, text: raw.slice(1) });
      newLine++;
    } else if (raw.startsWith('-')) {
      // removed line — new-side line number does not advance
    } else if (raw.startsWith(' ')) {
      newLine++;
    }
  }
  return added;
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, 8192);
  return sample.includes(0);
}

/**
 * Scan ADDED lines in the staged diff. Pre-commit mode.
 *
 * @param {string} repoRoot
 * @param {string[]} stagedFiles - Repo-relative paths (ACM filter)
 * @param {Object} [config]
 * @returns {{hits: SuppressionHit[], scanned: number}}
 */
function scanStaged(repoRoot, stagedFiles, config = {}) {
  const options = resolveOptions(config);
  const hits = [];
  let scanned = 0;

  for (const file of stagedFiles) {
    if (isIgnored(file, options.ignorePaths)) continue;
    if (!ALL_CODE.includes(fileExtension(file))) continue;

    let diff;
    try {
      diff = execSync(`git diff --cached -U0 --no-color -- "${file}"`, {
        cwd: repoRoot, stdio: 'pipe', maxBuffer: 16 * 1024 * 1024,
      }).toString();
    } catch {
      continue;
    }
    scanned++;
    hits.push(...scanLines(file, parseAddedLines(diff), options));
  }

  return { hits, scanned };
}

/**
 * Scan the added lines of a commit range. CI mode.
 *
 * This is the same question pre-commit asks — "did this change introduce a
 * suppression?" — asked again where it cannot be skipped. A developer who
 * commits with `--no-verify`, or who never installed devflow, is caught
 * here instead of not at all.
 *
 * @param {string} repoRoot
 * @param {string} range - Any git range, e.g. "origin/main...HEAD"
 * @param {Object} [config]
 * @returns {{hits: SuppressionHit[], scanned: number}}
 */
function scanRange(repoRoot, range, config = {}) {
  const options = resolveOptions(config);
  const hits = [];
  let scanned = 0;

  let changed;
  try {
    changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACM', range], {
      cwd: repoRoot, stdio: 'pipe', maxBuffer: 16 * 1024 * 1024,
    }).toString().trim().split('\n').filter(Boolean);
  } catch {
    return { hits, scanned };
  }

  for (const file of changed) {
    if (isIgnored(file, options.ignorePaths)) continue;
    if (!ALL_CODE.includes(fileExtension(file))) continue;

    let diff;
    try {
      diff = execFileSync('git', ['diff', '-U0', '--no-color', range, '--', file], {
        cwd: repoRoot, stdio: 'pipe', maxBuffer: 16 * 1024 * 1024,
      }).toString();
    } catch {
      continue;
    }
    scanned++;
    hits.push(...scanLines(file, parseAddedLines(diff), options));
  }

  return { hits, scanned };
}

/**
 * Scan every tracked code file. Full-check mode.
 *
 * @param {string} repoRoot
 * @param {Object} [config]
 * @returns {{hits: SuppressionHit[], scanned: number}}
 */
function scanTracked(repoRoot, config = {}) {
  const options = resolveOptions(config);
  let tracked;
  try {
    tracked = execSync('git ls-files', { cwd: repoRoot, stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 })
      .toString().trim().split('\n').filter(Boolean);
  } catch {
    return { hits: [], scanned: 0 };
  }

  const hits = [];
  let scanned = 0;
  for (const file of tracked) {
    if (isIgnored(file, options.ignorePaths)) continue;
    if (!ALL_CODE.includes(fileExtension(file))) continue;

    const abs = path.join(repoRoot, file);
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;

    const buffer = fs.readFileSync(abs);
    if (looksBinary(buffer)) continue;

    scanned++;
    hits.push(...scanContent(file, buffer.toString('utf8'), options));
  }

  return { hits, scanned };
}

module.exports = {
  PATTERNS,
  DEFAULT_IGNORE_PATHS,
  resolveOptions,
  isIgnored,
  scanLines,
  scanContent,
  parseAddedLines,
  scanStaged,
  scanRange,
  scanTracked,
};
