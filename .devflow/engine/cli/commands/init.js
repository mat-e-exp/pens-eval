/**
 * devflow init
 *
 * Detect stack, generate CI config, install pre-commit hooks.
 * From spec section 2.3: Scanning, configuring, installing.
 */

'use strict';

const orchestrator = require('../../core/orchestrator');
const { installPreCommitHook, installPrePushHook } = require('../../core/hooks');
const { checkPlanTools } = require('../../core/tool-check');
const { generateSetupGuide } = require('../../core/setup-guide');
const { writeAgentInstructions } = require('../../core/agent-instructions');
const { printRequiredChecks } = require('../../core/required-checks');

function init(repoRoot, options) {
  console.log('devflow: Scanning repository...\n');

  const result = orchestrator.init(repoRoot, options);

  // Report detected stacks
  for (const stack of result.stacks) {
    console.log(`  Found: ${stack.language} → ${stack.path}`);
  }
  console.log('');

  // Report platform
  console.log(`  Platform: ${result.platform}`);

  // Report modules
  if (result.modules.length > 0) {
    console.log(`  Modules: ${result.modules.join(', ')}`);
  }

  // Report generated files
  console.log(`\n  Generated ${result.files.length} CI config files:`);
  for (const file of result.files) {
    console.log(`    ${file.path}`);
  }

  // Check tool availability and generate setup guide
  const { installed, missing } = checkPlanTools(result.plan);
  const languages = result.stacks.map(s => s.language);
  const guidePath = generateSetupGuide(repoRoot, { languages, missing });

  if (missing.length > 0) {
    console.log('\n  Missing tools (pre-commit hooks will skip these):');
    for (const m of missing) {
      console.log(`    ${m.tool} — install with: ${m.install}`);
    }
    console.log(`\n  Full setup guide: ${guidePath}`);
  }

  // Install pre-commit hook
  console.log('');
  try {
    const hookResult = installPreCommitHook(repoRoot);
    if (hookResult.existing) {
      console.log('  Pre-commit hook updated.');
    } else {
      console.log('  Pre-commit hook installed.');
    }
  } catch (err) {
    console.log(`  Pre-commit hook skipped: ${err.message}`);
  }

  // Install pre-push hook if test-runner module is active
  if (result.modules.includes('test-runner')) {
    try {
      const testing = result.plan._config?.testing || {};
      const timeout = testing.prePushTimeout || 30;
      const prePush = testing.prePush !== false; // default: true

      if (prePush) {
        const pushResult = installPrePushHook(repoRoot, { timeout });
        if (pushResult.existing) {
          console.log(`  Pre-push hook updated (tests, ${timeout}s timeout).`);
        } else {
          console.log(`  Pre-push hook installed (tests, ${timeout}s timeout).`);
        }
      }
    } catch (err) {
      console.log(`  Pre-push hook skipped: ${err.message}`);
    }
  }

  // Write enforcement rules into the AI agent instruction file(s)
  const agent = writeAgentInstructions(repoRoot, result.plan, result.plan._config || {});
  if (agent.enabled) {
    for (const w of agent.written) {
      console.log(`  Agent instructions ${w.created ? 'created' : 'updated'}: ${w.path}`);
    }
  }

  printRequiredChecks(result.plan);

  console.log('\nDone. devflow is active.\n');
}

module.exports = init;
