/**
 * Lockfile Scanner
 *
 * Detects the two ways a dependency change escapes review:
 *
 *   1. A manifest declares a dependency change but the lockfile is not
 *      updated in the same commit. CI then resolves versions that nobody
 *      reviewed and that differ from what the author tested against.
 *   2. The project has no lockfile at all, so every install resolves
 *      differently and a compromised or broken release lands silently.
 *
 * Both are ordinary in AI-assisted work: a package gets added to the
 * manifest because that is the file being edited, and the install step
 * that would refresh the lockfile is never run.
 *
 * Manifest changes are compared semantically, not by raw diff, so editing
 * a script, a version field or tool configuration never trips the gate.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

/**
 * @typedef {Object} Ecosystem
 * @property {string} id
 * @property {string} manifest - Manifest filename
 * @property {string[]} lockfiles - Accepted lockfile names, any one satisfies
 * @property {string} refresh - Command that regenerates the lockfile
 */

/** @type {Ecosystem[]} */
const ECOSYSTEMS = [
  {
    id: 'npm',
    manifest: 'package.json',
    lockfiles: ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lockb'],
    refresh: 'npm install (or yarn / pnpm install)',
  },
  {
    id: 'cargo',
    manifest: 'Cargo.toml',
    lockfiles: ['Cargo.lock'],
    refresh: 'cargo build',
  },
  {
    id: 'go',
    manifest: 'go.mod',
    lockfiles: ['go.sum'],
    refresh: 'go mod tidy',
  },
  {
    id: 'bundler',
    manifest: 'Gemfile',
    lockfiles: ['Gemfile.lock'],
    refresh: 'bundle install',
  },
  {
    id: 'poetry',
    manifest: 'pyproject.toml',
    lockfiles: ['poetry.lock', 'uv.lock', 'pdm.lock', 'requirements.txt'],
    refresh: 'poetry lock (or uv lock / pdm lock / pip-compile)',
  },
  {
    id: 'pipenv',
    manifest: 'Pipfile',
    lockfiles: ['Pipfile.lock'],
    refresh: 'pipenv lock',
  },
];

/** package.json keys that declare dependencies. */
const NPM_DEP_KEYS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'overrides', 'resolutions'];

/**
 * TOML section headers whose contents declare dependencies in pyproject.toml.
 * Anything else in that file (tool config, build metadata) is ignored.
 */
const PYPROJECT_DEP_SECTIONS = [
  /^\[project\]$/,
  /^\[project\.optional-dependencies(\..+)?\]$/,
  /^\[build-system\]$/,
  /^\[tool\.poetry\.dependencies\]$/,
  /^\[tool\.poetry\.dev-dependencies\]$/,
  /^\[tool\.poetry\.group\..+\.dependencies\]$/,
  /^\[tool\.pdm\.dev-dependencies\]$/,
  /^\[tool\.uv(\..+)?\]$/,
];

/** Keys inside `[project]` that declare dependencies. */
const PYPROJECT_PROJECT_KEYS = /^(dependencies|requires-python|optional-dependencies)\b/;

/**
 * Paths whose manifests are not the repository's own: devflow's vendored
 * engine carries a package.json, and dependency directories carry hundreds.
 */
const IGNORED_PREFIXES = ['.devflow/', 'node_modules/', 'vendor/'];

function isIgnoredPath(file) {
  const norm = String(file).replace(/\\/g, '/');
  return IGNORED_PREFIXES.some(p => norm === p.replace(/\/$/, '') || norm.startsWith(p));
}

function ecosystemForManifest(file) {
  if (isIgnoredPath(file)) return null;
  const base = path.basename(file);
  return ECOSYSTEMS.find(e => e.manifest === base) || null;
}

/**
 * Read a file at a git revision. Returns null when it does not exist there.
 */
function readAtRev(repoRoot, rev, file) {
  try {
    // execFileSync, not a shell string: a filename may contain quotes or
    // shell metacharacters, and git takes the spec as a single argument.
    return execFileSync('git', ['show', `${rev}:${file}`], {
      cwd: repoRoot, stdio: 'pipe', maxBuffer: 20 * 1024 * 1024,
    }).toString();
  } catch {
    return null;
  }
}

/**
 * Significant lines of a plain requirements/Gemfile/go.mod style manifest:
 * blank lines and comments carry no dependency meaning.
 */
function significantLines(text) {
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && !l.startsWith('//'));
}

/**
 * Significant lines of a pyproject.toml — only those inside a section that
 * declares dependencies, so editing tool configuration never trips the gate.
 */
function pyprojectDependencyLines(text) {
  const kept = [];
  let inDepSection = false;
  let inProject = false;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('[')) {
      inProject = /^\[project\]$/.test(line);
      inDepSection = PYPROJECT_DEP_SECTIONS.some(re => re.test(line));
      continue;
    }

    if (!inDepSection) continue;
    // Inside [project], only the dependency keys matter — not name, version, authors
    if (inProject && !PYPROJECT_PROJECT_KEYS.test(line) && !kept.length) continue;
    kept.push(line);
  }
  return kept;
}

/**
 * Dependency declarations of a package.json, as a stable string.
 * Returns null when the JSON cannot be parsed.
 */
function npmDependencySnapshot(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const snapshot = {};
  for (const key of NPM_DEP_KEYS) {
    if (parsed && parsed[key] && typeof parsed[key] === 'object') {
      snapshot[key] = Object.keys(parsed[key]).sort().map(name => `${name}@${JSON.stringify(parsed[key][name])}`);
    }
  }
  return JSON.stringify(snapshot);
}

/**
 * Whether a manifest's dependency declarations differ between two revisions.
 * Falls back to "changed" when content cannot be compared, so the gate errs
 * toward asking rather than staying silent.
 *
 * @returns {boolean}
 */
function dependenciesChanged(ecosystem, before, after) {
  if (before === null) return true; // manifest is new
  if (after === null) return false; // manifest deleted — nothing to lock

  if (ecosystem.id === 'npm') {
    const a = npmDependencySnapshot(before);
    const b = npmDependencySnapshot(after);
    if (a === null || b === null) return before.trim() !== after.trim();
    return a !== b;
  }

  if (ecosystem.manifest === 'pyproject.toml') {
    return pyprojectDependencyLines(before).join('\n') !== pyprojectDependencyLines(after).join('\n');
  }

  return significantLines(before).join('\n') !== significantLines(after).join('\n');
}

/**
 * Lockfile that exists next to a manifest, if any.
 *
 * @returns {string|null} repo-relative path
 */
function findLockfile(repoRoot, manifestFile, ecosystem) {
  const dir = path.dirname(manifestFile);
  for (const name of ecosystem.lockfiles) {
    const rel = dir === '.' ? name : `${dir}/${name}`;
    if (fs.existsSync(path.join(repoRoot, rel))) return rel;
  }
  return null;
}

/**
 * @typedef {Object} LockfileHit
 * @property {'stale-lockfile'|'missing-lockfile'} type
 * @property {string} manifest - repo-relative manifest path
 * @property {string|null} lockfile - repo-relative lockfile path, when one exists
 * @property {string} ecosystem
 * @property {string} refresh - command that fixes it
 * @property {string} description
 */

/**
 * Pre-commit scan: manifests in the staged set whose dependency declarations
 * changed without their lockfile being staged alongside.
 *
 * A manifest with no lockfile anywhere is reported as `missing-lockfile`,
 * which the module treats as non-blocking debt — a repo that never had one
 * must not be unable to commit.
 *
 * @param {string} repoRoot
 * @param {string[]} stagedFiles
 * @returns {{hits: LockfileHit[], scanned: number}}
 */
function scanStaged(repoRoot, stagedFiles) {
  const staged = new Set(stagedFiles);
  const hits = [];
  let scanned = 0;

  for (const file of stagedFiles) {
    const ecosystem = ecosystemForManifest(file);
    if (!ecosystem) continue;
    scanned++;

    const before = readAtRev(repoRoot, 'HEAD', file);
    const after = readAtRev(repoRoot, '', file); // "git show :path" — the staged copy
    if (!dependenciesChanged(ecosystem, before, after)) continue;

    const lockfile = findLockfile(repoRoot, file, ecosystem);

    if (!lockfile) {
      hits.push({
        type: 'missing-lockfile',
        manifest: file,
        lockfile: null,
        ecosystem: ecosystem.id,
        refresh: ecosystem.refresh,
        description: `${file} declares dependencies but the project has no lockfile — every install resolves different versions`,
      });
      continue;
    }

    if (!staged.has(lockfile)) {
      hits.push({
        type: 'stale-lockfile',
        manifest: file,
        lockfile,
        ecosystem: ecosystem.id,
        refresh: ecosystem.refresh,
        description: `${file} changed its dependencies but ${lockfile} is not part of this commit`,
      });
    }
  }

  return { hits, scanned };
}

/**
 * Scan a commit range. CI mode.
 *
 * The same question pre-commit asks, asked where it cannot be skipped:
 * did anything in this range change a manifest's dependencies without
 * changing its lockfile? Catches `--no-verify` and developers who never
 * installed devflow.
 *
 * @param {string} repoRoot
 * @param {string} range - Any git range, e.g. "origin/main...HEAD"
 * @returns {{hits: LockfileHit[], scanned: number}}
 */
function scanRange(repoRoot, range) {
  let changed;
  try {
    changed = execFileSync('git', ['diff', '--name-only', '--diff-filter=ACMD', range], {
      cwd: repoRoot, stdio: 'pipe', maxBuffer: 20 * 1024 * 1024,
    }).toString().trim().split('\n').filter(Boolean);
  } catch {
    return { hits: [], scanned: 0 };
  }

  const changedSet = new Set(changed);
  const hits = [];
  let scanned = 0;

  // Compare each manifest across the range rather than against the index.
  const [base] = range.split(/\.{2,3}/);

  for (const file of changed) {
    const ecosystem = ecosystemForManifest(file);
    if (!ecosystem) continue;
    scanned++;

    const before = readAtRev(repoRoot, base || 'HEAD', file);
    const after = readAtRev(repoRoot, 'HEAD', file);
    if (!dependenciesChanged(ecosystem, before, after)) continue;

    const lockfile = findLockfile(repoRoot, file, ecosystem);

    if (!lockfile) {
      hits.push({
        type: 'missing-lockfile',
        manifest: file,
        lockfile: null,
        ecosystem: ecosystem.id,
        refresh: ecosystem.refresh,
        description: `${file} declares dependencies but the project has no lockfile — every install resolves different versions`,
      });
      continue;
    }

    if (!changedSet.has(lockfile)) {
      hits.push({
        type: 'stale-lockfile',
        manifest: file,
        lockfile,
        ecosystem: ecosystem.id,
        refresh: ecosystem.refresh,
        description: `${file} changed its dependencies but ${lockfile} was not updated in this range`,
      });
    }
  }

  return { hits, scanned };
}

/**
 * Full scan: every tracked manifest that has no lockfile beside it.
 * Reported as debt, never as a failure.
 *
 * @param {string} repoRoot
 * @returns {{hits: LockfileHit[], scanned: number}}
 */
function scanTracked(repoRoot) {
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files'], { cwd: repoRoot, stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 })
      .toString().trim().split('\n').filter(Boolean);
  } catch {
    return { hits: [], scanned: 0 };
  }

  const hits = [];
  let scanned = 0;

  for (const file of tracked) {
    const ecosystem = ecosystemForManifest(file);
    if (!ecosystem) continue;
    scanned++;

    if (!findLockfile(repoRoot, file, ecosystem)) {
      hits.push({
        type: 'missing-lockfile',
        manifest: file,
        lockfile: null,
        ecosystem: ecosystem.id,
        refresh: ecosystem.refresh,
        description: `${file} has no lockfile — builds are not reproducible`,
      });
    }
  }

  return { hits, scanned };
}

module.exports = {
  ECOSYSTEMS,
  NPM_DEP_KEYS,
  ecosystemForManifest,
  isIgnoredPath,
  IGNORED_PREFIXES,
  dependenciesChanged,
  npmDependencySnapshot,
  pyprojectDependencyLines,
  significantLines,
  findLockfile,
  scanStaged,
  scanRange,
  scanTracked,
};
