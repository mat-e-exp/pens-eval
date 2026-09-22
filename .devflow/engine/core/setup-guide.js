/**
 * Setup Guide Generator
 *
 * Generates .devflow/setup.md — a persistent, repo-specific reference
 * for what tools need to be installed locally. Written on `devflow init`,
 * tailored to the detected stacks.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Tool prerequisites grouped by what triggers them.
 */
const PREREQUISITES = {
  // Always required
  core: [
    { tool: 'trivy', purpose: 'Secrets + CVE scanning', install: { brew: 'brew install trivy', other: 'https://trivy.dev/docs/getting-started/installation/' } },
    { tool: 'semgrep', purpose: 'Security pattern scanning', install: { pip: 'pip install semgrep', brew: 'brew install semgrep', other: 'https://semgrep.dev/docs/getting-started/' } },
  ],

  // Per-language
  python: [
    { tool: 'ruff', purpose: 'Python linting + formatting', install: { pip: 'pip install ruff' } },
    { tool: 'black', purpose: 'Python code formatting', install: { pip: 'pip install black' } },
    { tool: 'bandit', purpose: 'Python security scanning', install: { pip: 'pip install bandit' } },
    { tool: 'pip-audit', purpose: 'Python dependency provenance', install: { pip: 'pip install pip-audit' } },
    { tool: 'pip-licenses', purpose: 'Python licence compliance', install: { pip: 'pip install pip-licenses' } },
  ],
  javascript: [
    { tool: 'eslint', purpose: 'JavaScript linting + security', install: { npm: 'npm install -g eslint' } },
    { tool: 'prettier', purpose: 'JavaScript formatting', install: { npm: 'npm install -g prettier' } },
  ],
  typescript: [
    { tool: 'eslint', purpose: 'TypeScript linting + security', install: { npm: 'npm install -g eslint' } },
    { tool: 'prettier', purpose: 'TypeScript formatting', install: { npm: 'npm install -g prettier' } },
  ],
  go: [
    { tool: 'golangci-lint', purpose: 'Go linting', install: { brew: 'brew install golangci-lint', go: 'go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest' } },
    { tool: 'gosec', purpose: 'Go security scanning', install: { go: 'go install github.com/securego/gosec/v2/cmd/gosec@latest' } },
    { tool: 'go-licenses', purpose: 'Go licence compliance', install: { go: 'go install github.com/google/go-licenses@latest' } },
  ],
  java: [
    { tool: 'checkstyle', purpose: 'Java linting', install: { brew: 'brew install checkstyle' } },
    { tool: 'spotbugs', purpose: 'Java security scanning', install: { brew: 'brew install spotbugs' } },
  ],
  rust: [
    { tool: 'clippy', purpose: 'Rust linting', install: { rustup: 'rustup component add clippy' } },
    { tool: 'rustfmt', purpose: 'Rust formatting', install: { rustup: 'rustup component add rustfmt' } },
    { tool: 'cargo-audit', purpose: 'Rust dependency audit', install: { cargo: 'cargo install cargo-audit' } },
    { tool: 'cargo-license', purpose: 'Rust licence compliance', install: { cargo: 'cargo install cargo-license' } },
  ],
  ruby: [
    { tool: 'rubocop', purpose: 'Ruby linting', install: { gem: 'gem install rubocop' } },
    { tool: 'brakeman', purpose: 'Ruby security scanning', install: { gem: 'gem install brakeman' } },
    { tool: 'license_finder', purpose: 'Ruby licence compliance', install: { gem: 'gem install license_finder' } },
  ],
  terraform: [
    { tool: 'tflint', purpose: 'Terraform linting', install: { brew: 'brew install tflint' } },
    { tool: 'tfsec', purpose: 'Terraform security scanning', install: { brew: 'brew install tfsec' } },
  ],

  // Optional
  secrets: [
    { tool: 'infisical', purpose: 'Secrets management', install: { brew: 'brew install infisical/get-cli/infisical', other: 'https://infisical.com/docs/cli/overview' } },
  ],
};

/**
 * Generate .devflow/setup.md for a repository.
 *
 * @param {string} repoRoot
 * @param {Object} options
 * @param {string[]} options.languages - Detected languages
 * @param {Array<{tool: string, install: string}>} options.missing - Missing tools from checkPlanTools
 */
function generateSetupGuide(repoRoot, { languages, missing }) {
  const lines = [
    '# devflow Setup Guide',
    '',
    'Prerequisites for local development. Install these tools to get full',
    'pre-commit enforcement. Without them, checks run in CI only.',
    '',
    '## Core Tools (all projects)',
    '',
  ];

  for (const tool of PREREQUISITES.core) {
    const installCmd = tool.install.brew || tool.install.pip || tool.install.other;
    lines.push(`- **${tool.tool}** — ${tool.purpose}`);
    lines.push(`  \`\`\`${installCmd}\`\`\``);
  }

  // Per-language tools
  const seen = new Set();
  for (const lang of languages) {
    const tools = PREREQUISITES[lang];
    if (!tools) continue;

    lines.push('', `## ${lang.charAt(0).toUpperCase() + lang.slice(1)} Tools`, '');
    for (const tool of tools) {
      if (seen.has(tool.tool)) continue;
      seen.add(tool.tool);
      const installCmd = tool.install.npm || tool.install.pip || tool.install.brew ||
        tool.install.go || tool.install.gem || tool.install.rustup || tool.install.cargo || tool.install.other;
      lines.push(`- **${tool.tool}** — ${tool.purpose}`);
      lines.push(`  \`\`\`${installCmd}\`\`\``);
    }
  }

  // Quick install section
  lines.push('', '## Quick Install (copy-paste)', '', '```sh');
  const allInstalls = [];
  for (const tool of PREREQUISITES.core) {
    allInstalls.push(tool.install.brew || tool.install.pip);
  }
  for (const lang of languages) {
    const tools = PREREQUISITES[lang];
    if (!tools) continue;
    for (const tool of tools) {
      if (seen.has('quick-' + tool.tool)) continue;
      seen.add('quick-' + tool.tool);
      allInstalls.push(tool.install.npm || tool.install.pip || tool.install.brew ||
        tool.install.go || tool.install.gem || tool.install.rustup || tool.install.cargo);
    }
  }
  lines.push(allInstalls.filter(Boolean).join('\n'));
  lines.push('```', '');

  lines.push('## Optional', '');
  for (const tool of PREREQUISITES.secrets) {
    const installCmd = tool.install.brew || tool.install.other;
    lines.push(`- **${tool.tool}** — ${tool.purpose}`);
    lines.push(`  \`\`\`${installCmd}\`\`\``);
  }

  lines.push('', '---', 'Generated by `devflow init`. Regenerate with `devflow init`.');

  const guidePath = path.join(repoRoot, '.devflow', 'setup.md');
  const dir = path.dirname(guidePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(guidePath, lines.join('\n') + '\n');

  return guidePath;
}

module.exports = {
  generateSetupGuide,
  PREREQUISITES,
};
