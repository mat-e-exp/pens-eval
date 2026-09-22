/**
 * CI Commit Range
 *
 * Works out which commits a CI gate should examine.
 *
 * A gate that runs inside devflow is enforced in CI by asking the
 * pre-commit question again over the commits that arrived — so it needs to
 * know what "arrived" means. That differs by event and by platform:
 *
 *   - a pull request compares against its target branch
 *   - a push compares against whatever the branch pointed at before
 *   - a brand new branch has no before, so it compares against the default
 *
 * Every value is read from environment variables the runner already sets,
 * or from the event payload file on disk. No platform API is called, which
 * keeps this consistent with DEC-004.
 */

'use strict';

const fs = require('fs');

/** A push to a new branch reports this as the previous SHA. */
const NULL_SHA = '0000000000000000000000000000000000000000';

function isUsableSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{7,40}$/i.test(value) && value !== NULL_SHA;
}

/**
 * The `before` SHA of a GitHub push, which lives in the event payload
 * rather than in an environment variable of its own.
 */
function githubPushBefore(env) {
  if (env.GITHUB_EVENT_NAME !== 'push' || !env.GITHUB_EVENT_PATH) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
    return isUsableSha(payload && payload.before) ? payload.before : null;
  } catch {
    return null;
  }
}

/**
 * Resolve the commit range a gate should scan.
 *
 * @param {Object} [options]
 * @param {string} [options.base] - Explicit base ref, from `--base`
 * @param {Object} [env] - Environment, injectable for testing
 * @returns {{range: string, source: string}}
 */
function resolveRange(options = {}, env = process.env) {
  if (options.base) {
    return { range: `${options.base}...HEAD`, source: '--base' };
  }

  // Pull or merge request: compare against the branch it would merge into.
  const prTarget =
    env.GITHUB_BASE_REF ||
    env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME ||
    env.BITBUCKET_PR_DESTINATION_BRANCH;
  if (prTarget) {
    return { range: `origin/${prTarget}...HEAD`, source: 'pull request target' };
  }

  // Push: compare against what the branch pointed at before.
  const before = githubPushBefore(env) || env.CI_COMMIT_BEFORE_SHA;
  if (isUsableSha(before)) {
    return { range: `${before}..HEAD`, source: 'push event' };
  }

  // New branch, or running outside CI: the previous commit is the best
  // available answer and matches what a single local commit would have seen.
  return { range: 'HEAD~1...HEAD', source: 'previous commit' };
}

module.exports = {
  NULL_SHA,
  isUsableSha,
  githubPushBefore,
  resolveRange,
};
