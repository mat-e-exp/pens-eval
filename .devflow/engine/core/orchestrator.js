/**
 * Orchestrator
 *
 * The central coordination point. Wires together:
 * - Stack detection
 * - Config reading
 * - Module loading
 * - Platform adapter selection
 * - Enforcement plan building
 *
 * Used by CLI commands (init, check, update) and never called directly
 * by adapters or modules.
 */

'use strict';

const { detectStacks } = require('../config/stack-detector');
const { readConfig, writeConfig, ensureConfigDir } = require('../config/devflow-config');
const { buildPlan } = require('./enforcement-plan');
const { ensureRuleFiles } = require('./rule-files');
const { vendorEngine, shouldVendor } = require('./engine-vendor');
const { detectPlatform, getAdapter, registerBuiltins: registerPlatforms } = require('./platform-registry');
const { getApplicableModules, applyModules, registerBuiltins: registerModules } = require('../modules/module-registry');
const fs = require('fs');
const path = require('path');

let initialized = false;

/**
 * Initialize registries. Called once.
 */
function ensureInitialized() {
  if (initialized) return;
  registerPlatforms();
  registerModules();
  initialized = true;
}

/**
 * Run the full init flow for a repository.
 *
 * @param {string} repoRoot - Absolute path to repository root
 * @param {Object} [options]
 * @param {string} [options.platform] - Force a specific platform
 * @returns {Object} { plan, files, stacks, platform }
 */
function init(repoRoot, options = {}) {
  ensureInitialized();

  // 1. Detect stacks
  const stacks = detectStacks(repoRoot);
  if (stacks.length === 0) {
    throw new Error('No supported language stacks detected in this repository');
  }

  // 2. Detect or use specified platform
  const platform = options.platform || detectPlatform(repoRoot) || 'github-actions';

  // 3. Read existing config or create defaults
  const config = readConfig(repoRoot);
  config.platform = platform;
  config.stacks = stacks;

  // 4. Build enforcement plan
  let plan = buildPlan({
    stacks,
    platform,
    configOverrides: config,
  });

  // Attach context for modules that need filesystem access
  plan._repoRoot = repoRoot;
  plan._config = config;

  // 5. Apply applicable modules
  const modules = getApplicableModules(repoRoot, config);
  if (modules.length > 0) {
    plan = applyModules(plan, modules);
  }

  // 6. Generate CI config files
  const adapter = getAdapter(platform);
  const files = adapter.generate(plan);

  // 7. Validate generated files
  const validation = adapter.validate(files);
  if (!validation.valid) {
    throw new Error(`Generated CI config is invalid:\n  ${validation.errors.join('\n  ')}`);
  }

  // 8. Write files
  ensureConfigDir(repoRoot);
  writeConfig(repoRoot, config);

  // Rule files must exist in the repo — every hook and CI job references
  // them by repo-relative path (DEC-027)
  ensureRuleFiles(repoRoot);

  // Gates that run inside devflow have no tool for a runner to install, so
  // the engine is vendored and committed with the repo (DEC-031)
  if (shouldVendor(config)) vendorEngine(repoRoot);

  for (const file of files) {
    const filePath = path.join(repoRoot, file.path);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, file.content);
  }

  return { plan, files, stacks, platform, modules: modules.map(m => m.id) };
}

/**
 * Build an enforcement plan for an existing configured repo.
 * Used by `devflow check` and `devflow update`.
 *
 * @param {string} repoRoot
 * @returns {Object} { plan, platform }
 */
function loadPlan(repoRoot) {
  ensureInitialized();

  const config = readConfig(repoRoot);
  const stacks = detectStacks(repoRoot);

  // Keep the repo's rule-file copies current — a devflow upgrade ships new
  // patterns and every hook references them by repo-relative path (DEC-027)
  try {
    ensureRuleFiles(repoRoot);
  } catch {
    // Read-only checkout — hooks that need a rule file will report it themselves
  }

  if (stacks.length === 0) {
    throw new Error('No supported language stacks detected');
  }

  const platform = config.platform || detectPlatform(repoRoot) || 'github-actions';

  let plan = buildPlan({
    stacks,
    platform,
    configOverrides: config,
  });

  // Attach context for modules that need filesystem access
  plan._repoRoot = repoRoot;
  plan._config = config;

  const modules = getApplicableModules(repoRoot, config);
  if (modules.length > 0) {
    plan = applyModules(plan, modules);
  }

  return { plan, platform };
}

/**
 * Regenerate CI config for an existing repo (devflow update).
 *
 * @param {string} repoRoot
 * @returns {Object} { plan, files, platform }
 */
function update(repoRoot) {
  const { plan, platform } = loadPlan(repoRoot);
  if (shouldVendor(plan._config || {})) vendorEngine(repoRoot);
  const adapter = getAdapter(platform);
  const files = adapter.generate(plan);

  const validation = adapter.validate(files);
  if (!validation.valid) {
    throw new Error(`Generated CI config is invalid:\n  ${validation.errors.join('\n  ')}`);
  }

  for (const file of files) {
    if (!file.overwrite) continue;
    const filePath = path.join(repoRoot, file.path);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, file.content);
  }

  return { plan, files, platform };
}

module.exports = {
  init,
  loadPlan,
  update,
};
