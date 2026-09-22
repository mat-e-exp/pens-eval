/**
 * Bitbucket Pipelines Platform Adapter
 *
 * Generates bitbucket-pipelines.yml from an EnforcementPlan.
 * Bitbucket has no native path filtering — uses git diff conditionals.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { generateBitbucketConfig } = require('./templates');

/** @type {PlatformAdapter} */
const adapter = {
  id: 'bitbucket-pipelines',
  displayName: 'Bitbucket Pipelines',
  supportedLayers: ['ci-on-push', 'pr-gate', 'audit'],
  canCommentOnPR: true,

  generate(plan) {
    return generateBitbucketConfig(plan);
  },

  validate(files) {
    const errors = [];
    for (const file of files) {
      if (file.path !== 'bitbucket-pipelines.yml') {
        errors.push(`Expected bitbucket-pipelines.yml, got: ${file.path}`);
      }
      if (!file.content || typeof file.content !== 'string') {
        errors.push(`File content must be a non-empty string: ${file.path}`);
      }
    }
    return { valid: errors.length === 0, errors };
  },

  detect(repoRoot) {
    return fs.existsSync(path.join(repoRoot, 'bitbucket-pipelines.yml'));
  },
};

module.exports = adapter;
