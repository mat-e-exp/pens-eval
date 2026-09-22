/**
 * devflow check
 *
 * Run enforcement checks manually or as pre-commit hook.
 * From spec section 16.1: tool name, severity, finding, file, line, fix.
 *
 * Missing tools are skipped with a warning — a missing tool is not
 * a security failure, it's a setup issue.
 *
 * Every run writes .devflow/findings.json — machine-readable for AI tools.
 */

'use strict';

const { execSync } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');
const orchestrator = require('../../core/orchestrator');
const { checkTool } = require('../../core/tool-check');
const { formatFailure, formatWarning, GUIDANCE } = require('../../core/fix-guidance');
const { findOverride } = require('../../core/overrides');
const { createFinding, saveFindings } = require('../../core/findings');
const { appendHistory } = require('../../core/history');
const { scanLicences, mergePolicy } = require('../../core/licence-scanner');

/**
 * Build env for Trivy commands.
 * Sets DOCKER_CONFIG to an empty temp dir to avoid failures when
 * Docker Desktop is not running (docker-credential-desktop not found).
 */
function trivyEnv() {
  const emptyDockerDir = path.join(os.tmpdir(), 'devflow-docker-config');
  if (!fs.existsSync(emptyDockerDir)) {
    fs.mkdirSync(emptyDockerDir, { recursive: true });
    fs.writeFileSync(path.join(emptyDockerDir, 'config.json'), '{}');
  }
  return { ...process.env, DOCKER_CONFIG: emptyDockerDir };
}

function check(repoRoot, options = {}) {
  const { plan } = orchestrator.loadPlan(repoRoot);

  if (options.preCommit) {
    return runPreCommitChecks(plan, repoRoot, options);
  }

  if (options.prePush) {
    return runPrePushChecks(plan, repoRoot);
  }

  if (options.gate) {
    return runSingleGate(plan, repoRoot, options);
  }

  return runAllChecks(plan, repoRoot);
}

/**
 * Run one gate against a commit range. This is how a gate that lives inside
 * devflow — and therefore has no external tool for a runner to install — is
 * enforced in CI. It asks the pre-commit question again where it cannot be
 * skipped, so `--no-verify` and "never installed devflow" are both caught.
 *
 * Invoked as: devflow check --gate <hook-id> [--base <ref>]
 */
function runSingleGate(plan, repoRoot, options) {
  const hook = plan.preCommit.hooks.find(h => h.id === options.gate);

  if (!hook) {
    const available = plan.preCommit.hooks.map(h => h.id).join(', ');
    console.error(`devflow: no gate "${options.gate}" in this plan. Available: ${available}`);
    process.exit(2);
  }

  if (!hook.internal) {
    console.error(`devflow: "${options.gate}" is not an internal gate — it runs as its own CI job.`);
    process.exit(2);
  }

  const { resolveRange } = require('../../core/ci-range');
  const { range, source } = resolveRange(options);

  console.log(`devflow: ${hook.id} over ${range} (${source})\n`);

  const results = runInternalHook(hook, plan, repoRoot, { mode: 'range', range });
  const findings = results.map(r => r.finding);
  saveFindings(repoRoot, findings);
  appendHistory(repoRoot, { trigger: `gate:${hook.id}`, summary: { range }, findings });

  if (results.some(r => r.type === 'block')) {
    console.log(`\ndevflow: ${hook.id} failed. These changes reached the branch without passing the pre-commit gate.`);
    process.exit(1);
  }

  console.log(`\ndevflow: ${hook.id} passed.`);
}

function runPreCommitChecks(plan, repoRoot, options) {
  const hooks = plan.preCommit.hooks;
  let failures = 0;
  let skipped = 0;
  const findings = [];
  const stagedFiles = getStagedFiles(repoRoot);

  console.log('devflow: Running pre-commit checks...\n');

  if (stagedFiles.length === 0) {
    console.log('  No staged files. Nothing to check.\n');
    return;
  }

  for (const hook of hooks) {
    // Internal hooks run inside devflow — no external tool to shell out to
    if (hook.internal) {
      const results = runInternalHook(hook, plan, repoRoot, { mode: 'pre-commit', stagedFiles });
      for (const r of results) findings.push(r.finding);
      // One hook = one check, however many findings it produced
      if (results.some(r => r.type === 'block')) failures++;
      else if (results.some(r => r.type === 'skipped')) skipped++;
      continue;
    }

    if (!isToolAvailable(hook.command)) {
      skipped++;
      printSkipped(hook);
      findings.push(createFinding(hook, null, 'skipped'));
      continue;
    }

    const result = runToolPreCommit(hook, repoRoot, stagedFiles);

    if (result.exitCode !== 0) {
      if (result.notFound || result.noConfig) {
        skipped++;
        result.noConfig ? printSkippedNoConfig(hook) : printSkipped(hook);
        findings.push(createFinding(hook, result, 'skipped'));
      } else if (hook.failPolicy === 'closed') {
        const override = activeOverrideFor(hook, repoRoot);
        if (override) {
          printOverridden(hook, override);
        } else {
          failures++;
          printFailure(hook, result);
        }
        findings.push(createFinding(hook, result, 'failed')); // saveFindings flips to 'overridden' when an override is active
      } else {
        printWarning(hook, result);
        findings.push(createFinding(hook, result, 'warning'));
      }
    } else {
      printPass(hook);
      findings.push(createFinding(hook, result, 'passed'));
    }
  }

  // Save findings and append to history
  const report = saveFindings(repoRoot, findings);
  appendHistory(repoRoot, { trigger: 'pre-commit', summary: report.summary, findings });

  if (skipped > 0) {
    console.log(`\n  ${skipped} tool(s) not installed locally — skipped. CI will catch these.`);
  }

  console.log(`\n  Findings saved to .devflow/findings.json`);

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed. Fix issues or run 'devflow override'.`);
    process.exit(1);
  }

  console.log('\nAll pre-commit checks passed.');
}

function runPrePushChecks(plan, repoRoot) {
  const testJobs = plan.ciOnPush.jobs.filter(j => j.tool === 'test' && j.command);

  if (testJobs.length === 0) {
    console.log('devflow: no test framework detected. Skipping pre-push tests.');
    return;
  }

  console.log('devflow: Running pre-push tests...\n');
  let failures = 0;

  for (const job of testJobs) {
    if (!isToolAvailable(job.command)) {
      console.log(`  ○ ${job.id} — skipped (${job.command} not installed)`);
      continue;
    }

    const result = runTool(job, repoRoot);
    if (result.exitCode !== 0) {
      failures++;
      console.log(`  ✗ ${job.id} — tests failed`);
      if (result.output) console.log(result.output);
      if (result.error) console.log(result.error);
    } else {
      console.log(`  ✓ ${job.id}`);
    }
  }

  if (failures > 0) {
    console.log(`\ndevflow: ${failures} test suite(s) failed.`);
    process.exit(1);
  }

  console.log('\nAll tests passed.');
}

function runAllChecks(plan, repoRoot) {
  console.log('devflow: Running all checks...\n');

  const allHooks = [
    ...plan.preCommit.hooks,
    ...plan.ciOnPush.jobs.filter(j =>
      !plan.preCommit.hooks.some(h => h.id === j.id) && j.command && !j.ciOnly
    ),
  ];

  let failures = 0;
  let warnings = 0;
  let skipped = 0;
  const findings = [];

  for (const hook of allHooks) {
    // Internal hooks run inside devflow — no external tool to shell out to
    if (hook.internal) {
      const results = runInternalHook(hook, plan, repoRoot, { mode: 'full' });
      for (const r of results) findings.push(r.finding);
      // One hook = one check, however many findings it produced
      if (results.some(r => r.type === 'block')) failures++;
      else if (results.some(r => r.type === 'warn')) warnings++;
      else if (results.some(r => r.type === 'skipped')) skipped++;
      continue;
    }

    // Licence scans get special handling — per-dependency findings
    if (hook.isLicenceScan) {
      const licenceResults = runLicenceScan(hook, plan, repoRoot);
      for (const r of licenceResults) {
        findings.push(r.finding);
        if (r.type === 'skipped') skipped++;
        else if (r.type === 'block') failures++;
        else if (r.type === 'warn') warnings++;
      }
      continue;
    }

    if (!isToolAvailable(hook.command)) {
      skipped++;
      printSkipped(hook);
      findings.push(createFinding(hook, null, 'skipped'));
      continue;
    }

    let result;
    if (hook.tool === 'trivy-secrets' || hook.tool === 'trivy-cve') {
      result = runTrivyOnTracked(hook, repoRoot);
    } else if (hook.scanTarget === 'staged-paths') {
      // Same substitution as pre-commit, with the tracked file list (DEC-028)
      result = runToolOnPaths(hook, repoRoot, getTrackedFiles(repoRoot));
    } else {
      result = runTool(hook, repoRoot);
    }

    if (result.exitCode !== 0) {
      if (result.notFound || result.noConfig) {
        skipped++;
        result.noConfig ? printSkippedNoConfig(hook) : printSkipped(hook);
        findings.push(createFinding(hook, result, 'skipped'));
      } else if (hook.failPolicy === 'closed') {
        const override = activeOverrideFor(hook, repoRoot);
        if (override) {
          printOverridden(hook, override);
        } else {
          failures++;
          printFailure(hook, result);
        }
        findings.push(createFinding(hook, result, 'failed')); // saveFindings flips to 'overridden' when an override is active
      } else {
        warnings++;
        printWarning(hook, result);
        findings.push(createFinding(hook, result, 'warning'));
      }
    } else {
      printPass(hook);
      findings.push(createFinding(hook, result, 'passed'));
    }
  }

  // Save findings and append to history
  const report = saveFindings(repoRoot, findings);
  appendHistory(repoRoot, { trigger: 'check', summary: report.summary, findings });

  const ran = allHooks.length - skipped;
  console.log(`\nResults: ${ran - failures - warnings} passed, ${warnings} warnings, ${failures} failed, ${skipped} skipped`);
  console.log(`Findings saved to .devflow/findings.json`);

  if (failures > 0) {
    process.exit(1);
  }
}

/**
 * Run a licence scan using the licence-scanner module.
 * Returns per-dependency findings instead of a single pass/fail.
 */
function runLicenceScan(hook, plan, repoRoot) {
  const results = [];
  const language = hook.language;

  // Find the scope path for this language from the plan stacks
  const stacks = plan.stacks.filter(s => s.language === language);
  const scopePaths = stacks.length > 0 ? stacks.map(s => s.path) : ['.'];

  // Read licence policy from config if available
  const configPath = path.join(repoRoot, '.devflow', 'config.yml');
  let policyOverride = null;
  if (fs.existsSync(configPath)) {
    try {
      const { readConfig } = require('../../config/devflow-config');
      const config = readConfig(repoRoot);
      policyOverride = config.licencePolicy || null;
    } catch { /* use defaults */ }
  }

  for (const scopePath of scopePaths) {
    const scan = scanLicences(language, repoRoot, scopePath, policyOverride);

    if (scan.summary.toolMissing) {
      console.log(`  ○ ${hook.id} — skipped (${scan.summary.tool} not installed)`);
      results.push({
        type: 'skipped',
        finding: createFinding(hook, null, 'skipped'),
      });
      continue;
    }

    if (scan.summary.error) {
      console.log(`  ⚠ ${hook.id} — error: ${scan.summary.error}`);
      results.push({
        type: 'warn',
        finding: createFinding(hook, { exitCode: 1, output: scan.summary.error }, 'warning'),
      });
      continue;
    }

    if (scan.dependencies.length === 0) {
      console.log(`  ✓ ${hook.id} — ${scan.summary.total} dependencies, all compliant`);
      results.push({
        type: 'pass',
        finding: createFinding(hook, { exitCode: 0, output: `${scan.summary.total} dependencies scanned, all compliant` }, 'passed'),
      });
      continue;
    }

    // Report problematic dependencies
    const blocked = scan.dependencies.filter(d => d.action === 'block');
    const warned = scan.dependencies.filter(d => d.action === 'warn');

    if (blocked.length > 0) {
      console.log(`  ✗ ${hook.id} — ${blocked.length} blocked licence(s)`);
      for (const dep of blocked) {
        console.log(`      BLOCK: ${dep.name}${dep.version ? '@' + dep.version : ''} — ${dep.licence}`);
      }
    }

    if (warned.length > 0) {
      console.log(`  ⚠ ${hook.id} — ${warned.length} licence warning(s)`);
      for (const dep of warned.slice(0, 10)) {
        console.log(`      WARN:  ${dep.name}${dep.version ? '@' + dep.version : ''} — ${dep.licence}`);
      }
      if (warned.length > 10) {
        console.log(`      ... and ${warned.length - 10} more`);
      }
    }

    if (blocked.length === 0 && warned.length === 0) {
      console.log(`  ✓ ${hook.id} — ${scan.summary.total} dependencies, all compliant`);
    }

    // Create a finding per blocked dependency
    for (const dep of blocked) {
      results.push({
        type: 'block',
        finding: {
          id: `licence-block-${dep.name}-${Date.now()}`,
          tool: 'licence',
          hookId: hook.id,
          severity: 'high',
          status: hook.failPolicy === 'closed' ? 'failed' : 'warning',
          failPolicy: hook.failPolicy,
          file: null,
          line: null,
          description: `Blocked licence: ${dep.name}${dep.version ? '@' + dep.version : ''} uses ${dep.licence}`,
          fixSteps: [
            `Replace ${dep.name} with an alternative that uses a permissive licence (MIT, Apache-2.0, BSD)`,
            `If this licence is acceptable for your project, add "${dep.licence}" to .devflow/config.yml licencePolicy.allow`,
            'Run: devflow override --rule licence --reason "..." for a temporary bypass',
          ],
          docsUrl: dep.url || null,
          rawOutput: null,
          override: null,
        },
      });
    }

    // Create a single summary finding for warnings
    if (warned.length > 0) {
      const warnList = warned.map(d => `${d.name}${d.version ? '@' + d.version : ''} (${d.licence})`).join(', ');
      results.push({
        type: 'warn',
        finding: {
          id: `licence-warn-${language}-${Date.now()}`,
          tool: 'licence',
          hookId: hook.id,
          severity: 'medium',
          status: 'warning',
          failPolicy: hook.failPolicy,
          file: null,
          line: null,
          description: `${warned.length} copyleft/unknown licence(s): ${warnList}`,
          fixSteps: [
            'Review these licences for compatibility with your project',
            'Copyleft licences (GPL, LGPL, AGPL) may require you to open-source your code',
            'To suppress: add the licence to .devflow/config.yml licencePolicy.allow',
          ],
          docsUrl: null,
          rawOutput: null,
          override: null,
        },
      });
    }

    // If everything passed (no blocked or warned), add a pass finding
    if (blocked.length === 0 && warned.length === 0) {
      results.push({
        type: 'pass',
        finding: createFinding(hook, { exitCode: 0, output: `${scan.summary.total} dependencies, all compliant` }, 'passed'),
      });
    }
  }

  return results;
}

/**
 * Dispatch a hook that runs inside devflow rather than as an external tool.
 * Returns the same {type, finding} shape as runLicenceScan.
 */
function runInternalHook(hook, plan, repoRoot, ctx) {
  if (hook.tool === 'suppression') {
    return runSuppressionGate(hook, plan, repoRoot, ctx);
  }
  if (hook.tool === 'lockfile') {
    return runLockfileGate(hook, repoRoot, ctx);
  }
  console.log(`  ○ ${hook.id} — skipped (no runner for internal hook)`);
  return [{ type: 'skipped', finding: createFinding(hook, null, 'skipped') }];
}

/**
 * Suppression gate (DEC-022).
 *   pre-commit: new suppressions in staged diff → fail closed (unless overridden)
 *   full:       existing suppressions → one non-blocking debt warning
 */
function runSuppressionGate(hook, plan, repoRoot, ctx) {
  const gate = require('../../modules/suppression-gate');
  const { hits, scanned, mode } = gate.run({
    repoRoot,
    config: plan._config || {},
    mode: ctx.mode,
    stagedFiles: ctx.stagedFiles || [],
    range: ctx.range,
  });
  const guidance = GUIDANCE.suppression;

  if (hits.length === 0) {
    const label = mode === 'full' ? 'no suppressions' : 'no new suppressions';
    console.log(`  ✓ ${hook.id} — ${scanned} file(s), ${label}`);
    return [{
      type: 'pass',
      finding: createFinding(hook, { exitCode: 0, output: `${scanned} file(s) scanned, ${label}` }, 'passed'),
    }];
  }

  const toFinding = (hit, status) => ({
    id: `suppression-${hit.patternId}-${hit.file}:${hit.line}`,
    tool: hook.tool,
    hookId: hook.id,
    severity: (hit.category === 'security' || hit.patternId === 'test-only') ? 'high' : 'medium',
    status,
    failPolicy: hook.failPolicy,
    file: hit.file,
    line: String(hit.line),
    description: `${hit.patternId} (${hit.category}): ${hit.description}`,
    fixSteps: guidance.fixSteps,
    docsUrl: null,
    rawOutput: hit.text,
    override: null,
  });

  if (mode === 'full') {
    // Existing suppressions are debt. Report them, never block a full check on them.
    console.log(`  ⚠ ${hook.id} — ${hits.length} existing suppression(s) in ${scanned} file(s) (debt, non-blocking)`);
    printSuppressionHits(hits);
    return [{
      type: 'warn',
      finding: {
        id: `suppression-debt-${Date.now()}`,
        tool: hook.tool,
        hookId: hook.id,
        severity: 'medium',
        status: 'warning',
        failPolicy: hook.failPolicy,
        file: null,
        line: null,
        description: `${hits.length} existing suppression comment(s) across ${scanned} tracked file(s)`,
        fixSteps: guidance.fixSteps,
        docsUrl: null,
        rawOutput: hits.slice(0, 50).map(h => `${h.file}:${h.line} ${h.patternId}`).join('\n'),
        override: null,
      },
    }];
  }

  const blocking = hook.failPolicy === 'closed';
  const override = blocking ? activeOverrideFor(hook, repoRoot) : null;

  if (blocking && !override) {
    console.log(`  ✗ ${hook.id} — FAILED (blocks commit)`);
    console.log('');
    console.log(`    ${hits.length} new suppression comment(s) in staged changes`);
    printSuppressionHits(hits);
    console.log('');
    console.log('    How to fix:');
    guidance.fixSteps.forEach((step, i) => console.log(`      ${i + 1}. ${step}`));
    console.log('');
    return hits.map(h => ({ type: 'block', finding: toFinding(h, 'failed') }));
  }

  if (override) {
    printOverridden(hook, override);
    printSuppressionHits(hits);
    return hits.map(h => ({ type: 'overridden', finding: toFinding(h, 'failed') }));
  }

  console.log(`  ⚠ ${hook.id} — ${hits.length} new suppression comment(s) (warning)`);
  printSuppressionHits(hits);
  return hits.map(h => ({ type: 'warn', finding: toFinding(h, 'warning') }));
}

/**
 * Lockfile gate (DEC-029).
 *   pre-commit: manifest dependency change with an unstaged lockfile → fail closed
 *   full:       manifests with no lockfile → one non-blocking debt warning
 */
function runLockfileGate(hook, repoRoot, ctx) {
  const gate = require('../../modules/lockfile-gate');
  const { hits, scanned, mode } = gate.run({
    repoRoot,
    mode: ctx.mode,
    stagedFiles: ctx.stagedFiles || [],
    range: ctx.range,
  });
  const guidance = GUIDANCE.lockfile;

  if (hits.length === 0) {
    const label = scanned === 0 ? 'no manifests in scope' : `${scanned} manifest(s), lockfiles current`;
    console.log(`  ✓ ${hook.id} — ${label}`);
    return [{
      type: 'pass',
      finding: createFinding(hook, { exitCode: 0, output: label }, 'passed'),
    }];
  }

  const toFinding = (hit, status) => ({
    id: `lockfile-${hit.type}-${hit.manifest}`,
    tool: hook.tool,
    hookId: hook.id,
    severity: hit.type === 'stale-lockfile' ? 'high' : 'medium',
    status,
    failPolicy: hook.failPolicy,
    file: hit.manifest,
    line: null,
    description: hit.description,
    fixSteps: [`Run: ${hit.refresh}`, ...guidance.fixSteps],
    docsUrl: null,
    rawOutput: hit.description,
    override: null,
  });

  // A project that never had a lockfile must still be able to commit —
  // that is debt to schedule, not a change to reject.
  const blockingHits = (mode === 'pre-commit' || mode === 'range')
    ? hits.filter(h => h.type === 'stale-lockfile')
    : [];
  const debtHits = hits.filter(h => !blockingHits.includes(h));

  const results = [];

  if (blockingHits.length > 0) {
    const blocking = hook.failPolicy === 'closed';
    const override = blocking ? activeOverrideFor(hook, repoRoot) : null;

    if (blocking && !override) {
      console.log(`  ✗ ${hook.id} — FAILED (blocks commit)`);
      console.log('');
      for (const h of blockingHits) {
        console.log(`    ${h.manifest} changed its dependencies — ${h.lockfile} is not staged`);
        console.log(`      Run: ${h.refresh}   then: git add ${h.lockfile}`);
      }
      console.log('');
      console.log('    How to fix:');
      guidance.fixSteps.forEach((step, i) => console.log(`      ${i + 1}. ${step}`));
      console.log('');
      results.push(...blockingHits.map(h => ({ type: 'block', finding: toFinding(h, 'failed') })));
    } else if (override) {
      printOverridden(hook, override);
      results.push(...blockingHits.map(h => ({ type: 'overridden', finding: toFinding(h, 'failed') })));
    } else {
      console.log(`  ⚠ ${hook.id} — ${blockingHits.length} stale lockfile(s) (warning)`);
      results.push(...blockingHits.map(h => ({ type: 'warn', finding: toFinding(h, 'warning') })));
    }
  }

  if (debtHits.length > 0) {
    console.log(`  ⚠ ${hook.id} — ${debtHits.length} manifest(s) with no lockfile (debt, non-blocking)`);
    for (const h of debtHits.slice(0, 10)) {
      console.log(`      ${h.manifest}  —  generate one with: ${h.refresh}`);
    }
    results.push(...debtHits.map(h => ({ type: 'warn', finding: toFinding(h, 'warning') })));
  }

  return results;
}

function printSuppressionHits(hits) {
  const shown = hits.slice(0, 15);
  for (const h of shown) {
    console.log(`      ${h.file}:${h.line}  ${h.patternId.padEnd(18)} ${h.text}`);
  }
  if (hits.length > shown.length) {
    console.log(`      ... and ${hits.length - shown.length} more`);
  }
}

/**
 * Active override for a hook — matched by hook id first, then tool name.
 */
function activeOverrideFor(hook, repoRoot) {
  return findOverride(repoRoot, hook.id) || findOverride(repoRoot, hook.tool);
}

function printOverridden(hook, override) {
  const expires = String(override.expiresAt).slice(0, 10);
  console.log(`  ⊘ ${hook.id} — overridden by ${override.developer} until ${expires}: "${override.reason}"`);
}

// Cache tool availability within a single run
const toolCache = {};

function isToolAvailable(command) {
  if (!command) return false;
  const base = command.split(/\s/)[0];
  if (toolCache[base] !== undefined) return toolCache[base];

  // First check TOOL_CHECKS registry
  const result = checkTool(base);
  if (result.installed) {
    toolCache[base] = true;
    return true;
  }

  // Fall back to checking if command exists on PATH
  try {
    const { execSync } = require('child_process');
    execSync(`command -v ${base}`, { stdio: 'pipe', timeout: 3000 });
    toolCache[base] = true;
    return true;
  } catch {
    toolCache[base] = false;
    return false;
  }
}

/**
 * Get list of staged files.
 */
function getStagedFiles(repoRoot) {
  try {
    const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    return output.toString().trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Run a tool in pre-commit mode — scoped to staged files only.
 * For filesystem scanners (trivy), creates a temp dir with staged content.
 * For linters/formatters, passes file list directly.
 */
function runToolPreCommit(hook, repoRoot, stagedFiles) {
  if (stagedFiles.length === 0) {
    return { exitCode: 0, output: 'No staged files to check' };
  }

  // For Trivy: scan a temp dir containing only staged file content
  if (hook.tool === 'trivy-secrets' || hook.tool === 'trivy-cve') {
    return runTrivyOnStaged(hook, repoRoot, stagedFiles);
  }

  // For linters/formatters: pass staged files as args
  const relevantFiles = filterFilesByScope(stagedFiles, hook.scope);
  if (relevantFiles.length === 0) {
    return { exitCode: 0, output: 'No matching staged files' };
  }

  // Scanners that take explicit paths: replace the trailing target with the
  // staged file list so the scan never blocks on pre-existing code (DEC-028).
  // Paths are quoted — a staged filename may contain spaces.
  if (hook.scanTarget === 'staged-paths') {
    return runToolOnPaths(hook, repoRoot, relevantFiles);
  }

  return runTool(hook, repoRoot);
}

/**
 * Run a tool against an explicit list of paths, replacing the hook's trailing
 * scan target. Semgrep's built-in ignore list skips test/ and similar when it
 * walks a directory but honours explicitly named files, so passing paths is
 * what makes the gate cover them (DEC-028).
 *
 * Paths are single-quoted — a filename may contain spaces.
 */
function runToolOnPaths(hook, repoRoot, files) {
  const ignore = Array.isArray(hook.ignorePaths) ? hook.ignorePaths : [];
  const kept = ignore.length === 0
    ? (files || [])
    : (files || []).filter(f => {
      const norm = f.replace(/\\/g, '/');
      return !ignore.some(p => {
        const prefix = String(p).replace(/\\/g, '/').replace(/\/$/, '');
        return norm === prefix || norm.startsWith(prefix + '/');
      });
    });

  if (kept.length === 0) {
    return { exitCode: 0, output: 'No matching files' };
  }
  const quoted = kept.map(f => `'${f.replace(/'/g, "'\\''")}'`);
  return runTool({ ...hook, args: [...hook.args.slice(0, -1), ...quoted] }, repoRoot);
}

/**
 * Git-tracked files, as used by full-scan mode (DEC-010).
 */
function getTrackedFiles(repoRoot) {
  try {
    return execSync('git ls-files', { cwd: repoRoot, stdio: 'pipe' })
      .toString().trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Run Trivy on only staged file content via temp directory.
 */
function runTrivyOnStaged(hook, repoRoot, stagedFiles) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-staged-'));

  try {
    // Copy staged content to temp dir
    for (const file of stagedFiles) {
      try {
        const content = execSync(`git show ":${file}"`, { cwd: repoRoot, stdio: 'pipe' });
        const destPath = path.join(tmpDir, file);
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.writeFileSync(destPath, content);
      } catch {
        // File might be binary or deleted — skip
      }
    }

    // Run trivy on the temp dir
    const output = execSync(`${hook.command} ${hook.args.slice(0, -1).join(' ')} ${tmpDir}`, {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 60000,
      env: trivyEnv(),
    });
    return { exitCode: 0, output: output.toString() };
  } catch (err) {
    return {
      exitCode: err.status || 1,
      output: (err.stdout || '').toString(),
      error: (err.stderr || '').toString(),
      notFound: (err.stderr || '').toString().includes('command not found'),
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/**
 * Filter files by glob scope pattern.
 */
function filterFilesByScope(files, scope) {
  if (!scope || scope === '**/*') return files;
  // Simple extension matching from scope pattern
  const extMatch = scope.match(/\*\.(\w+)$/);
  if (extMatch) {
    return files.filter(f => f.endsWith('.' + extMatch[1]));
  }
  // Path prefix matching
  const prefixMatch = scope.match(/^([^*]+)/);
  if (prefixMatch) {
    return files.filter(f => f.startsWith(prefixMatch[1]));
  }
  return files;
}

/**
 * Run Trivy on only git-tracked files (full scan mode).
 * Copies tracked files to temp dir so untracked/.gitignored files are excluded.
 */
function runTrivyOnTracked(hook, repoRoot) {
  let trackedFiles;
  try {
    trackedFiles = execSync('git ls-files', { cwd: repoRoot, stdio: 'pipe' })
      .toString().trim().split('\n').filter(Boolean);
  } catch {
    // Not a git repo or git failed — fall back to full scan
    return runTool(hook, repoRoot);
  }

  if (trackedFiles.length === 0) {
    return { exitCode: 0, output: 'No tracked files' };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'devflow-tracked-'));

  try {
    for (const file of trackedFiles) {
      try {
        const srcPath = path.join(repoRoot, file);
        if (!fs.existsSync(srcPath)) continue;
        const destPath = path.join(tmpDir, file);
        const destDir = path.dirname(destPath);
        if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(srcPath, destPath);
      } catch {
        // Skip files that can't be copied
      }
    }

    // Replace the last arg (.) with tmpDir
    const args = [...hook.args.slice(0, -1), tmpDir];
    const output = execSync(`${hook.command} ${args.join(' ')}`, {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 60000,
      env: trivyEnv(),
    });
    return { exitCode: 0, output: output.toString() };
  } catch (err) {
    return {
      exitCode: err.status || 1,
      output: (err.stdout || '').toString(),
      error: (err.stderr || '').toString(),
      notFound: (err.stderr || '').toString().includes('command not found'),
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function runTool(hook, repoRoot) {
  try {
    const output = execSync(`${hook.command} ${hook.args.join(' ')}`, {
      cwd: repoRoot,
      stdio: 'pipe',
      timeout: 60000,
    });
    return { exitCode: 0, output: output.toString() };
  } catch (err) {
    const stderr = (err.stderr || '').toString();
    const notFound = stderr.includes('command not found') ||
      stderr.includes('not recognized') ||
      err.status === 127;

    const combined = stderr + (err.stdout || '').toString();
    return {
      exitCode: err.status || 1,
      output: (err.stdout || '').toString(),
      error: stderr,
      notFound,
      noConfig: isMissingConfig({ error: stderr, output: (err.stdout || '').toString() }),
    };
  }
}

function printPass(hook) {
  console.log(`  ✓ ${hook.id}`);
}

function printSkipped(hook) {
  console.log(`  ○ ${hook.id} — skipped (${hook.command} not installed)`);
}

function printSkippedNoConfig(hook) {
  console.log(`  ○ ${hook.id} — skipped (no config file found)`);
}

/**
 * Check if a tool failure is due to missing config (not a real finding).
 */
function isMissingConfig(result) {
  const output = (result.error || '') + (result.output || '');
  return output.includes("couldn't find") ||
    output.includes('Could not find config') ||
    output.includes('no configuration') ||
    output.includes('eslint.config');
}

function printFailure(hook, result) {
  console.log(formatFailure(hook, result));
}

function printWarning(hook, result) {
  console.log(formatWarning(hook, result));
}

module.exports = check;
