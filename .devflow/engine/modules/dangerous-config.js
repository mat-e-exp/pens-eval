/**
 * Dangerous Configuration Module
 *
 * Not in spec v5 — see DEC-028. Runs devflow's own Semgrep ruleset
 * (`src/rules/universal/dangerous-config.yaml`, copied into the repo at
 * `.devflow/rules/`) against staged changes at pre-commit and the whole
 * repository in CI.
 *
 * The ruleset targets settings that make code "work" at the cost of a
 * security property, which is the shape of mistake AI-assisted and junior
 * code makes most often: TLS verification turned off to get past a
 * certificate error, debug mode left on, wildcard CORS paired with
 * credentials, a shell command built by string interpolation, secrets
 * printed to logs, hooks bypassed inside a script, CI workflows handing a
 * write token to untrusted input.
 *
 * Distinct from the generic `semgrep` CI job, which runs the community
 * `auto` config and fails OPEN. These rules are devflow's own, every one is
 * ERROR, and the gate fails CLOSED at pre-commit.
 *
 * Behaviour:
 *   - pre-commit: staged files only, fail CLOSED
 *   - CI: whole repo, fail CLOSED
 *   - bypass: `devflow override --rule dangerous-config --reason "..."`
 *   - config: `failPolicy.dangerous-config`, `dangerousConfigIgnorePaths`
 *
 * Semgrep is a documented prerequisite (DEC-007). When it is not installed
 * the hook skips with the usual message and CI catches the same rules.
 */

'use strict';

const { rulePath } = require('../core/rule-files');

const HOOK_ID = 'dangerous-config';
const TOOL = 'dangerous-config';
const RULE_FILE = 'dangerous-config.yaml';

/**
 * Semgrep arguments shared by the hook and the CI job.
 * The final argument is the scan target and is replaced with the staged
 * file list at pre-commit, so it must stay last.
 */
function semgrepArgs() {
  return [
    'scan',
    '--config', rulePath(RULE_FILE),
    '--error',
    '--metrics=off',
    '--quiet',
    '--disable-version-check',
    // JSON so devflow can print file, line and rule for each finding rather
    // than echoing semgrep's box-drawing output (DEC-028)
    '--json',
    // Trailing scan target — replaced with an explicit file list by check.js
    '.',
  ];
}

/**
 * Paths this repo excludes from the gate.
 *
 * Semgrep's `--exclude` filters directory traversal but NOT files named
 * explicitly on the command line, and devflow always names files explicitly,
 * so exclusion is applied by devflow (locally) and by a git pathspec (in CI)
 * rather than by semgrep.
 */
/** Always excluded: devflow's own vendored source is not the repo's code. */
const ALWAYS_IGNORED = ['.devflow'];

function ignorePaths(config = {}) {
  const configured = Array.isArray(config.dangerousConfigIgnorePaths)
    ? config.dangerousConfigIgnorePaths.map(String)
    : [];
  return [...ALWAYS_IGNORED, ...configured.filter(p => !ALWAYS_IGNORED.includes(p))];
}

/** @type {ModuleDefinition} */
const dangerousConfigModule = {
  id: HOOK_ID,
  name: 'Dangerous Configuration',
  type: 'security',
  version: '1.0.0',
  optional: false,

  // No detect(): the ruleset is multi-language and path-scoped per rule, so a
  // repo with no matching files simply produces no findings.

  extendPlan(plan) {
    const config = plan._config || {};
    const failPolicy = (plan.failPolicy && plan.failPolicy[TOOL]) || 'closed';
    const args = semgrepArgs();
    const ignore = ignorePaths(config);

    const hook = {
      id: HOOK_ID,
      tool: TOOL,
      command: 'semgrep',
      args,
      scope: '**/*',
      failPolicy,
      severity: 'high',
      stagedOnly: true,
      // check.js replaces the trailing '.' with the file list, minus ignorePaths
      scanTarget: 'staged-paths',
      ignorePaths: ignore,
    };

    // Semgrep's built-in ignore list skips test/, tests/ and similar when it
    // walks a directory, but honours explicitly named files. Pre-commit passes
    // staged paths, so CI feeds it the tracked file list to match — same
    // "git-tracked files only" rule as a full check (DEC-010, DEC-028).
    const scanArgs = args.slice(0, -1).join(' ');
    const pathspec = ignore.map(p => ` ':!${p}'`).join('');
    const job = {
      id: HOOK_ID,
      name: 'Dangerous configuration scan',
      tool: TOOL,
      command: 'semgrep',
      args,
      ciRun: `git ls-files -z --${pathspec} | xargs -0 -r semgrep ${scanArgs}`,
      scope: '**/*',
      failPolicy,
      severity: 'high',
      ignorePaths: ignore,
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
};

module.exports = dangerousConfigModule;
module.exports.semgrepArgs = semgrepArgs;
module.exports.ignorePaths = ignorePaths;
module.exports.ALWAYS_IGNORED = ALWAYS_IGNORED;
module.exports.RULE_FILE = RULE_FILE;
