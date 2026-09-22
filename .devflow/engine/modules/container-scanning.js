/**
 * Container Scanning Module
 *
 * From spec Phase 1 Week 3: Container scanning ships Day 1 — if you
 * ship Docker images the image is part of the attack surface from day one.
 *
 * Uses Trivy (already in the stack) for container image scanning.
 * Auto-detects Dockerfile presence. Scans built images for CVEs,
 * misconfigurations, and secrets.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** @type {ModuleDefinition} */
const containerScanningModule = {
  id: 'container-scanning',
  name: 'Container Image Scanning',
  type: 'security',
  version: '1.0.0',
  optional: false,

  /**
   * Detect Dockerfiles in the repository.
   */
  detect(repoRoot) {
    return findDockerfiles(repoRoot).length > 0;
  },

  /**
   * CI jobs for container scanning.
   */
  get ciJobs() {
    return [
      {
        id: 'trivy-container',
        name: 'Container image scan',
        tool: 'trivy-container',
        command: 'trivy',
        args: ['image', '--exit-code', '1', '--severity', 'CRITICAL,HIGH'],
        scope: '**/Dockerfile*',
        failPolicy: 'open-notify',
        severity: 'high',
        ciOnly: true, // Needs a built image — only runs in CI after build step
      },
      {
        id: 'trivy-dockerfile-misconfig',
        name: 'Dockerfile misconfiguration scan',
        tool: 'trivy-misconfig',
        command: 'trivy',
        args: ['config', '--exit-code', '1', '.'],
        scope: '**/Dockerfile*',
        failPolicy: 'open-notify',
        severity: 'medium',
      },
    ];
  },

  /**
   * Pre-commit hook: scan Dockerfiles for misconfigurations.
   */
  get preCommitHooks() {
    return [
      {
        id: 'dockerfile-lint',
        tool: 'trivy-misconfig',
        command: 'trivy',
        args: ['config', '--exit-code', '1', '.'],
        scope: '**/Dockerfile*',
        failPolicy: 'open-notify',
      },
    ];
  },

  /**
   * Extend plan with container-specific fail policies.
   */
  extendPlan(plan) {
    return {
      ...plan,
      failPolicy: {
        ...plan.failPolicy,
        'trivy-container': 'open-notify',
        'trivy-misconfig': 'open-notify',
      },
    };
  },

  config: {
    imageTag: '${REPO}:${COMMIT_SHA}',
    scanOnBuild: true,
  },
};

/**
 * Find Dockerfiles in a repository.
 *
 * @param {string} repoRoot
 * @returns {string[]} Relative paths to Dockerfiles
 */
function findDockerfiles(repoRoot) {
  const dockerfiles = [];

  function scan(dir, depth) {
    if (depth > 3) return; // Don't recurse too deep
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        if (entry.isFile() && (entry.name === 'Dockerfile' || entry.name.startsWith('Dockerfile.'))) {
          dockerfiles.push(path.relative(repoRoot, path.join(dir, entry.name)));
        } else if (entry.isDirectory()) {
          scan(path.join(dir, entry.name), depth + 1);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  scan(repoRoot, 0);
  return dockerfiles;
}

module.exports = containerScanningModule;
