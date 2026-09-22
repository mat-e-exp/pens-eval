/**
 * Lockfile Gate Module
 *
 * Not in spec v5 — see DEC-029. Blocks a commit that changes a manifest's
 * dependency declarations without updating the lockfile beside it.
 *
 * The lockfile is what makes an install reproducible and reviewable. When a
 * dependency is added to `package.json` and `package-lock.json` is left
 * behind, CI resolves versions nobody chose and nobody tested, and a
 * compromised release of a transitive dependency lands without a diff to
 * review. Adding a package by editing the manifest directly — rather than
 * running the install command that refreshes the lockfile — is a routine
 * outcome of AI-assisted editing, because the manifest is the file in view.
 *
 * Behaviour:
 *   - pre-commit: a staged manifest whose dependency declarations changed
 *     while its lockfile is unstaged → fail CLOSED. A manifest with no
 *     lockfile anywhere is a warning, so a repo that never had one can
 *     still commit.
 *   - full check: every tracked manifest with no lockfile → one
 *     non-blocking warning (debt).
 *   - bypass: `devflow override --rule lockfile-gate --reason "..."`
 *   - config: `failPolicy.lockfile`
 *
 * Comparison is semantic, not textual: editing a script, a version field or
 * tool configuration in a manifest does not trip the gate. Runs inside
 * devflow, so the hook carries `internal: true` (DEC-023).
 */

'use strict';

const { scanStaged, scanRange, scanTracked, ECOSYSTEMS } = require('../core/lockfile-scanner');

const { engineEntry } = require('../core/engine-vendor');

const HOOK_ID = 'lockfile-gate';
const TOOL = 'lockfile';

/** @type {ModuleDefinition} */
const lockfileGateModule = {
  id: HOOK_ID,
  name: 'Lockfile Gate',
  type: 'quality-gate',
  version: '1.0.0',
  optional: false,

  // No detect(): a repo with no manifest simply produces no hits.

  extendPlan(plan) {
    const config = plan._config || {};
    const failPolicy = (plan.failPolicy && plan.failPolicy[TOOL]) || 'closed';

    const hook = {
      id: HOOK_ID,
      tool: TOOL,
      command: 'devflow',
      args: [],
      scope: '**/*',
      failPolicy,
      severity: 'high',
      internal: true,
      stagedOnly: true,
    };

    // The gate has no external tool a runner could install, so CI runs the
    // engine vendored into the repository (DEC-031). Without this the gate
    // exists only in a local hook, which `--no-verify` skips.
    const job = {
      id: HOOK_ID,
      name: 'Lockfile gate',
      tool: TOOL,
      command: 'node',
      args: [],
      ciRun: `node ${engineEntry(config)} check --gate ${HOOK_ID}`,
      scope: '**/*',
      failPolicy,
      severity: 'high',
      needsFullHistory: true,
    };

    const hooks = plan.preCommit.hooks.some(h => h.id === HOOK_ID)
      ? plan.preCommit.hooks
      : [...plan.preCommit.hooks, hook];

    const jobs = plan.ciOnPush.jobs.some(j => j.id === HOOK_ID)
      ? plan.ciOnPush.jobs
      : [...plan.ciOnPush.jobs, job];

    return {
      ...plan,
      preCommit: { ...plan.preCommit, hooks },
      ciOnPush: { ...plan.ciOnPush, jobs },
      failPolicy: { ...plan.failPolicy, [TOOL]: failPolicy },
    };
  },

  /**
   * Run the gate. Called by `devflow check` for hooks with `internal: true`.
   *
   * @param {Object} ctx
   * @param {string} ctx.repoRoot
   * @param {'pre-commit'|'full'} ctx.mode
   * @param {string[]} [ctx.stagedFiles]
   * @returns {{hits: import('../core/lockfile-scanner').LockfileHit[], scanned: number, mode: string}}
   */
  run({ repoRoot, mode, stagedFiles = [], range }) {
    let result;
    if (mode === 'pre-commit') {
      result = scanStaged(repoRoot, stagedFiles);
    } else if (mode === 'range') {
      result = scanRange(repoRoot, range);
    } else {
      result = scanTracked(repoRoot);
    }
    return { ...result, mode };
  },

  ecosystems: ECOSYSTEMS,
};

module.exports = lockfileGateModule;
