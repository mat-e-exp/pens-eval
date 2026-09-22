/**
 * Fix Guidance
 *
 * Per-tool actionable fix instructions. When a check fails, the user
 * needs to know WHY it failed and HOW to fix it — not just that it failed.
 *
 * From spec section 16.1: "Developer sees: tool name, severity, finding,
 * file, line, exact fix, documentation link."
 */

'use strict';

/**
 * Fix guidance templates keyed by tool ID.
 * Each returns formatted guidance string given the tool output.
 */
const GUIDANCE = {
  'trivy-secrets': {
    title: 'Secrets detected in repository',
    parseFindings: parseTrivy,
    fixSteps: [
      'Add the file to .gitignore',
      'Remove from git tracking: git rm --cached <file>',
      'Use Infisical for secrets management: https://infisical.com/docs',
      'If this is a dev-only file (e.g. self-signed cert), document why and override',
    ],
    docs: 'https://trivy.dev/docs/scanner/secret/',
  },
  'trivy-cve': {
    title: 'Vulnerable dependencies found',
    parseFindings: parseTrivy,
    fixSteps: [
      'Update the vulnerable package to a patched version',
      'Run: npm audit fix (Node) or pip install --upgrade <package> (Python)',
      'If no fix available, override with documented reason and expiry',
    ],
    docs: 'https://trivy.dev/docs/scanner/vulnerability/',
  },
  'semgrep': {
    title: 'Security patterns detected',
    parseFindings: parseSemgrep,
    fixSteps: [
      'Review each finding — Semgrep explains the security risk inline',
      'Fix the pattern (e.g. add input validation, use parameterized queries)',
      'If false positive, override: devflow override --rule semgrep.<rule-id> --reason "..."',
    ],
    docs: 'https://semgrep.dev/docs/',
  },
  'lint': {
    title: 'Lint issues found',
    parseFindings: parseGeneric,
    fixSteps: [
      'Run: devflow fix --tool <linter> to auto-fix where possible',
      'Review remaining issues manually',
    ],
  },
  'format': {
    title: 'Formatting issues found',
    parseFindings: parseGeneric,
    fixSteps: [
      'Run: devflow fix to auto-format all files',
    ],
  },
  'eslint': {
    title: 'ESLint issues found',
    parseFindings: parseGeneric,
    fixSteps: [
      'Run: devflow fix --tool eslint to auto-fix',
      'Review remaining issues in the output above',
    ],
  },
  'bandit': {
    title: 'Python security issues found',
    parseFindings: parseGeneric,
    fixSteps: [
      'Review each finding — Bandit shows severity and confidence',
      'Fix the code pattern or override with documented reason',
    ],
    docs: 'https://bandit.readthedocs.io/',
  },
  'licence': {
    title: 'Licence compliance issues found',
    parseFindings: parseGeneric,
    fixSteps: [
      'Review each dependency\'s licence for compatibility with your project',
      'Replace dependencies with blocked licences, or add to licencePolicy.allow in .devflow/config.yml',
      'Copyleft licences (GPL, LGPL, AGPL) may require you to open-source derivative works',
      'For temporary bypass: devflow override --rule licence --reason "..."',
    ],
    docs: 'https://spdx.org/licenses/',
  },
  'dangerous-config': {
    title: 'Dangerous configuration detected',
    parseFindings: parseSemgrepJson,
    fixSteps: [
      'Read the rule message printed above — it names the security property the setting gives up',
      'Restore the safe setting: verify TLS certificates, keep debug off, enumerate CORS origins, pass command arguments as an array rather than a shell string',
      'If a value differs per environment, read it from an environment variable rather than hardcoding the unsafe one',
      'If the finding is wrong for this repo: devflow override --rule dangerous-config --reason "..." (30-day expiry, logged with your identity)',
      'To exclude a path permanently: add it to dangerousConfigIgnorePaths in .devflow/config.yml',
    ],
    docs: null,
  },
  'lockfile': {
    title: 'Dependency change without its lockfile',
    parseFindings: parseGeneric,
    fixSteps: [
      'Run the install command for the ecosystem so the lockfile is regenerated, then stage it alongside the manifest',
      'Commit the manifest and the lockfile together — reviewers need the resolved versions, and CI installs from the lockfile, not the manifest',
      'If the project has no lockfile at all, generate one now: an unlocked project installs different versions on every machine and every build',
      'If this change genuinely does not affect resolution: devflow override --rule lockfile-gate --reason "..." (30-day expiry, logged with your identity)',
    ],
    docs: null,
  },
  'suppression': {
    title: 'New suppression comment(s) in staged changes',
    parseFindings: parseGeneric,
    fixSteps: [
      'Fix the underlying finding instead of silencing the tool',
      'If the rule is wrong for this codebase, change it in the tool config (e.g. .eslintrc, ruff.toml) with a comment saying why — that is reviewable, an inline suppression is not',
      'If a suppression is unavoidable: devflow override --rule suppression-gate --reason "..." (30-day expiry, logged with your identity)',
      'To permanently allow a pattern (e.g. test-skip): add its id to suppressionAllow in .devflow/config.yml',
    ],
    docs: null,
  },
};

/**
 * Get formatted failure output for a check result.
 *
 * @param {Object} hook - The hook/job that failed
 * @param {Object} result - Run result with output/error
 * @returns {string} Formatted output for the terminal
 */
function formatFailure(hook, result) {
  const lines = [];
  const policyLabel = hook.failPolicy === 'closed' ? 'blocks commit' : 'warning';

  lines.push(`  ✗ ${hook.id} — FAILED (${policyLabel})`);
  lines.push('');

  // Get guidance for this tool
  const guidance = GUIDANCE[hook.tool] || GUIDANCE[hook.id];

  if (guidance) {
    lines.push(`    ${guidance.title}`);
    lines.push('');

    // Parse and show findings from tool output
    const combined = (result.output || '') + '\n' + (result.error || '');
    const findings = guidance.parseFindings(combined);
    for (const finding of findings) {
      lines.push(`    ${finding}`);
    }

    if (findings.length > 0) lines.push('');

    // Show fix steps
    lines.push('    How to fix:');
    for (let i = 0; i < guidance.fixSteps.length; i++) {
      lines.push(`      ${i + 1}. ${guidance.fixSteps[i]}`);
    }

    if (guidance.docs) {
      lines.push('');
      lines.push(`    Docs: ${guidance.docs}`);
    }
  } else {
    // No specific guidance — show raw output
    const combined = (result.output || '') + '\n' + (result.error || '');
    const useful = combined.split('\n').filter(l => l.trim() && !l.includes('INFO')).slice(0, 10);
    for (const line of useful) {
      lines.push(`    ${line}`);
    }
    lines.push('');
    lines.push('    Fix the issues above, or run: devflow override --rule ' + hook.id + ' --reason "..."');
  }

  return lines.join('\n');
}

/**
 * Get formatted warning output.
 */
function formatWarning(hook, result) {
  const lines = [];
  lines.push(`  ⚠ ${hook.id} — warning (non-blocking)`);

  const combined = (result.output || '') + '\n' + (result.error || '');

  // A tool with a parser gets the same readable findings it would get on a
  // failure — otherwise a machine-readable format would be dumped raw.
  const guidance = GUIDANCE[hook.tool] || GUIDANCE[hook.id];
  const useful = guidance
    ? guidance.parseFindings(combined).slice(0, 5)
    : combined.split('\n').filter(l => l.trim() && !l.includes('INFO')).slice(0, 5);
  if (useful.length > 0) {
    for (const line of useful) {
      lines.push(`    ${line}`);
    }
  }

  return lines.join('\n');
}

/**
 * Parse Trivy output for key findings.
 */
function parseTrivy(output) {
  const findings = [];
  const lines = output.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match severity lines like "HIGH: AsymmetricPrivateKey (private-key)"
    const severityMatch = line.match(/^(CRITICAL|HIGH|MEDIUM|LOW):\s+(.+)/);
    if (severityMatch) {
      findings.push(`${severityMatch[1]}: ${severityMatch[2]}`);
    }

    // Match file references like "key.pem:2-27"
    const fileMatch = line.match(/^\s+(\S+:\d+[-–]\d+)/);
    if (fileMatch && findings.length > 0) {
      findings.push(`  File: ${fileMatch[1]}`);
    }

    // Match CVE lines
    const cveMatch = line.match(/(CVE-\d{4}-\d+)/);
    if (cveMatch && !findings.some(f => f.includes(cveMatch[1]))) {
      findings.push(`  ${cveMatch[1]}`);
    }

    // Match table rows with vulnerability info
    const tableMatch = line.match(/│\s+(\S+)\s+│.*│\s+(CVE-\d{4}-\d+)\s+│/);
    if (tableMatch) {
      findings.push(`${tableMatch[2]} in ${tableMatch[1]}`);
    }
  }

  return findings.length > 0 ? findings : ['(see full output above)'];
}

/**
 * Parse Semgrep output for key findings.
 */
function parseSemgrep(output) {
  const findings = [];
  const lines = output.split('\n');

  for (const line of lines) {
    // Match Semgrep finding lines like "path/file.py:10: error: [rule-id]"
    const match = line.match(/^(\S+):(\d+):\s+(error|warning):\s+(.+)/);
    if (match) {
      findings.push(`${match[3].toUpperCase()}: ${match[1]}:${match[2]} — ${match[4]}`);
    }
  }

  return findings.length > 0 ? findings : ['(see full output above)'];
}

/**
 * Parse `semgrep --json` output into one readable line per finding.
 *
 * Semgrep namespaces a rule id by the path of the config file it came from
 * (`src.rules.universal.devflow.js.cors-wildcard-origin`), so only the last
 * segment is shown — that is the part written in the ruleset.
 */
function parseSemgrepJson(output) {
  // The caller concatenates stdout and stderr, so the JSON document is a
  // slice of the text rather than the whole of it.
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  let report;
  try {
    if (start === -1 || end <= start) throw new Error('no JSON document');
    report = JSON.parse(output.slice(start, end + 1));
  } catch {
    return parseSemgrep(output);
  }

  const results = Array.isArray(report.results) ? report.results : [];
  const findings = results.slice(0, 20).map(r => {
    const rule = String(r.check_id || 'rule').split('.').pop();
    const line = r.start && r.start.line ? r.start.line : '?';
    const message = String((r.extra && r.extra.message) || '').trim().split('\n')[0];
    return `${r.path}:${line}  ${rule}\n      ${message}`;
  });

  if (results.length > findings.length) {
    findings.push(`... and ${results.length - findings.length} more`);
  }
  return findings.length > 0 ? findings : ['(no findings parsed — see raw output in .devflow/findings.json)'];
}

/**
 * Generic parser — extract non-info lines.
 */
function parseGeneric(output) {
  return output.split('\n')
    .filter(l => l.trim() && !l.includes('INFO') && !l.includes('Downloading'))
    .slice(0, 8);
}

module.exports = {
  formatFailure,
  formatWarning,
  GUIDANCE,
};
