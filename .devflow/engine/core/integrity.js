/**
 * Integrity Verification
 *
 * Verifies that the installed devflow binary matches the published
 * checksum from the signed GitHub Release. This is the npm verification
 * shim described in spec section 5.2.
 *
 * Flow:
 * 1. On `npm install`, postinstall script calls verify()
 * 2. verify() reads the local package checksum
 * 3. Fetches the published checksum from GitHub Releases
 * 4. Compares — if mismatch, warns loudly but does not block
 *    (blocking would break offline installs)
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CHECKSUM_ALGORITHM = 'sha256';
const CHECKSUMS_FILENAME = 'checksums.sha256';

/**
 * Generate a SHA-256 checksum for a file.
 *
 * @param {string} filePath - Absolute path to file
 * @returns {string} Hex-encoded checksum
 */
function checksumFile(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash(CHECKSUM_ALGORITHM).update(content).digest('hex');
}

/**
 * Generate checksums for all distributable files.
 * Used during the release build process.
 *
 * @param {string} distDir - Path to dist directory
 * @returns {Object.<string, string>} Map of filename to checksum
 */
function generateChecksums(distDir) {
  const checksums = {};
  const files = fs.readdirSync(distDir).filter(f => !f.startsWith('.'));

  for (const file of files) {
    const filePath = path.join(distDir, file);
    if (fs.statSync(filePath).isFile()) {
      checksums[file] = checksumFile(filePath);
    }
  }

  return checksums;
}

/**
 * Write checksums to a file in standard sha256sum format.
 *
 * @param {Object.<string, string>} checksums
 * @param {string} outputPath
 */
function writeChecksumFile(checksums, outputPath) {
  const lines = Object.entries(checksums)
    .map(([file, hash]) => `${hash}  ${file}`)
    .join('\n');
  fs.writeFileSync(outputPath, lines + '\n');
}

/**
 * Parse a checksums file in standard sha256sum format.
 *
 * @param {string} content - File content
 * @returns {Object.<string, string>} Map of filename to checksum
 */
function parseChecksumFile(content) {
  const checksums = {};
  for (const line of content.trim().split('\n')) {
    const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
    if (match) {
      checksums[match[2]] = match[1];
    }
  }
  return checksums;
}

/**
 * Verify the installed package against published checksums.
 * Fetches checksum from GitHub Releases for the current version.
 *
 * @param {Object} options
 * @param {string} options.packageDir - Path to installed package root
 * @param {string} options.version - Package version
 * @param {string} options.repo - GitHub repo (org/name)
 * @returns {Promise<{verified: boolean, reason: string}>}
 */
async function verifyInstallation({ packageDir, version, repo }) {
  try {
    const checksumsUrl = `https://github.com/${repo}/releases/download/v${version}/${CHECKSUMS_FILENAME}`;

    const response = await fetch(checksumsUrl);
    if (!response.ok) {
      return { verified: false, reason: `Could not fetch checksums: HTTP ${response.status}` };
    }

    const content = await response.text();
    const published = parseChecksumFile(content);

    const tarball = `devflow-${version}.tgz`;
    if (!published[tarball]) {
      return { verified: false, reason: `No checksum found for ${tarball}` };
    }

    const localTarball = path.join(packageDir, tarball);
    if (!fs.existsSync(localTarball)) {
      // npm unpacks the tarball — verify package.json instead as a fingerprint
      const pkgPath = path.join(packageDir, 'package.json');
      if (!fs.existsSync(pkgPath)) {
        return { verified: false, reason: 'Cannot locate package files for verification' };
      }
      // In npm install context, we can't verify the tarball directly.
      // Log that verification was attempted but inconclusive.
      return { verified: false, reason: 'Tarball not available post-install — verification inconclusive' };
    }

    const localChecksum = checksumFile(localTarball);
    if (localChecksum === published[tarball]) {
      return { verified: true, reason: 'Checksum matches published release' };
    }

    return { verified: false, reason: `Checksum mismatch: expected ${published[tarball]}, got ${localChecksum}` };
  } catch (err) {
    return { verified: false, reason: `Verification failed: ${err.message}` };
  }
}

module.exports = {
  checksumFile,
  generateChecksums,
  writeChecksumFile,
  parseChecksumFile,
  verifyInstallation,
  CHECKSUM_ALGORITHM,
  CHECKSUMS_FILENAME,
};
