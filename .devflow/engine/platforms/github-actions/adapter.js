/**
 * GitHub Actions Platform Adapter
 *
 * Reference implementation. Generates .github/workflows/ YAML files
 * from an EnforcementPlan. Never calls the GitHub API — produces files only.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { generateWorkflows } = require('./templates');

/** @type {PlatformAdapter} */
const adapter = {
  id: 'github-actions',
  displayName: 'GitHub Actions',
  supportedLayers: ['ci-on-push', 'pr-gate', 'merge-gate', 'audit'],
  canCommentOnPR: true,

  /**
   * Generate CI config files from an enforcement plan.
   *
   * @param {EnforcementPlan} plan
   * @returns {FileOutput[]}
   */
  generate(plan) {
    return generateWorkflows(plan);
  },

  /**
   * Validate generated files are structurally sound.
   *
   * @param {FileOutput[]} files
   * @returns {ValidationResult}
   */
  validate(files) {
    const errors = [];

    for (const file of files) {
      if (!file.path.startsWith('.github/workflows/')) {
        errors.push(`File path must start with .github/workflows/: ${file.path}`);
      }
      if (!file.path.endsWith('.yml') && !file.path.endsWith('.yaml')) {
        errors.push(`File must have .yml or .yaml extension: ${file.path}`);
      }
      if (!file.content || typeof file.content !== 'string') {
        errors.push(`File content must be a non-empty string: ${file.path}`);
      }
    }

    return { valid: errors.length === 0, errors };
  },

  /**
   * Detect if a repository uses GitHub Actions.
   *
   * @param {string} repoRoot
   * @returns {boolean}
   */
  detect(repoRoot) {
    return fs.existsSync(path.join(repoRoot, '.github'));
  },
};

module.exports = adapter;
