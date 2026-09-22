/**
 * Platform Adapter Contract
 *
 * Every CI platform adapter must export an object conforming to this shape.
 * No abstract class — duck-typed with runtime validation on registration.
 *
 * @typedef {Object} FileOutput
 * @property {string} path - Output file path relative to repo root (e.g. ".github/workflows/devflow.yml")
 * @property {string} content - File content (typically YAML)
 * @property {boolean} overwrite - Whether devflow manages this file (true = overwrite on update)
 *
 * @typedef {Object} ValidationResult
 * @property {boolean} valid
 * @property {string[]} errors
 *
 * @typedef {Object} PlatformAdapter
 * @property {string} id - Platform identifier ("github-actions" | "gitlab-ci" | "bitbucket-pipelines")
 * @property {string} displayName - Human-readable name
 * @property {string[]} supportedLayers - Layers this platform can express ("ci-on-push", "pr-gate", "merge-gate", "audit")
 * @property {boolean} canCommentOnPR - Whether platform supports PR comments natively
 * @property {function(EnforcementPlan): FileOutput[]} generate - Generate CI config files from plan
 * @property {function(FileOutput[]): ValidationResult} validate - Validate generated output
 * @property {function(string): boolean} detect - Detect if repo uses this platform (given repo root path)
 */

'use strict';

const REQUIRED_FIELDS = ['id', 'displayName', 'supportedLayers', 'canCommentOnPR'];
const REQUIRED_METHODS = ['generate', 'validate', 'detect'];
const VALID_LAYERS = ['ci-on-push', 'pr-gate', 'merge-gate', 'audit'];

/**
 * Validate that an adapter conforms to the platform adapter contract.
 * Called at registration time — fail fast on bad adapters.
 *
 * @param {PlatformAdapter} adapter
 * @throws {Error} if adapter does not conform
 */
function validateAdapter(adapter) {
  const errors = [];

  for (const field of REQUIRED_FIELDS) {
    if (adapter[field] === undefined || adapter[field] === null) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  for (const method of REQUIRED_METHODS) {
    if (typeof adapter[method] !== 'function') {
      errors.push(`Missing or non-function method: ${method}`);
    }
  }

  if (adapter.supportedLayers) {
    if (!Array.isArray(adapter.supportedLayers)) {
      errors.push('supportedLayers must be an array');
    } else {
      for (const layer of adapter.supportedLayers) {
        if (!VALID_LAYERS.includes(layer)) {
          errors.push(`Unknown layer in supportedLayers: ${layer}. Valid: ${VALID_LAYERS.join(', ')}`);
        }
      }
    }
  }

  if (typeof adapter.canCommentOnPR !== 'boolean') {
    errors.push('canCommentOnPR must be a boolean');
  }

  if (errors.length > 0) {
    throw new Error(`Invalid platform adapter "${adapter.id || 'unknown'}":\n  ${errors.join('\n  ')}`);
  }
}

/**
 * Consolidate jobs that use the same command, tool, and language into a single
 * job with all paths combined. Global tools (no language) are left untouched.
 *
 * @param {CIJob[]} jobs
 * @returns {CIJob[]}
 */
function consolidateJobs(jobs) {
  const groups = new Map();
  const result = [];

  for (const job of jobs) {
    if (!job.language) {
      result.push(job);
      continue;
    }

    const key = `${job.command}:${job.tool}:${job.language}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(job);
  }

  for (const [, groupJobs] of groups) {
    if (groupJobs.length === 1) {
      result.push(groupJobs[0]);
      continue;
    }

    const paths = groupJobs.map(j => j.args[j.args.length - 1]);
    const baseArgs = groupJobs[0].args.slice(0, -1);

    result.push({
      ...groupJobs[0],
      id: `${groupJobs[0].id.replace(/-[^-]+$/, '')}`,
      name: `${groupJobs[0].language} ${groupJobs[0].tool === 'lint' ? 'lint' : 'security scan'}`,
      args: [...baseArgs, ...paths],
      scope: '**/*',
    });
  }

  return result;
}

module.exports = {
  validateAdapter,
  consolidateJobs,
  VALID_LAYERS,
};
