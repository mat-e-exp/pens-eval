/**
 * Platform Registry
 *
 * Maps platform IDs to adapter modules. Handles auto-detection of which
 * CI platform a repository uses based on filesystem markers.
 */

'use strict';

const { validateAdapter } = require('../platforms/platform-adapter');

const adapters = {};

/**
 * Register a platform adapter. Validates contract conformance.
 *
 * @param {PlatformAdapter} adapter
 */
function register(adapter) {
  validateAdapter(adapter);
  adapters[adapter.id] = adapter;
}

/**
 * Get a registered adapter by platform ID.
 *
 * @param {string} platformId
 * @returns {PlatformAdapter}
 * @throws {Error} if platform not registered
 */
function getAdapter(platformId) {
  const adapter = adapters[platformId];
  if (!adapter) {
    throw new Error(`No adapter registered for platform: ${platformId}. Available: ${listPlatforms().join(', ')}`);
  }
  return adapter;
}

/**
 * List all registered platform IDs.
 *
 * @returns {string[]}
 */
function listPlatforms() {
  return Object.keys(adapters);
}

/**
 * Auto-detect which CI platform a repository uses.
 * Checks filesystem markers via each adapter's detect() method.
 *
 * @param {string} repoRoot - Absolute path to repository root
 * @returns {string|null} Platform ID or null if none detected
 */
function detectPlatform(repoRoot) {
  for (const adapter of Object.values(adapters)) {
    if (adapter.detect(repoRoot)) {
      return adapter.id;
    }
  }
  return null;
}

/**
 * Register all built-in platform adapters.
 */
function registerBuiltins() {
  const github = require('../platforms/github-actions/adapter');
  const gitlab = require('../platforms/gitlab-ci/adapter');
  const bitbucket = require('../platforms/bitbucket-pipelines/adapter');

  register(github);
  register(gitlab);
  register(bitbucket);
}

module.exports = {
  register,
  getAdapter,
  listPlatforms,
  detectPlatform,
  registerBuiltins,
};
