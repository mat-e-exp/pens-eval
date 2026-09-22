/**
 * Dependency Provenance Verification Module
 *
 * From spec sections 7.2 and 13: Catches supply chain attacks that
 * predate CVE filing. Trivy catches known CVEs but not silently
 * compromised packages.
 *
 * - pip-audit for Python — verifies package signatures
 * - npm audit signatures for Node — verifies package integrity
 * - Runs in CI on every push alongside Trivy
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** @type {ModuleDefinition} */
const dependencyProvenanceModule = {
  id: 'dependency-provenance',
  name: 'Dependency Provenance Verification',
  type: 'security',
  version: '1.0.0',
  optional: false,

  /**
   * Detect if repo has dependency files that need provenance checks.
   */
  detect(repoRoot) {
    return hasPythonDeps(repoRoot) || hasNodeDeps(repoRoot);
  },

  /**
   * CI jobs for provenance verification.
   */
  get ciJobs() {
    return [
      {
        id: 'pip-audit',
        name: 'Python dependency audit',
        tool: 'pip-audit',
        command: 'pip-audit',
        args: ['-r', 'requirements.txt'],
        scope: '**/requirements*.txt',
        failPolicy: 'open-notify',
        severity: 'high',
        language: 'python',
      },
      {
        id: 'npm-audit-signatures',
        name: 'npm signature verification',
        tool: 'npm-audit',
        command: 'npm',
        args: ['audit', 'signatures'],
        scope: '**/package-lock.json',
        failPolicy: 'open-notify',
        severity: 'high',
        language: 'javascript',
      },
    ];
  },

  /**
   * Extend plan — add provenance jobs only for detected languages.
   */
  extendPlan(plan) {
    const jobs = [];

    // Python provenance — run where requirements.txt exists
    const pyStacks = plan.stacks.filter(s => s.language === 'python');
    for (const stack of pyStacks) {
      const prefix = stack.path === '.' ? '' : stack.path;
      jobs.push({
        id: `pip-audit${prefix ? '-' + prefix.replace(/\/$/, '') : ''}`,
        name: `Python dependency audit${prefix ? ' (' + prefix + ')' : ''}`,
        tool: 'pip-audit',
        command: 'pip-audit',
        args: ['-r', `${prefix || '.'}requirements.txt`],
        scope: `${prefix}**/requirements*.txt`,
        failPolicy: 'open-notify',
        severity: 'high',
        language: 'python',
      });
    }

    // npm provenance — run where package-lock.json exists
    const jsStacks = plan.stacks.filter(s =>
      s.language === 'javascript' || s.language === 'typescript'
    );
    for (const stack of jsStacks) {
      const prefix = stack.path === '.' ? '' : stack.path;
      const prefixArgs = prefix ? ['--prefix', prefix.replace(/\/$/, '')] : [];
      jobs.push({
        id: `npm-audit${prefix ? '-' + prefix.replace(/\/$/, '') : ''}`,
        name: `npm signature verification${prefix ? ' (' + prefix + ')' : ''}`,
        tool: 'npm-audit',
        command: 'npm',
        args: ['audit', 'signatures', ...prefixArgs],
        scope: `${prefix}**/package-lock.json`,
        failPolicy: 'open-notify',
        severity: 'high',
        language: 'javascript',
      });
    }

    return {
      ...plan,
      ciOnPush: {
        ...plan.ciOnPush,
        jobs: [...plan.ciOnPush.jobs, ...jobs],
      },
      failPolicy: {
        ...plan.failPolicy,
        'pip-audit': 'open-notify',
        'npm-audit': 'open-notify',
      },
    };
  },
};

function hasPythonDeps(repoRoot) {
  const pyFiles = ['requirements.txt', 'pyproject.toml', 'Pipfile'];
  // Check root
  if (pyFiles.some(f => fs.existsSync(path.join(repoRoot, f)))) return true;
  // Check one level of subdirectories
  try {
    const entries = fs.readdirSync(repoRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        if (pyFiles.some(f => fs.existsSync(path.join(repoRoot, entry.name, f)))) return true;
      }
    }
  } catch { /* skip */ }
  return false;
}

function hasNodeDeps(repoRoot) {
  const nodeFiles = ['package-lock.json', 'yarn.lock'];
  // Check root
  if (nodeFiles.some(f => fs.existsSync(path.join(repoRoot, f)))) return true;
  // Check one level of subdirectories
  try {
    const entries = fs.readdirSync(repoRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        if (nodeFiles.some(f => fs.existsSync(path.join(repoRoot, entry.name, f)))) return true;
      }
    }
  } catch { /* skip */ }
  return false;
}

module.exports = dependencyProvenanceModule;
