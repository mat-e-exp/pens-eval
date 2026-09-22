/**
 * Telemetry — Tier 3 Audit Logging + Grafana Integration
 *
 * From spec section 9: Tier 3 is Grafana Cloud for dashboard,
 * cross-repo visibility, and alerting.
 *
 * Also provides runtime hints (Phase 3): OpenTelemetry trace
 * recommendations and security headers checklist. These are
 * advisory — scoped as hints, not gates.
 */

'use strict';

const { readLog } = require('./audit');

/**
 * Export audit log entries in a format compatible with Grafana Loki.
 * Loki ingests newline-delimited JSON with labels.
 *
 * @param {string} repoRoot
 * @param {Object} [options]
 * @param {string} [options.logPath]
 * @returns {Object[]} Loki-compatible log entries
 */
function exportForGrafana(repoRoot, options = {}) {
  const entries = readLog(repoRoot, options.logPath);

  return entries.map(entry => ({
    stream: {
      job: 'devflow',
      repo: entry.repo || 'unknown',
      tool: entry.tool || 'unknown',
      severity: entry.severity || 'info',
    },
    values: [
      [String(new Date(entry.timestamp).getTime() * 1000000), JSON.stringify(entry)],
    ],
  }));
}

/**
 * Push audit entries to Grafana Loki.
 *
 * @param {string} lokiUrl - Loki push API URL
 * @param {Object[]} entries - Loki-formatted entries
 * @param {string} [authToken] - Bearer token for Grafana Cloud
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function pushToLoki(lokiUrl, entries, authToken) {
  if (entries.length === 0) {
    return { success: true };
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) {
      headers['Authorization'] = `Bearer ${authToken}`;
    }

    const response = await fetch(`${lokiUrl}/loki/api/v1/push`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ streams: entries }),
    });

    if (!response.ok) {
      return { success: false, error: `Loki push failed: HTTP ${response.status}` };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: `Loki push failed: ${err.message}` };
  }
}

/**
 * Runtime Hints — advisory checks that run after enforcement.
 * These are suggestions, not gates. They help improve code quality
 * beyond what automated tools can enforce.
 */
const RUNTIME_HINTS = {
  'security-headers': {
    name: 'Security Headers Checklist',
    description: 'Verify HTTP security headers are configured',
    checks: [
      { header: 'Strict-Transport-Security', severity: 'high', suggestion: 'Add HSTS header with min 1 year max-age' },
      { header: 'Content-Security-Policy', severity: 'high', suggestion: 'Define CSP to prevent XSS' },
      { header: 'X-Content-Type-Options', severity: 'medium', suggestion: 'Set to nosniff' },
      { header: 'X-Frame-Options', severity: 'medium', suggestion: 'Set to DENY or SAMEORIGIN' },
      { header: 'Referrer-Policy', severity: 'low', suggestion: 'Set to strict-origin-when-cross-origin' },
      { header: 'Permissions-Policy', severity: 'low', suggestion: 'Restrict browser feature access' },
    ],
  },
  'otel-traces': {
    name: 'OpenTelemetry Tracing',
    description: 'Check for distributed tracing instrumentation',
    patterns: {
      python: ['opentelemetry', 'from opentelemetry'],
      typescript: ['@opentelemetry/api', '@opentelemetry/sdk-trace'],
      go: ['go.opentelemetry.io/otel'],
      java: ['io.opentelemetry'],
    },
  },
};

/**
 * Generate runtime hints for a repository.
 *
 * @param {Object} plan - Enforcement plan
 * @returns {Object[]} Array of hints
 */
function generateRuntimeHints(plan) {
  const hints = [];
  const languages = plan.stacks.map(s => s.language);

  // Web service hints
  const webLanguages = ['python', 'typescript', 'javascript', 'go', 'java', 'ruby'];
  if (languages.some(l => webLanguages.includes(l))) {
    hints.push({
      type: 'security-headers',
      ...RUNTIME_HINTS['security-headers'],
    });
  }

  // OTel hints
  hints.push({
    type: 'otel-traces',
    ...RUNTIME_HINTS['otel-traces'],
    applicableLanguages: languages.filter(l => RUNTIME_HINTS['otel-traces'].patterns[l]),
  });

  return hints;
}

module.exports = {
  exportForGrafana,
  pushToLoki,
  generateRuntimeHints,
  RUNTIME_HINTS,
};
