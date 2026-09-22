/**
 * Licence Compliance Module
 *
 * From spec section 20: pip-licenses for Python, license-checker for Node.
 * Extended with Go (go-licenses), Rust (cargo-license), Ruby (license_finder).
 *
 * Runs in CI on every push and locally via `devflow check`.
 * Classifies each dependency against a configurable policy:
 *   - allow: permissive licences (MIT, Apache-2.0, BSD, ISC, etc.)
 *   - warn: copyleft licences (GPL, LGPL, MPL, AGPL)
 *   - block: explicitly blocked licences (configurable)
 *   - blockUnknown: block dependencies with no detected licence (default: true)
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { LICENCE_TOOLS } = require('../core/licence-scanner');

/** @type {ModuleDefinition} */
const licenceComplianceModule = {
  id: 'licence-compliance',
  name: 'Licence Compliance',
  type: 'security',
  version: '2.0.0',
  optional: false,

  detect(repoRoot) {
    return fs.existsSync(path.join(repoRoot, 'package.json')) ||
      fs.existsSync(path.join(repoRoot, 'requirements.txt')) ||
      fs.existsSync(path.join(repoRoot, 'pyproject.toml')) ||
      fs.existsSync(path.join(repoRoot, 'go.mod')) ||
      fs.existsSync(path.join(repoRoot, 'Cargo.toml')) ||
      fs.existsSync(path.join(repoRoot, 'Gemfile'));
  },

  extendPlan(plan) {
    const languages = plan.stacks.map(s => s.language);

    // Build jobs only for languages present in this repo's stacks
    const allJobs = Object.entries(LICENCE_TOOLS)
      .filter(([language]) => languages.includes(language))
      .map(([language, toolDef]) => ({
        id: `licence-${language}`,
        name: `${language} licence check`,
        tool: 'licence',
        command: toolDef.command,
        args: toolDef.args,
        scope: '**/*',
        failPolicy: 'open-notify',
        severity: 'medium',
        language,
        isLicenceScan: true,
      }));

    // Deduplicate: JS and TS use the same tool (license-checker)
    const seen = new Set();
    const deduped = allJobs.filter(job => {
      const key = job.command + '-' + job.args.join('-');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      ...plan,
      ciOnPush: {
        ...plan.ciOnPush,
        jobs: [...plan.ciOnPush.jobs, ...deduped],
      },
    };
  },
};

module.exports = licenceComplianceModule;
