/**
 * Module Registry
 *
 * Manages built-in and optional modules. Handles loading, validation,
 * and integrity checking for community modules.
 *
 * From spec section 4.3: Community modules are declared in config
 * and loaded with integrity verification.
 */

'use strict';

const { validateModule } = require('./module-interface');

const modules = {};

/**
 * Register a module. Validates contract conformance.
 *
 * @param {ModuleDefinition} mod
 */
function register(mod) {
  validateModule(mod);
  modules[mod.id] = mod;
}

/**
 * Get a registered module by ID.
 *
 * @param {string} moduleId
 * @returns {ModuleDefinition}
 */
function getModule(moduleId) {
  const mod = modules[moduleId];
  if (!mod) {
    throw new Error(`No module registered: ${moduleId}. Available: ${listModules().join(', ')}`);
  }
  return mod;
}

/**
 * List all registered module IDs.
 *
 * @returns {string[]}
 */
function listModules() {
  return Object.keys(modules);
}

/**
 * Get all modules that apply to a given repo.
 *
 * @param {string} repoRoot
 * @param {Object} [config] - Per-repo config with enabled optional modules
 * @returns {ModuleDefinition[]}
 */
function getApplicableModules(repoRoot, config = {}) {
  const enabledOptional = config.modules || [];

  return Object.values(modules).filter(mod => {
    // Optional modules must be explicitly enabled
    if (mod.optional) {
      // If explicitly enabled in config, include regardless of detect()
      return enabledOptional.includes(mod.id);
    }

    // Non-optional modules: use detect() if available
    if (mod.detect) {
      return mod.detect(repoRoot);
    }

    // Non-optional modules without detection are always applicable
    return true;
  });
}

/**
 * Apply all applicable modules to an enforcement plan.
 * Modules that define extendPlan() modify the plan in sequence.
 *
 * @param {EnforcementPlan} plan
 * @param {ModuleDefinition[]} applicableModules
 * @returns {EnforcementPlan}
 */
function applyModules(plan, applicableModules) {
  let extendedPlan = { ...plan };

  for (const mod of applicableModules) {
    // Add module's pre-commit hooks
    if (mod.preCommitHooks) {
      extendedPlan.preCommit = {
        ...extendedPlan.preCommit,
        hooks: [...extendedPlan.preCommit.hooks, ...mod.preCommitHooks],
      };
    }

    // Add module's CI jobs
    if (mod.ciJobs) {
      extendedPlan.ciOnPush = {
        ...extendedPlan.ciOnPush,
        jobs: [...extendedPlan.ciOnPush.jobs, ...mod.ciJobs],
      };
    }

    // Let module extend the plan freely
    if (mod.extendPlan) {
      extendedPlan = mod.extendPlan(extendedPlan);
    }
  }

  // Deduplicate jobs by ID — modules may add jobs that extendPlan also adds
  const seen = new Set();
  extendedPlan.ciOnPush.jobs = extendedPlan.ciOnPush.jobs.filter(job => {
    if (seen.has(job.id)) return false;
    seen.add(job.id);
    return true;
  });

  // Modules contribute fail-closed jobs, so the merge gate is only correct
  // once they have all run (DEC-032).
  const { computeRequiredChecks } = require('../core/enforcement-plan');
  extendedPlan.mergeGate = {
    ...extendedPlan.mergeGate,
    requiredChecks: computeRequiredChecks(extendedPlan.ciOnPush.jobs),
  };

  return extendedPlan;
}

/**
 * Register all built-in modules.
 */
function registerBuiltins() {
  register(require('./sonarcloud'));
  register(require('./container-scanning'));
  register(require('./dependency-provenance'));
  register(require('./licence-compliance'));
  register(require('./test-runner'));
  register(require('./suppression-gate'));
  register(require('./dangerous-config'));
  register(require('./lockfile-gate'));
}

/**
 * Clear all registered modules (for testing).
 */
function clear() {
  for (const key of Object.keys(modules)) {
    delete modules[key];
  }
}

module.exports = {
  register,
  getModule,
  listModules,
  getApplicableModules,
  applyModules,
  registerBuiltins,
  clear,
};
