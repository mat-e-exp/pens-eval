/**
 * Test Runner Module
 *
 * Detects test frameworks in a repository and adds CI jobs to run them.
 * Does not run in pre-commit (too slow). Fail policy is closed — tests
 * must pass to merge.
 *
 * Detects: pytest, vitest, jest, mocha, go test, cargo test, rspec, minitest.
 * Configurable coverage threshold via .devflow/config.yml testing.coverageThreshold.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Test framework definitions.
 * Each entry maps detection signals to the command needed to run tests.
 */
const TEST_FRAMEWORKS = {
  pytest: {
    language: 'python',
    detect: (dir) => hasFile(dir, 'pytest.ini') ||
      hasFile(dir, 'pyproject.toml') && fileContains(dir, 'pyproject.toml', '[tool.pytest') ||
      hasFile(dir, 'conftest.py') ||
      hasFile(dir, 'tests/conftest.py'),
    command: 'pytest',
    args: [],
    coverageArgs: ['--cov', '--cov-report=json', '--cov-fail-under'],
  },
  vitest: {
    language: 'javascript',
    detect: (dir) => hasFile(dir, 'vitest.config.ts') ||
      hasFile(dir, 'vitest.config.js') ||
      hasFile(dir, 'vitest.config.mts') ||
      packageJsonHas(dir, 'vitest', 'devDependencies') ||
      packageJsonHas(dir, 'vitest', 'scripts'),
    command: 'npx',
    args: ['vitest', 'run'],
    coverageArgs: ['--coverage', '--coverage.thresholds.lines'],
  },
  jest: {
    language: 'javascript',
    detect: (dir) => hasFile(dir, 'jest.config.js') ||
      hasFile(dir, 'jest.config.ts') ||
      hasFile(dir, 'jest.config.mjs') ||
      packageJsonHas(dir, 'jest', 'devDependencies') ||
      packageJsonHas(dir, 'jest', 'scripts'),
    command: 'npx',
    args: ['jest', '--ci'],
    coverageArgs: ['--coverage', '--coverageThreshold=\'{"global":{"lines":'],
  },
  mocha: {
    language: 'javascript',
    detect: (dir) => hasFile(dir, '.mocharc.yml') ||
      hasFile(dir, '.mocharc.js') ||
      hasFile(dir, '.mocharc.json') ||
      packageJsonHas(dir, 'mocha', 'devDependencies'),
    command: 'npx',
    args: ['mocha'],
    coverageArgs: null,
  },
  'go-test': {
    language: 'go',
    detect: (dir) => hasFile(dir, 'go.mod') && hasTestFiles(dir, '_test.go'),
    command: 'go',
    args: ['test', './...'],
    coverageArgs: ['-coverprofile=coverage.out', '-covermode=atomic'],
  },
  'cargo-test': {
    language: 'rust',
    detect: (dir) => hasFile(dir, 'Cargo.toml') && fileContains(dir, 'Cargo.toml', '[dev-dependencies]'),
    command: 'cargo',
    args: ['test'],
    coverageArgs: null,
  },
  rspec: {
    language: 'ruby',
    detect: (dir) => hasFile(dir, '.rspec') ||
      hasFile(dir, 'spec/spec_helper.rb'),
    command: 'bundle',
    args: ['exec', 'rspec'],
    coverageArgs: null,
  },
};

/** @type {ModuleDefinition} */
const testRunnerModule = {
  id: 'test-runner',
  name: 'Test Runner',
  type: 'quality-gate',
  version: '1.0.0',
  optional: false,

  /**
   * Detect if any test framework is present in the repo.
   */
  detect(repoRoot) {
    return detectFrameworks(repoRoot).length > 0;
  },

  /**
   * Extend plan — add test runner CI jobs for each detected framework.
   */
  extendPlan(plan) {
    const repoRoot = plan._repoRoot;
    if (!repoRoot) return plan;

    const config = plan._config || {};
    const testing = config.testing || {};
    const coverageThreshold = testing.coverageThreshold || 0;
    const commandOverride = testing.command || null;

    const jobs = [];
    const detections = detectFrameworksFromStacks(repoRoot, plan.stacks);

    for (const detection of detections) {
      const { framework, stackPath } = detection;
      const prefix = stackPath === '.' ? '' : stackPath;
      const suffix = prefix ? '-' + prefix.replace(/\/$/, '') : '';
      const prefixArgs = prefix ? ['--prefix', prefix.replace(/\/$/, '')] : [];

      let command, args;
      if (commandOverride) {
        // User override — split on space for command + args
        const parts = commandOverride.split(' ');
        command = parts[0];
        args = parts.slice(1);
      } else {
        command = framework.command;
        args = [...framework.args];

        // Add coverage threshold if configured and framework supports it
        if (coverageThreshold > 0 && framework.coverageArgs) {
          if (framework.command === 'pytest') {
            args.push(...framework.coverageArgs, String(coverageThreshold));
          } else if (framework.command === 'npx' && framework.args[0] === 'vitest') {
            args.push(framework.coverageArgs[0], `${framework.coverageArgs[1]}=${coverageThreshold}`);
          }
        }
      }

      jobs.push({
        id: `test${suffix}`,
        name: `Run tests${prefix ? ' (' + prefix + ')' : ''}`,
        tool: 'test',
        command,
        args,
        scope: prefix || '.',
        failPolicy: 'closed',
        severity: 'high',
        language: framework.language,
      });
    }

    if (jobs.length === 0) {
      // No test framework detected — add a warning job that always passes
      // but emits a finding
      jobs.push({
        id: 'test-missing',
        name: 'No test framework detected',
        tool: 'test',
        command: null,
        args: [],
        scope: '.',
        failPolicy: 'open-notify',
        severity: 'medium',
        warning: 'No test framework detected. Tests are not enforced.',
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
        test: 'closed',
      },
    };
  },
};

/**
 * Detect frameworks by checking each stack's directory.
 */
function detectFrameworksFromStacks(repoRoot, stacks) {
  const detections = [];
  const seen = new Set();

  for (const stack of stacks) {
    const dir = stack.path === '.' ? repoRoot : path.join(repoRoot, stack.path);
    for (const [name, framework] of Object.entries(TEST_FRAMEWORKS)) {
      if (framework.language !== stack.language) continue;
      const key = `${name}:${stack.path}`;
      if (seen.has(key)) continue;
      try {
        if (framework.detect(dir)) {
          seen.add(key);
          detections.push({ name, framework, stackPath: stack.path });
          break; // One framework per stack path
        }
      } catch { /* skip unreadable dirs */ }
    }
  }

  return detections;
}

/**
 * Detect any framework in the repo (for module-level detect()).
 */
function detectFrameworks(repoRoot) {
  const found = [];

  // Check root
  for (const [name, framework] of Object.entries(TEST_FRAMEWORKS)) {
    try {
      if (framework.detect(repoRoot)) {
        found.push(name);
        break;
      }
    } catch { /* skip */ }
  }
  if (found.length > 0) return found;

  // Check one level of subdirectories
  try {
    const entries = fs.readdirSync(repoRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const subdir = path.join(repoRoot, entry.name);
      for (const [name, framework] of Object.entries(TEST_FRAMEWORKS)) {
        try {
          if (framework.detect(subdir)) {
            found.push(name);
            break;
          }
        } catch { /* skip */ }
      }
      if (found.length > 0) return found;
    }
  } catch { /* skip */ }

  return found;
}

// --- Detection helpers ---

function hasFile(dir, filename) {
  return fs.existsSync(path.join(dir, filename));
}

function fileContains(dir, filename, substring) {
  try {
    const content = fs.readFileSync(path.join(dir, filename), 'utf8');
    return content.includes(substring);
  } catch {
    return false;
  }
}

function packageJsonHas(dir, keyword, section) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (section === 'devDependencies') {
      return !!(pkg.devDependencies && pkg.devDependencies[keyword]);
    }
    if (section === 'scripts') {
      return !!(pkg.scripts && Object.values(pkg.scripts).some(v => v.includes(keyword)));
    }
    return false;
  } catch {
    return false;
  }
}

function hasTestFiles(dir, suffix) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: false });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(suffix)) return true;
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const subEntries = fs.readdirSync(path.join(dir, entry.name));
        if (subEntries.some(f => f.endsWith(suffix))) return true;
      }
    }
  } catch { /* skip */ }
  return false;
}

module.exports = testRunnerModule;
module.exports.TEST_FRAMEWORKS = TEST_FRAMEWORKS;
module.exports.detectFrameworks = detectFrameworks;
