/**
 * Mythos Integration Slot
 *
 * From spec section 4.4: When Mythos becomes available via API,
 * it slots into devflow as a CI scan module replacing or augmenting
 * CodeQL. The modular architecture requires no core changes.
 *
 * This module is a placeholder — the integration slot is designed now,
 * the build happens when API access opens.
 */

'use strict';

/** @type {ModuleDefinition} */
const mythosModule = {
  id: 'mythos',
  name: 'Anthropic Mythos Deep Security Scan',
  type: 'security',
  version: '0.0.1',
  optional: true,

  detect: () => false,

  ciJobs: [
    {
      id: 'mythos-scan',
      name: 'Mythos deep security scan',
      tool: 'mythos',
      command: 'mythos', // placeholder — actual CLI TBD
      args: ['scan', '--format', 'sarif'],
      scope: '**/*',
      failPolicy: 'open-notify',
      severity: 'critical',
    },
  ],

  extendPlan(plan) {
    return {
      ...plan,
      failPolicy: {
        ...plan.failPolicy,
        mythos: plan._moduleConfig?.mythos?.failPolicy || 'open-notify',
      },
    };
  },

  config: {
    apiKey: null, // From Infisical
    replaceCodeQL: false, // When true, mythos replaces CodeQL instead of augmenting
    failPolicy: 'open-notify',
  },
};

module.exports = mythosModule;
