/**
 * Pre-commit Cache — Incremental Scanning
 *
 * From spec Phase 1 Week 4: "Caching is built in from the start —
 * pre-commit staying under 15 seconds as codebases grow requires
 * incremental scanning, not optimism."
 *
 * Caches checksums of scanned files. Only re-scans files that changed
 * since last successful scan. Cache is per-tool to allow partial invalidation.
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CACHE_DIR = '.devflow/cache';

/**
 * @typedef {Object} CacheEntry
 * @property {string} file - File path
 * @property {string} checksum - SHA-256 of file content
 * @property {string} tool - Tool that scanned it
 * @property {number} timestamp - Unix timestamp of last scan
 */

/**
 * Get the cache file path for a tool.
 */
function getCachePath(repoRoot, tool) {
  return path.join(repoRoot, CACHE_DIR, `${tool}.json`);
}

/**
 * Load cache for a specific tool.
 *
 * @param {string} repoRoot
 * @param {string} tool
 * @returns {Object.<string, CacheEntry>} Map of file path to cache entry
 */
function loadCache(repoRoot, tool) {
  const cachePath = getCachePath(repoRoot, tool);
  if (!fs.existsSync(cachePath)) return {};

  try {
    return JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  } catch {
    return {};
  }
}

/**
 * Save cache for a specific tool.
 *
 * @param {string} repoRoot
 * @param {string} tool
 * @param {Object.<string, CacheEntry>} cache
 */
function saveCache(repoRoot, tool, cache) {
  const cacheDir = path.join(repoRoot, CACHE_DIR);
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  fs.writeFileSync(getCachePath(repoRoot, tool), JSON.stringify(cache, null, 2) + '\n');
}

/**
 * Compute SHA-256 checksum of a file.
 */
function fileChecksum(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Filter a list of files to only those that changed since last scan.
 *
 * @param {string} repoRoot
 * @param {string} tool
 * @param {string[]} files - File paths relative to repoRoot
 * @returns {{ changed: string[], cached: string[] }}
 */
function filterChanged(repoRoot, tool, files) {
  const cache = loadCache(repoRoot, tool);
  const changed = [];
  const cached = [];

  for (const file of files) {
    const absPath = path.join(repoRoot, file);
    if (!fs.existsSync(absPath)) continue;

    const checksum = fileChecksum(absPath);
    const entry = cache[file];

    if (entry && entry.checksum === checksum) {
      cached.push(file);
    } else {
      changed.push(file);
    }
  }

  return { changed, cached };
}

/**
 * Update cache after a successful scan.
 *
 * @param {string} repoRoot
 * @param {string} tool
 * @param {string[]} files - Files that were scanned
 */
function updateCache(repoRoot, tool, files) {
  const cache = loadCache(repoRoot, tool);
  const now = Date.now();

  for (const file of files) {
    const absPath = path.join(repoRoot, file);
    if (!fs.existsSync(absPath)) continue;

    cache[file] = {
      file,
      checksum: fileChecksum(absPath),
      tool,
      timestamp: now,
    };
  }

  saveCache(repoRoot, tool, cache);
}

/**
 * Clear cache for a specific tool or all tools.
 *
 * @param {string} repoRoot
 * @param {string} [tool] - If omitted, clears all caches
 */
function clearCache(repoRoot, tool) {
  if (tool) {
    const cachePath = getCachePath(repoRoot, tool);
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  } else {
    const cacheDir = path.join(repoRoot, CACHE_DIR);
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true });
    }
  }
}

module.exports = {
  loadCache,
  saveCache,
  filterChanged,
  updateCache,
  clearCache,
  CACHE_DIR,
};
