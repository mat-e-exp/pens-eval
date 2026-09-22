/**
 * Licence Scanner
 *
 * Runs licence-checking tools, parses their output, and classifies each
 * dependency against the licence policy. Returns per-dependency findings
 * instead of a single pass/fail.
 *
 * Tools per language:
 *   Python:     pip-licenses --format json
 *   Node:       npx license-checker --json
 *   Go:         go-licenses report ./... --template '{{.Name}},{{.LicenseName}}'
 *   Rust:       cargo-license --json
 *   Ruby:       license_finder report --format json
 */

'use strict';

const { execSync } = require('child_process');
const path = require('path');

const DEFAULT_POLICY = {
  allow: ['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'CC0-1.0', 'Unlicense', '0BSD'],
  warn: ['GPL-2.0', 'GPL-3.0', 'LGPL-2.1', 'LGPL-3.0', 'MPL-2.0', 'AGPL-3.0',
    'GPL-2.0-only', 'GPL-3.0-only', 'LGPL-2.1-only', 'LGPL-3.0-only',
    'GPL-2.0-or-later', 'GPL-3.0-or-later', 'LGPL-2.1-or-later', 'LGPL-3.0-or-later',
    'AGPL-3.0-only', 'AGPL-3.0-or-later'],
  block: [],
  blockUnknown: true,
};

/**
 * Known licence name aliases → SPDX identifiers.
 * Tools report licences inconsistently. This normalises the most common variants.
 */
const LICENCE_ALIASES = {
  'MIT License': 'MIT',
  'MIT license': 'MIT',
  'The MIT License': 'MIT',
  'Apache License 2.0': 'Apache-2.0',
  'Apache-2.0 license': 'Apache-2.0',
  'Apache 2.0': 'Apache-2.0',
  'Apache Software License': 'Apache-2.0',
  'BSD License': 'BSD-3-Clause',
  'BSD': 'BSD-3-Clause',
  'BSD-3': 'BSD-3-Clause',
  'BSD-2': 'BSD-2-Clause',
  'ISC License': 'ISC',
  'ISC license': 'ISC',
  'Mozilla Public License 2.0': 'MPL-2.0',
  'GNU General Public License v2 (GPLv2)': 'GPL-2.0',
  'GNU General Public License v3 (GPLv3)': 'GPL-3.0',
  'GNU Lesser General Public License v2 (LGPLv2)': 'LGPL-2.1',
  'GNU Lesser General Public License v3 (LGPLv3)': 'LGPL-3.0',
  'GNU Affero General Public License v3 (AGPLv3)': 'AGPL-3.0',
  'Public Domain': 'Unlicense',
  'UNKNOWN': 'UNKNOWN',
  'NOASSERTION': 'UNKNOWN',
};

/**
 * Tool definitions for each language.
 */
const LICENCE_TOOLS = {
  python: {
    command: 'pip-licenses',
    args: ['--format', 'json', '--with-urls'],
    parse: parsePipLicenses,
  },
  javascript: {
    command: 'npx',
    args: ['--yes', 'license-checker', '--json', '--production'],
    parse: parseLicenseChecker,
  },
  typescript: {
    command: 'npx',
    args: ['--yes', 'license-checker', '--json', '--production'],
    parse: parseLicenseChecker,
  },
  go: {
    command: 'go-licenses',
    args: ['report', './...'],
    parse: parseGoLicenses,
  },
  rust: {
    command: 'cargo-license',
    args: ['--json'],
    parse: parseCargoLicense,
  },
  ruby: {
    command: 'license_finder',
    args: ['report', '--format', 'json'],
    parse: parseRubyLicenseFinder,
  },
};

/**
 * Normalise a licence string to its SPDX identifier.
 */
function normaliseLicence(raw) {
  if (!raw || raw.trim() === '') return 'UNKNOWN';
  const trimmed = raw.trim();
  return LICENCE_ALIASES[trimmed] || trimmed;
}

/**
 * Classify a licence against the policy.
 *
 * @param {string} licence - SPDX licence identifier
 * @param {Object} policy - Licence policy
 * @returns {'pass'|'warn'|'block'}
 */
function classifyLicence(licence, policy) {
  if (licence === 'UNKNOWN') {
    return policy.blockUnknown ? 'block' : 'warn';
  }
  if (policy.block.includes(licence)) return 'block';
  if (policy.warn.includes(licence)) return 'warn';
  if (policy.allow.includes(licence)) return 'pass';

  // Not in any list — check if it's a variant of a known licence
  const lower = licence.toLowerCase();
  for (const allowed of policy.allow) {
    if (lower === allowed.toLowerCase()) return 'pass';
  }
  for (const warned of policy.warn) {
    if (lower === warned.toLowerCase()) return 'warn';
  }
  for (const blocked of policy.block) {
    if (lower === blocked.toLowerCase()) return 'block';
  }

  // Unknown licence not in any list — treat as warn (could be a custom or compound licence)
  return 'warn';
}

/**
 * Merge user policy overrides with defaults.
 */
function mergePolicy(userPolicy) {
  if (!userPolicy) return { ...DEFAULT_POLICY };
  return {
    allow: userPolicy.allow || DEFAULT_POLICY.allow,
    warn: userPolicy.warn || DEFAULT_POLICY.warn,
    block: userPolicy.block || DEFAULT_POLICY.block,
    blockUnknown: userPolicy.blockUnknown !== undefined ? userPolicy.blockUnknown : DEFAULT_POLICY.blockUnknown,
  };
}

/**
 * Scan a single language stack for licence issues.
 *
 * @param {string} language - Language identifier
 * @param {string} repoRoot - Repository root
 * @param {string} scopePath - Scoped path within repo (e.g. "backend/", ".")
 * @param {Object} [policyOverride] - Per-repo policy from config
 * @returns {{ dependencies: Array, summary: Object }}
 */
function scanLicences(language, repoRoot, scopePath, policyOverride) {
  const toolDef = LICENCE_TOOLS[language];
  if (!toolDef) {
    return { dependencies: [], summary: { total: 0, pass: 0, warn: 0, block: 0, error: `No licence tool for ${language}` } };
  }

  const policy = mergePolicy(policyOverride);
  const cwd = scopePath && scopePath !== '.' ? path.join(repoRoot, scopePath) : repoRoot;

  let output;
  try {
    output = execSync(`${toolDef.command} ${toolDef.args.join(' ')}`, {
      cwd,
      stdio: 'pipe',
      timeout: 120000,
      env: { ...process.env },
    }).toString();
  } catch (err) {
    const stderr = (err.stderr || '').toString();
    const stdout = (err.stdout || '').toString();

    if (stderr.includes('command not found') || stderr.includes('not recognized') || err.status === 127) {
      return {
        dependencies: [],
        summary: { total: 0, pass: 0, warn: 0, block: 0, toolMissing: true, tool: toolDef.command },
      };
    }

    // Some tools exit non-zero but still produce valid output
    output = stdout || stderr;
    if (!output.trim()) {
      return {
        dependencies: [],
        summary: { total: 0, pass: 0, warn: 0, block: 0, error: stderr.slice(0, 500) },
      };
    }
  }

  let deps;
  try {
    deps = toolDef.parse(output);
  } catch (parseErr) {
    return {
      dependencies: [],
      summary: { total: 0, pass: 0, warn: 0, block: 0, error: `Failed to parse ${toolDef.command} output: ${parseErr.message}` },
    };
  }

  // Classify each dependency
  const results = [];
  let pass = 0, warn = 0, block = 0;

  for (const dep of deps) {
    const normalised = normaliseLicence(dep.licence);
    const action = classifyLicence(normalised, policy);

    if (action === 'pass') {
      pass++;
    } else {
      const entry = {
        name: dep.name,
        version: dep.version || null,
        licence: normalised,
        rawLicence: dep.licence,
        action,
        url: dep.url || null,
      };
      results.push(entry);
      if (action === 'block') block++;
      else warn++;
    }
  }

  return {
    dependencies: results,
    summary: { total: deps.length, pass, warn, block },
  };
}

// --- Output parsers ---

/**
 * Parse pip-licenses --format json output.
 * Format: [{"Name": "pkg", "Version": "1.0", "License": "MIT", "URL": "..."}, ...]
 */
function parsePipLicenses(output) {
  const data = JSON.parse(output);
  return data.map(entry => ({
    name: entry.Name,
    version: entry.Version,
    licence: entry.License,
    url: entry.URL || null,
  }));
}

/**
 * Parse npx license-checker --json output.
 * Format: {"pkg@1.0": {"licenses": "MIT", "repository": "..."}, ...}
 */
function parseLicenseChecker(output) {
  const data = JSON.parse(output);
  return Object.entries(data).map(([key, val]) => {
    const atIdx = key.lastIndexOf('@');
    const name = atIdx > 0 ? key.slice(0, atIdx) : key;
    const version = atIdx > 0 ? key.slice(atIdx + 1) : null;
    // license-checker uses "licenses" (can be string or array)
    let licence = val.licenses;
    if (Array.isArray(licence)) licence = licence.join(' AND ');
    return {
      name,
      version,
      licence: licence || 'UNKNOWN',
      url: val.repository || null,
    };
  });
}

/**
 * Parse go-licenses report output (CSV-like).
 * Format: module_path,license_url,license_type (one per line)
 */
function parseGoLicenses(output) {
  return output.trim().split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .map(line => {
      const parts = line.split(',');
      return {
        name: (parts[0] || '').trim(),
        version: null,
        licence: (parts[2] || parts[1] || 'UNKNOWN').trim(),
        url: (parts[1] || '').trim() || null,
      };
    });
}

/**
 * Parse cargo-license --json output.
 * Format: [{"name": "pkg", "version": "1.0", "license": "MIT"}, ...]
 */
function parseCargoLicense(output) {
  const data = JSON.parse(output);
  return data.map(entry => ({
    name: entry.name,
    version: entry.version,
    licence: entry.license || 'UNKNOWN',
    url: entry.repository || null,
  }));
}

/**
 * Parse license_finder report --format json output.
 * Format: {"dependencies": [{"name": "pkg", "version": "1.0", "licenses": ["MIT"]}, ...]}
 */
function parseRubyLicenseFinder(output) {
  const data = JSON.parse(output);
  const deps = data.dependencies || data;
  return (Array.isArray(deps) ? deps : []).map(entry => ({
    name: entry.name,
    version: entry.version,
    licence: Array.isArray(entry.licenses) ? entry.licenses.join(' AND ') : (entry.licenses || 'UNKNOWN'),
    url: entry.homepage || null,
  }));
}

module.exports = {
  scanLicences,
  classifyLicence,
  normaliseLicence,
  mergePolicy,
  DEFAULT_POLICY,
  LICENCE_TOOLS,
  LICENCE_ALIASES,
  // Exported for testing
  parsePipLicenses,
  parseLicenseChecker,
  parseGoLicenses,
  parseCargoLicense,
  parseRubyLicenseFinder,
};
