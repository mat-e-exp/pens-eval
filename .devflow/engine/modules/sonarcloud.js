/**
 * SonarCloud Optional Module
 *
 * From spec section Phase 0: SonarCloud ships as an optional module.
 * Slots into the quality gate alongside Semgrep and CodeQL.
 * Validates the module architecture works for external quality gate tools.
 *
 * This module is opt-in — teams with existing SonarCloud paid tiers
 * can enable it without it being forced on everyone else.
 */

'use strict';

/** @type {ModuleDefinition} */
const sonarcloudModule = {
  id: 'sonarcloud',
  name: 'SonarCloud Quality Gate',
  type: 'quality-gate',
  version: '1.0.0',
  optional: true,

  /**
   * SonarCloud doesn't auto-detect — it's explicitly enabled in config.
   * Always returns false for auto-detection; must be listed in config.modules.
   */
  detect: () => false,

  /**
   * CI job for SonarCloud analysis.
   */
  ciJobs: [
    {
      id: 'sonarcloud-analysis',
      name: 'SonarCloud analysis',
      tool: 'sonarcloud',
      command: 'sonar-scanner',
      args: [],
      scope: '**/*',
      failPolicy: 'open-notify',
      severity: 'medium',
    },
  ],

  /**
   * Extend the enforcement plan with SonarCloud-specific config.
   * Adds the SonarCloud quality gate as a merge requirement if configured
   * to block on failure.
   */
  extendPlan(plan) {
    const config = plan._moduleConfig?.sonarcloud || {};

    // If configured to block, add to merge gate
    if (config.blockOnFailure) {
      return {
        ...plan,
        mergeGate: {
          ...plan.mergeGate,
          requiredChecks: [...plan.mergeGate.requiredChecks, 'sonarcloud-analysis'],
        },
        failPolicy: {
          ...plan.failPolicy,
          sonarcloud: 'closed',
        },
      };
    }

    return {
      ...plan,
      failPolicy: {
        ...plan.failPolicy,
        sonarcloud: config.failPolicy || 'open-notify',
      },
    };
  },

  /**
   * Default configuration for SonarCloud module.
   */
  config: {
    organization: null,
    projectKey: null,
    blockOnFailure: false,
    failPolicy: 'open-notify',
  },
};

module.exports = sonarcloudModule;
