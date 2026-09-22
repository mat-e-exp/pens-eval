/**
 * Required Checks
 *
 * Prints the CI checks that must be marked required in branch protection.
 *
 * Every gate devflow generates reports after a push. On a branch that is not
 * protected, a failing gate is an alarm rather than a barrier: the change is
 * already on the branch and someone has to revert it. Branch protection is
 * what turns the alarm into a barrier, and it is configured on the hosting
 * platform, not by devflow (DEC-004 — adapters generate files, they do not
 * call platform APIs).
 *
 * Getting the names wrong fails quietly in the worst direction: a required
 * check that never reports blocks every merge, and a gate left out of the
 * list is simply not enforced. So devflow prints the exact names its own
 * workflows report, rather than leaving them to be guessed.
 */

'use strict';

/**
 * The name a CI platform shows for a job — what branch protection matches on.
 * Not the job id: GitHub reports the job's `name:` when it has one.
 */
function checkName(job) {
  return job.name || job.id;
}

/**
 * Required checks for a plan, as {id, name} pairs in plan order.
 *
 * @param {Object} plan
 * @returns {Array<{id: string, name: string}>}
 */
function requiredCheckNames(plan) {
  const required = new Set((plan.mergeGate && plan.mergeGate.requiredChecks) || []);
  const jobs = (plan.ciOnPush && plan.ciOnPush.jobs) || [];
  return jobs.filter(job => required.has(job.id)).map(job => ({ id: job.id, name: checkName(job) }));
}

/**
 * Print the branch-protection configuration a repository needs.
 *
 * @param {Object} plan
 */
function printRequiredChecks(plan) {
  const checks = requiredCheckNames(plan);
  if (checks.length === 0) return;

  console.log('');
  console.log('  Branch protection — mark these checks required on your default branch:');
  for (const check of checks) {
    console.log(`    ${check.name}`);
  }
  console.log('');
  console.log('  Until then a failing gate reports after the push rather than blocking it.');
}

module.exports = { checkName, requiredCheckNames, printRequiredChecks };
