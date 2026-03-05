#!/usr/bin/env node
'use strict';

/**
 * green-code CLI
 *
 * Usage
 * ─────
 *   green-code check <file> [<file2> ...]       Analyse source files directly
 *   green-code check --diff <diff-file>         Analyse a git unified diff file
 *   green-code check --stdin                    Read diff from stdin
 *   green-code check --git-diff                 Run `git diff HEAD` and analyse
 *   green-code check --git-diff --staged        Run `git diff --cached` and analyse
 *
 * Options
 *   --format text|json|markdown   Output format (default: text)
 *   --severity low|medium|high|critical  Minimum severity to report (default: low)
 *   --fail-on-issues              Exit code 1 if any issues found
 *   --no-color                    Disable ANSI colours
 */

const fs      = require('fs');
const path    = require('path');
const { execSync } = require('child_process');
const { program } = require('commander');

const { parseDiff, parseFile }     = require('./src/diff-parser');
const { analyze }                  = require('./src/analyzer');
const { estimate, filterBySeverity } = require('./src/energy-estimator');
const { analyzeLLM }               = require('./src/llm-analyzer');
const { evaluateGates, mergeFindings } = require('./src/policy-gates');
const { buildMarkdownReport, buildTerminalReport, buildJsonReport } = require('./src/reporter');

// ─── Version ────────────────────────────────────────────────────────────────

const { version } = require('./package.json');

// ─── CLI Definition ─────────────────────────────────────────────────────────

program
  .name('green-code')
  .description('Detect energy anti-patterns in JavaScript and Python code')
  .version(version);

program
  .command('check [files...]', { isDefault: true })
  .description('Check source files or a diff for energy anti-patterns')
  .option('--diff <file>',         'Path to a unified diff file to analyse')
  .option('--stdin',               'Read unified diff from stdin')
  .option('--git-diff',            'Run git diff HEAD and analyse the output')
  .option('--staged',              'Combined with --git-diff: analyse staged changes')
  .option('--format <format>',     'Output format: text | json | markdown', 'text')
  .option('--severity <level>',    'Minimum severity: low | medium | high | critical', 'low')
  .option('--fail-on-issues',      'Exit with code 1 if any issues are found', false)
  .option('--no-color',            'Disable coloured terminal output')
  .option('--llm',                     'Enable Phase 2 LLM semantic analysis', false)
  .option('--llm-endpoint <url>',      'Ollama endpoint URL (local fallback)', 'http://localhost:11434')
  .option('--llm-model <model>',       'Ollama model to use (local fallback)', 'codellama')
  .option('--groq-api-key <key>',      'Groq API key for cloud LLM (or set GROQ_API_KEY env var)')
  .action(async (files, opts) => {
    try {
      const parsedFiles = await collectInputs(files, opts);

      if (parsedFiles.length === 0) {
        console.error('No supported files found. Supported extensions: .js, .jsx, .ts, .tsx, .mjs, .cjs, .py');
        process.exit(1);
      }

      // Phase 1 — deterministic patterns
      const phase1All     = analyze(parsedFiles);
      const phase1        = filterBySeverity(phase1All, opts.severity);
      const energySummary = estimate(phase1);

      // Phase 2 — LLM semantic analysis (optional)
      const groqKey   = opts.groqApiKey || process.env.GROQ_API_KEY || '';
      const llmActive = opts.llm || !!groqKey;

      let llmResult = { findings: [], skipped: true, skipReason: 'LLM not enabled. Use --llm or --groq-api-key (or set GROQ_API_KEY env var).' };
      if (llmActive) {
        const backend = groqKey ? 'Groq' : opts.llmModel;
        console.error(`  Running LLM analysis via ${backend}...`);
        llmResult = await analyzeLLM(parsedFiles, phase1, {
          endpoint:   opts.llmEndpoint,
          model:      opts.llmModel,
          groqApiKey: groqKey || null,
        });
        if (llmResult.skipped) {
          console.error(`  ⚠  LLM skipped: ${llmResult.skipReason}`);
        }
      }

      // Phase 3 — policy gates
      const allFindings = mergeFindings(phase1, llmResult.findings);
      const gateResult  = evaluateGates(allFindings, energySummary, 'soft');

      output(phase1, energySummary, opts, { llmResult, gateResult });

      if (opts.failOnIssues && allFindings.length > 0) {
        process.exit(1);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
      process.exit(2);
    }
  });

program
  .command('list-patterns [language]')
  .description('List all known energy anti-patterns (language: js | py)')
  .action((language) => {
    const { JS_PATTERNS } = require('./src/patterns/js-patterns');
    const { PY_PATTERNS } = require('./src/patterns/py-patterns');

    const patterns = [];
    if (!language || language === 'js' || language === 'javascript') {
      patterns.push(...JS_PATTERNS.map((p) => ({ ...p, language: 'JavaScript' })));
    }
    if (!language || language === 'py' || language === 'python') {
      patterns.push(...PY_PATTERNS.map((p) => ({ ...p, language: 'Python' })));
    }

    console.log('\n  Green Code Analyzer — Known Energy Anti-Patterns\n');
    console.log(`  ${'ID'.padEnd(8)} ${'Lang'.padEnd(12)} ${'Severity'.padEnd(10)} ${'Points'.padEnd(8)} Name`);
    console.log(`  ${'─'.repeat(70)}`);
    for (const p of patterns) {
      console.log(
        `  ${p.id.padEnd(8)} ${p.language.padEnd(12)} ${p.severity.padEnd(10)} ${String(p.energyPoints).padEnd(8)} ${p.name}`
      );
    }
    console.log('');
  });

program.parse();

// ─── Input collection ────────────────────────────────────────────────────────

async function collectInputs(files, opts) {
  // 1. Read from stdin (piped diff)
  if (opts.stdin) {
    const diffContent = fs.readFileSync('/dev/stdin', 'utf8');
    return parseDiff(diffContent).filter((f) => f.language);
  }

  // 2. Run git diff
  if (opts.gitDiff) {
    const gitCmd = opts.staged ? 'git diff --cached' : 'git diff HEAD';
    let diffContent;
    try {
      diffContent = execSync(gitCmd, { encoding: 'utf8' });
    } catch (e) {
      throw new Error(`Failed to run '${gitCmd}': ${e.message}`);
    }
    if (!diffContent.trim()) {
      console.log('No changes detected in git diff.');
      return [];
    }
    return parseDiff(diffContent).filter((f) => f.language);
  }

  // 3. Read a diff file
  if (opts.diff) {
    if (!fs.existsSync(opts.diff)) {
      throw new Error(`Diff file not found: ${opts.diff}`);
    }
    const diffContent = fs.readFileSync(opts.diff, 'utf8');
    return parseDiff(diffContent).filter((f) => f.language);
  }

  // 4. Analyse source files directly
  if (files && files.length > 0) {
    const parsed = [];
    for (const filePath of files) {
      if (!fs.existsSync(filePath)) {
        console.warn(`  Warning: file not found — ${filePath}`);
        continue;
      }
      const content = fs.readFileSync(filePath, 'utf8');
      const pf = parseFile(path.resolve(filePath), content);
      if (pf.language) parsed.push(pf);
    }
    return parsed;
  }

  // 5. Default: try git diff HEAD in current directory
  try {
    const diffContent = execSync('git diff HEAD', { encoding: 'utf8' });
    if (diffContent.trim()) {
      return parseDiff(diffContent).filter((f) => f.language);
    }
  } catch (_) { /* not a git repo */ }

  return [];
}

// ─── Output ──────────────────────────────────────────────────────────────────

function output(findings, energySummary, opts, phaseOpts = {}) {
  switch (opts.format) {
    case 'json':
      console.log(buildJsonReport(findings, energySummary));
      break;

    case 'markdown':
      console.log(buildMarkdownReport(findings, energySummary, phaseOpts));
      break;

    case 'text':
    default: {
      let chalk;
      if (opts.color !== false) {
        try { chalk = require('chalk'); } catch (_) { /* chalk not installed */ }
      }
      console.log(buildTerminalReport(findings, energySummary, chalk, phaseOpts));
      break;
    }
  }
}
