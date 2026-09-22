/**
 * Rule Files
 *
 * devflow ships custom rule files (Trivy secret patterns, Semgrep
 * dangerous-config rules) inside the package. CI runners and hooks cannot
 * reference the package's install path — it differs per machine and does
 * not exist on a clean checkout — so `init` / `update` / `check` copy the
 * shipped rules into `.devflow/rules/` in the target repo and every plan
 * argument references that repo-relative path. The copies are tracked in
 * git like the rest of `.devflow/`.
 *
 * Files are overwritten on every call so a devflow upgrade propagates on
 * the next `devflow update` or `devflow check`.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.join(__dirname, '..', 'rules', 'universal');
const RULES_DIR = path.join('.devflow', 'rules');

/** Shipped rule files, by basename. */
const RULE_FILES = ['trivy-secret.yaml', 'dangerous-config.yaml'];

/**
 * Repo-relative path to a shipped rule file, as used in hook/job args.
 * Always forward-slash so generated CI YAML is portable.
 */
function rulePath(name) {
  return `${RULES_DIR.replace(/\\/g, '/')}/${name}`;
}

/**
 * Copy every shipped rule file into <repoRoot>/.devflow/rules/.
 *
 * @param {string} repoRoot
 * @returns {{ written: string[], dir: string }}
 */
function ensureRuleFiles(repoRoot) {
  const dir = path.join(repoRoot, RULES_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const written = [];
  for (const name of RULE_FILES) {
    const src = path.join(SOURCE_DIR, name);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(dir, name);
    const content = fs.readFileSync(src);
    if (!fs.existsSync(dest) || !fs.readFileSync(dest).equals(content)) {
      fs.writeFileSync(dest, content);
      written.push(rulePath(name));
    }
  }
  return { written, dir };
}

module.exports = {
  SOURCE_DIR,
  RULES_DIR,
  RULE_FILES,
  rulePath,
  ensureRuleFiles,
};
