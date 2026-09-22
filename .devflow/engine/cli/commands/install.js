/**
 * devflow install
 *
 * Install pre-commit and pre-push hooks on a cloned repo.
 * From spec section 22.1: devflow install — 30 seconds.
 */

'use strict';

const { installPreCommitHook, installPrePushHook } = require('../../core/hooks');
const orchestrator = require('../../core/orchestrator');

function install(repoRoot) {
  const result = installPreCommitHook(repoRoot);

  if (result.existing) {
    console.log('devflow: Pre-commit hook updated.');
  } else {
    console.log('devflow: Pre-commit hook installed.');
  }

  // Install pre-push hook if test-runner module is active
  try {
    const { plan } = orchestrator.loadPlan(repoRoot);
    const hasTests = plan.ciOnPush.jobs.some(j => j.tool === 'test' && j.command);
    if (hasTests) {
      const config = plan._config || {};
      const testing = config.testing || {};
      if (testing.prePush !== false) {
        const pushResult = installPrePushHook(repoRoot, { timeout: testing.prePushTimeout || 30 });
        if (pushResult.existing) {
          console.log('devflow: Pre-push hook updated.');
        } else {
          console.log('devflow: Pre-push hook installed.');
        }
      }
    }
  } catch {
    // No plan loaded yet — skip pre-push (run devflow init first)
  }
}

module.exports = install;
