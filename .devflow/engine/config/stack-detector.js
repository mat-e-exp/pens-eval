/**
 * Stack Detector
 *
 * Scans a repository to detect which language stacks are present and
 * where they live. Supports multi-stack repos — each stack is scoped
 * to a path independently.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { LANGUAGE_TOOLS } = require('../core/enforcement-plan');

/**
 * File markers that indicate a language is present.
 * Each marker is a filename or glob-like pattern checked at directory level.
 */
const LANGUAGE_MARKERS = {
  python: {
    files: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile', 'setup.cfg'],
    extensions: ['.py'],
  },
  typescript: {
    files: ['tsconfig.json'],
    extensions: ['.ts', '.tsx'],
  },
  javascript: {
    files: ['package.json'],
    extensions: ['.js', '.jsx'],
    // Only detect JS if no tsconfig.json in same scope (TS takes priority)
    excludeIf: ['tsconfig.json'],
  },
  go: {
    files: ['go.mod'],
    extensions: ['.go'],
  },
  java: {
    files: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    extensions: ['.java'],
  },
  rust: {
    files: ['Cargo.toml'],
    extensions: ['.rs'],
  },
  ruby: {
    files: ['Gemfile'],
    extensions: ['.rb'],
  },
  terraform: {
    files: [],
    extensions: ['.tf'],
  },
};

/**
 * Detect language stacks in a repository.
 *
 * Scans top-level and one level of subdirectories. Returns an array of
 * detected stacks with their scoped paths.
 *
 * @param {string} repoRoot - Absolute path to repository root
 * @returns {StackEntry[]}
 */
function detectStacks(repoRoot) {
  const stacks = [];
  const dirsToScan = ['.'];

  // Scan one level of subdirectories
  try {
    const entries = fs.readdirSync(repoRoot, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
        dirsToScan.push(entry.name);
      }
    }
  } catch {
    // If we can't read the root, just scan root
  }

  for (const dir of dirsToScan) {
    const absDir = path.join(repoRoot, dir);
    const detected = detectLanguagesInDir(absDir);

    for (const language of detected) {
      const tools = LANGUAGE_TOOLS[language];
      if (!tools) continue;

      const scopePath = dir === '.' ? '.' : `${dir}/`;
      // Avoid duplicate stack entries
      if (!stacks.some(s => s.language === language && s.path === scopePath)) {
        stacks.push({
          language,
          path: scopePath,
          tools: { ...tools },
        });
      }
    }
  }

  return stacks;
}

/**
 * Detect which languages are present in a single directory.
 *
 * @param {string} dirPath - Absolute path to directory
 * @returns {string[]} Array of language identifiers
 */
function detectLanguagesInDir(dirPath) {
  const detected = [];

  let files;
  try {
    files = fs.readdirSync(dirPath);
  } catch {
    return detected;
  }

  for (const [language, markers] of Object.entries(LANGUAGE_MARKERS)) {
    // Check marker files
    const hasMarkerFile = markers.files.some(f => files.includes(f));

    // Check file extensions (sample — don't scan entire tree)
    const hasExtension = markers.extensions.some(ext =>
      files.some(f => f.endsWith(ext))
    );

    if (hasMarkerFile || hasExtension) {
      // Check exclusion rule (e.g. JS excluded if TS detected in same dir)
      if (markers.excludeIf && markers.excludeIf.some(f => files.includes(f))) {
        continue;
      }
      detected.push(language);
    }
  }

  return detected;
}

module.exports = {
  detectStacks,
  detectLanguagesInDir,
  LANGUAGE_MARKERS,
};
