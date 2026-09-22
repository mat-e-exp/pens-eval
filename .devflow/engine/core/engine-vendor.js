/**
 * Engine Vendoring
 *
 * Copies devflow's own runtime source into `<repo>/.devflow/engine/` and
 * commits it with the repository.
 *
 * Gates that run inside devflow — the suppression gate and the lockfile
 * gate — have no external tool for a CI runner to install, so until now
 * they existed only as a local git hook. A hook is skippable with
 * `--no-verify` and absent entirely for anyone who never installed
 * devflow, which means those gates were not enforced by a machine at all.
 *
 * Vendoring resolves that without credentials, a registry or a network
 * call: the runner already checks out the repository, so the engine is
 * simply there. devflow has no runtime dependencies, so a file copy is a
 * complete install.
 *
 * Three further problems fall out of the same change:
 *   - Git hooks stop going stale. They invoke the vendored engine, so a
 *     fix to hook behaviour arrives with the engine rather than needing
 *     `devflow init` to be re-run in every repository.
 *   - Version skew becomes visible. The version in force is committed and
 *     shows up in a diff, instead of being whatever each developer
 *     happens to have installed.
 *   - Local and CI run identical code, by construction.
 *
 * The copy is overwritten on `init` and `update`, so upgrading is a
 * reviewable commit in each repository rather than a silent change.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Root of devflow's own source tree. */
const SOURCE_ROOT = path.join(__dirname, '..');

/** Repo-relative location of the vendored engine. */
const ENGINE_DIR = path.join('.devflow', 'engine');

/** Repo-relative path to the vendored CLI entry point, for hooks and CI. */
const ENGINE_ENTRY = '.devflow/engine/cli/index.js';

/**
 * Where hooks and CI should invoke devflow in a given repository.
 *
 * devflow's own repository is the exception: it *is* the engine, so a
 * vendored copy would be a duplicate that goes stale the moment `src/`
 * changes, and its CI would then test the stale copy. Such a repo sets
 * `engineEntry` in its config and opts out of vendoring.
 */
function engineEntry(config = {}) {
  return typeof config.engineEntry === 'string' && config.engineEntry
    ? config.engineEntry
    : ENGINE_ENTRY;
}

/** Whether this repository wants the engine vendored into it. */
function shouldVendor(config = {}) {
  return config.vendorEngine !== false;
}

/** Manifest recording what was vendored. */
const MANIFEST_NAME = 'devflow-engine.json';

/** Only these extensions are part of the runtime. */
const RUNTIME_EXTENSIONS = new Set(['.js', '.json', '.yaml', '.yml']);

/** Never vendored: tests, fixtures and anything not needed to run a check. */
const EXCLUDED_DIRS = new Set(['node_modules', '.git', '__tests__', 'test', 'tests']);

const { devflowVersion } = require('./version');

/**
 * Every runtime file under a directory, as paths relative to SOURCE_ROOT.
 */
function collectSourceFiles(dir = SOURCE_ROOT, base = SOURCE_ROOT, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      collectSourceFiles(full, base, acc);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!RUNTIME_EXTENSIONS.has(path.extname(entry.name))) continue;

    acc.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return acc;
}

/**
 * Read the manifest of an already-vendored engine.
 *
 * @returns {{version: string, files: string[]}|null}
 */
function readManifest(repoRoot) {
  try {
    const raw = fs.readFileSync(path.join(repoRoot, ENGINE_DIR, MANIFEST_NAME), 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Version of the engine vendored in a repository, or null when none is.
 */
function vendoredVersion(repoRoot) {
  const manifest = readManifest(repoRoot);
  return manifest && typeof manifest.version === 'string' ? manifest.version : null;
}

/**
 * Whether the vendored engine differs from the devflow running right now.
 * Used to tell a developer their repository is pinned to another version
 * rather than silently enforcing a different rule set.
 */
function isStale(repoRoot) {
  const vendored = vendoredVersion(repoRoot);
  return vendored !== null && vendored !== devflowVersion();
}

/**
 * Copy devflow's runtime source into `<repoRoot>/.devflow/engine/`.
 *
 * Files are written only when their content differs, so a no-op run
 * leaves the working tree clean. Files that are no longer part of the
 * runtime are removed, so an upgrade cannot leave an orphaned module
 * behind for `require` to find.
 *
 * @param {string} repoRoot
 * @returns {{version: string, written: string[], removed: string[], total: number, entry: string}}
 */
function vendorEngine(repoRoot) {
  const targetRoot = path.join(repoRoot, ENGINE_DIR);
  const files = collectSourceFiles();
  const version = devflowVersion();

  const written = [];
  for (const rel of files) {
    const src = path.join(SOURCE_ROOT, rel);
    const dest = path.join(targetRoot, rel);
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    const content = fs.readFileSync(src);
    if (!fs.existsSync(dest) || !fs.readFileSync(dest).equals(content)) {
      fs.writeFileSync(dest, content);
      written.push(rel);
    }
  }

  const previous = readManifest(repoRoot);
  const removed = [];
  if (previous && Array.isArray(previous.files)) {
    const current = new Set(files);
    for (const rel of previous.files) {
      if (current.has(rel)) continue;
      const stale = path.join(targetRoot, rel);
      if (fs.existsSync(stale)) {
        fs.rmSync(stale, { force: true });
        removed.push(rel);
      }
    }
  }

  // A manifest at the engine root makes the vendored copy self-describing
  // and lets the version lookup work from either layout.
  const enginePackage = path.join(targetRoot, 'package.json');
  const packageJson = JSON.stringify({
    name: '@mat-e-exp/devflow-engine',
    version,
    private: true,
    description: 'devflow engine vendored by devflow init/update. Do not edit.',
    main: 'cli/index.js',
  }, null, 2) + '\n';
  if (!fs.existsSync(enginePackage) || fs.readFileSync(enginePackage, 'utf8') !== packageJson) {
    fs.writeFileSync(enginePackage, packageJson);
    written.push('package.json');
  }

  const manifest = {
    version,
    generator: 'devflow',
    note: 'Vendored by devflow init/update. Do not edit — changes are overwritten.',
    files: files.slice().sort(),
  };
  const manifestPath = path.join(targetRoot, MANIFEST_NAME);
  const serialised = JSON.stringify(manifest, null, 2) + '\n';
  if (!fs.existsSync(manifestPath) || fs.readFileSync(manifestPath, 'utf8') !== serialised) {
    fs.writeFileSync(manifestPath, serialised);
    if (!written.includes(MANIFEST_NAME)) written.push(MANIFEST_NAME);
  }

  return { version, written, removed, total: files.length, entry: ENGINE_ENTRY };
}

module.exports = {
  SOURCE_ROOT,
  ENGINE_DIR,
  ENGINE_ENTRY,
  engineEntry,
  shouldVendor,
  MANIFEST_NAME,
  RUNTIME_EXTENSIONS,
  EXCLUDED_DIRS,
  devflowVersion,
  collectSourceFiles,
  readManifest,
  vendoredVersion,
  isStale,
  vendorEngine,
};
