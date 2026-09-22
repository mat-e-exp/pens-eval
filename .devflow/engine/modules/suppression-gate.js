/**
 * Suppression Gate Module
 *
 * Not in spec v5 — see DEC-022. Blocks new inline suppressions (ESLint,
 * Ruff/flake8, TypeScript, Bandit/gosec, Semgrep, coverage and test-skip
 * annotations — full table in ../core/suppression-scanner.js) from entering
 * the codebase via the pre-commit hook. The most common
 * "fix" for a lint or SAST finding in AI-assisted code is to silence the
 * tool; every other gate trusts the tool's exit code, so this is the gap.
 *
 * Behaviour:
 *   - pre-commit: fail CLOSED on suppressions in ADDED lines of the staged diff.
 *     Existing suppressions are never re-flagged — retrofits do not block.
 *   - full check: reports all existing suppressions as a single non-blocking
 *     warning (debt), never a failure.
 *   - bypass: `devflow override --rule suppression-gate --reason "..."`
 *     (reason required, 30-day expiry, logged with identity).
 *
 * Runs inside devflow itself (no external tool), so the hook carries
 * `internal: true` and `check` dispatches it directly instead of shelling out.
 * It does not appear in CI until devflow is installable on runners (STATUS.md).
 */

'use strict';

const { scanStaged, scanRange, scanTracked, PATTERNS } = require('../core/suppression-scanner');

const { engineEntry } = require('../core/engine-vendor');

const HOOK_ID = 'suppression-gate';
const TOOL = 'suppression';

/** @type {ModuleDefinition} */
const suppressionGateModule = {
  id: HOOK_ID,
  name: 'Suppression Gate',
  type: 'quality-gate',
  version: '1.0.0',
  optional: false,

  // No detect(): applies to every repo. Patterns are extension-scoped, so
  // a repo with no matching files simply produces no hits.

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
      name: 'Suppression gate',
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
    };
  },

  /**
   * Run the gate. Called by `devflow check` for hooks with `internal: true`.
   *
   * @param {Object} ctx
   * @param {string} ctx.repoRoot
   * @param {Object} [ctx.config] - Parsed .devflow/config.yml
   * @param {'pre-commit'|'full'} ctx.mode
   * @param {string[]} [ctx.stagedFiles]
   * @returns {{hits: import('../core/suppression-scanner').SuppressionHit[], scanned: number, mode: string}}
   */
  run({ repoRoot, config = {}, mode, stagedFiles = [], range }) {
    let result;
    if (mode === 'pre-commit') {
      result = scanStaged(repoRoot, stagedFiles, config);
    } else if (mode === 'range') {
      result = scanRange(repoRoot, range, config);
    } else {
      result = scanTracked(repoRoot, config);
    }
    return { ...result, mode };
  },

  patterns: PATTERNS,
};

module.exports = suppressionGateModule;
