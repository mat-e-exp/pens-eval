/**
 * Version Lookup
 *
 * devflow runs from two different layouts: its own checkout or npm install,
 * where `package.json` sits one level above `src/`, and the copy vendored
 * into a repository at `.devflow/engine/`, where it sits at the engine root.
 *
 * Resolving the version therefore cannot assume a single relative path, and
 * must never throw — a missing version is cosmetic, but an exception here
 * would stop every gate from running.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FALLBACK = '0.0.0';

/**
 * Candidate locations for the manifest, nearest first.
 *   ../..  — devflow's own checkout (src/core → repo root)
 *   ..     — vendored engine (.devflow/engine/core → .devflow/engine)
 */
function candidatePaths() {
  return [
    path.join(__dirname, '..', '..', 'package.json'),
    path.join(__dirname, '..', 'package.json'),
  ];
}

/**
 * devflow's version, or "0.0.0" when it cannot be determined.
 *
 * @returns {string}
 */
function devflowVersion() {
  for (const candidate of candidatePaths()) {
    try {
      const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      if (parsed && typeof parsed.version === 'string') return parsed.version;
    } catch {
      // Try the next candidate — absence is expected in one of the layouts.
    }
  }
  return FALLBACK;
}

module.exports = { devflowVersion, candidatePaths, FALLBACK };
