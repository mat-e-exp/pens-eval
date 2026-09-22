/**
 * GitLab CI Platform Adapter
 *
 * Generates .gitlab-ci.yml from an EnforcementPlan.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { generateGitLabConfig } = require('./templates');

/** @type {PlatformAdapter} */
const adapter = {
  id: 'gitlab-ci',
  displayName: 'GitLab CI',
  supportedLayers: ['ci-on-push', 'pr-gate', 'merge-gate', 'audit'],
  canCommentOnPR: true,

  generate(plan) {
    return generateGitLabConfig(plan);
  },

  validate(files) {
    const errors = [];
    for (const file of files) {
      if (!file.content || typeof file.content !== 'string') {
        errors.push(`File content must be a non-empty string: ${file.path}`);
      }
    }
    return { valid: errors.length === 0, errors };
  },

  detect(repoRoot) {
    return fs.existsSync(path.join(repoRoot, '.gitlab-ci.yml'));
  },
};

module.exports = adapter;
