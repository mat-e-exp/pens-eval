#!/usr/bin/env node

/**
 * devflow CLI
 *
 * Entry point for all devflow commands.
 * Zero external dependencies — uses Node built-ins only.
 */

'use strict';

const path = require('path');
const commands = require('./commands');

const VERSION = require('../core/version').devflowVersion();

const USAGE = `
devflow v${VERSION} — Engineering Quality Framework

Usage:
  devflow init              Detect stack, generate CI config, install hooks
  devflow install           Install pre-commit hooks on a cloned repo
  devflow check             Run all enforcement checks manually
  devflow check --pre-commit  Run pre-commit checks only (used by git hook)
  devflow update            Regenerate CI config from current plan
  devflow fix               Auto-fix findings where possible
  devflow override          Document a bypass for a failing check
  devflow progress          Show findings history and resolution progress
  devflow debt              Show technical debt report
  devflow version           Show version

Options:
  --help                    Show this help
  --platform <id>           Force a CI platform (github-actions, gitlab-ci, bitbucket-pipelines)
  --staged-only             Only check staged files (pre-commit mode)
  --gate <hook-id>          Run one internal gate over a commit range (CI)
  --base <ref>              Base ref for --gate (default: origin/main)
`;

function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    process.exit(0);
  }

  if (command === 'version' || command === '--version' || command === '-v') {
    console.log(`devflow v${VERSION}`);
    process.exit(0);
  }

  const repoRoot = findRepoRoot(process.cwd());
  const options = parseOptions(args.slice(1));

  try {
    switch (command) {
      case 'init':
        commands.init(repoRoot, options);
        break;
      case 'install':
        commands.install(repoRoot, options);
        break;
      case 'check':
        commands.check(repoRoot, options);
        break;
      case 'update':
        commands.update(repoRoot, options);
        break;
      case 'fix':
        commands.fix(repoRoot, options);
        break;
      case 'override':
        commands.override(repoRoot, options);
        break;
      case 'progress':
        commands.progress(repoRoot, options);
        break;
      case 'debt':
        commands.debt(repoRoot, options);
        break;
      default:
        console.error(`Unknown command: ${command}`);
        console.log(USAGE);
        process.exit(1);
    }
  } catch (err) {
    console.error(`\ndevflow: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Walk up from cwd to find the repo root (directory containing .git).
 */
function findRepoRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    const fs = require('fs');
    if (fs.existsSync(path.join(dir, '.git'))) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  // No .git found — use cwd
  return startDir;
}

function parseOptions(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--platform' && args[i + 1]) {
      options.platform = args[++i];
    } else if (args[i] === '--pre-commit') {
      options.preCommit = true;
    } else if (args[i] === '--pre-push') {
      options.prePush = true;
    } else if (args[i] === '--staged-only') {
      options.stagedOnly = true;
    } else if (args[i] === '--gate') {
      options.gate = args[++i];
    } else if (args[i] === '--base') {
      options.base = args[++i];
    } else if (args[i] === '--tool' && args[i + 1]) {
      options.tool = args[++i];
    } else if (args[i] === '--scope' && args[i + 1]) {
      options.scope = args[++i];
    } else if (args[i] === '--rule' && args[i + 1]) {
      options.rule = args[++i];
    } else if (args[i] === '--reason' && args[i + 1]) {
      options.reason = args[++i];
    } else if (args[i] === '--expiry' && args[i + 1]) {
      options.expiry = parseInt(args[++i], 10);
    } else if (args[i] === '--file' && args[i + 1]) {
      options.file = args[++i];
    } else if (args[i] === '--list') {
      options.list = true;
    } else if (args[i] === '--active-only') {
      options.activeOnly = true;
    } else if (args[i] === '--process-expired') {
      options.processExpired = true;
    }
  }
  return options;
}

main();
