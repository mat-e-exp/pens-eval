/**
 * devflow update
 *
 * Regenerate CI config and the agent-instruction block from the current
 * enforcement plan. Only overwrites devflow-managed files / blocks.
 */

'use strict';

const orchestrator = require('../../core/orchestrator');
const { writeAgentInstructions } = require('../../core/agent-instructions');
const { printRequiredChecks } = require('../../core/required-checks');

function update(repoRoot) {
  console.log('devflow: Updating CI configuration...\n');

  const result = orchestrator.update(repoRoot);

  console.log(`  Platform: ${result.platform}`);
  console.log(`  Updated ${result.files.filter(f => f.overwrite).length} files:`);

  for (const file of result.files) {
    if (file.overwrite) {
      console.log(`    ${file.path}`);
    }
  }

  const agent = writeAgentInstructions(repoRoot, result.plan, result.plan._config || {});
  if (agent.enabled) {
    for (const w of agent.written) {
      console.log(`  Agent instructions ${w.created ? 'created' : 'updated'}: ${w.path}`);
    }
  }

  printRequiredChecks(result.plan);

  console.log('\nDone.\n');
}

module.exports = update;
