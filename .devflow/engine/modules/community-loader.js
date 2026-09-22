/**
 * Community Module Loader
 *
 * From spec section 4.3: Third parties can build devflow modules.
 * Modules are declared in config and loaded with integrity verification.
 *
 * modules:
 *   - source: community/kotlin
 *     version: 1.2.0
 *     checksum: sha256:abc123...
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { validateModule } = require('./module-interface');

const COMMUNITY_DIR = '.devflow/modules';

/**
 * @typedef {Object} CommunityModuleSpec
 * @property {string} source - Module source (e.g. "community/kotlin")
 * @property {string} version - Semver version
 * @property {string} [checksum] - Expected SHA-256 checksum ("sha256:...")
 */

/**
 * Load a community module from the local modules directory.
 * Verifies checksum if provided.
 *
 * @param {string} repoRoot
 * @param {CommunityModuleSpec} spec
 * @returns {ModuleDefinition}
 */
function loadCommunityModule(repoRoot, spec) {
  const modulePath = resolveModulePath(repoRoot, spec);

  if (!fs.existsSync(modulePath)) {
    throw new Error(`Community module not found: ${spec.source}@${spec.version} (expected at ${modulePath})`);
  }

  // Verify checksum if provided
  if (spec.checksum) {
    verifyChecksum(modulePath, spec.checksum);
  }

  // Load the module
  const mod = require(modulePath);

  // Validate it conforms to the module interface
  validateModule(mod);

  return mod;
}

/**
 * Load all community modules declared in config.
 *
 * @param {string} repoRoot
 * @param {CommunityModuleSpec[]} specs
 * @returns {{ loaded: ModuleDefinition[], errors: string[] }}
 */
function loadAllCommunityModules(repoRoot, specs) {
  const loaded = [];
  const errors = [];

  for (const spec of specs) {
    try {
      const mod = loadCommunityModule(repoRoot, spec);
      loaded.push(mod);
    } catch (err) {
      errors.push(`${spec.source}@${spec.version}: ${err.message}`);
    }
  }

  return { loaded, errors };
}

/**
 * Resolve the filesystem path for a community module.
 */
function resolveModulePath(repoRoot, spec) {
  const safeName = spec.source.replace(/[^a-zA-Z0-9-_/]/g, '');
  return path.join(repoRoot, COMMUNITY_DIR, safeName, spec.version, 'index.js');
}

/**
 * Verify a module file's SHA-256 checksum.
 *
 * @param {string} filePath
 * @param {string} expected - Format: "sha256:hexstring"
 */
function verifyChecksum(filePath, expected) {
  const match = expected.match(/^sha256:([a-f0-9]{64})$/);
  if (!match) {
    throw new Error(`Invalid checksum format: ${expected}. Expected: sha256:<64 hex chars>`);
  }

  const content = fs.readFileSync(filePath);
  const actual = crypto.createHash('sha256').update(content).digest('hex');

  if (actual !== match[1]) {
    throw new Error(
      `Checksum mismatch for ${filePath}.\n` +
      `  Expected: ${match[1]}\n` +
      `  Actual:   ${actual}\n` +
      `  devflow refuses to load modules with mismatched checksums.`
    );
  }
}

/**
 * Generate checksum for a module file (for publishing).
 *
 * @param {string} filePath
 * @returns {string} "sha256:<hex>"
 */
function generateModuleChecksum(filePath) {
  const content = fs.readFileSync(filePath);
  const hash = crypto.createHash('sha256').update(content).digest('hex');
  return `sha256:${hash}`;
}

module.exports = {
  loadCommunityModule,
  loadAllCommunityModules,
  resolveModulePath,
  verifyChecksum,
  generateModuleChecksum,
  COMMUNITY_DIR,
};
