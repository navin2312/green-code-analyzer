'use strict';

/**
 * GitHub Action entry point.
 *
 * Multi-phase flow:
 *   1. Read inputs
 *   2. Detect PR / push context
 *   3. Fetch the diff from GitHub API
 *   4. Phase 1 — Deterministic pattern analysis (24 rules)
 *   5. Phase 2 — LLM semantic analysis via Ollama (optional)
 *   6. Phase 3 — Policy gate evaluation (soft mode)
 *   7. Post / update PR comment with full 3-phase report
 *   8. Set action outputs and optionally fail
 */

const core   = require('@actions/core');
const github = require('@actions/github');

const { parseDiff }                  = require('./src/diff-parser');
const { analyze }                    = require('./src/analyzer');
const { estimate, filterBySeverity } = require('./src/energy-estimator');
const { analyzeLLM }                 = require('./src/llm-analyzer');
const { evaluateGates, mergeFindings } = require('./src/policy-gates');
const { buildMarkdownReport }        = require('./src/reporter');

// Marker so we can find and update our own previous comment
const COMMENT_MARKER = '<!-- green-code-analyzer -->';

async function run() {
  try {
    // ── 1. Read inputs ────────────────────────────────────────────────────
    const token          = core.getInput('github-token', { required: true });
    const failOnIssues   = core.getInput('fail-on-issues')     === 'true';
    const severityThresh = core.getInput('severity-threshold') || 'low';
    const groqApiKey     = core.getInput('groq-api-key') || '';
    const llmEnabled     = core.getInput('llm-enabled') === 'true' || !!groqApiKey;
    const llmEndpoint    = core.getInput('llm-endpoint')       || 'http://localhost:11434';
    const llmModel       = core.getInput('llm-model')          || 'codellama';

    const octokit = github.getOctokit(token);
    const ctx     = github.context;

    // ── 2. Determine PR number ────────────────────────────────────────────
    let pullNumber;
    if (ctx.eventName === 'pull_request' || ctx.eventName === 'pull_request_target') {
      pullNumber = ctx.payload.pull_request.number;
    } else if (ctx.eventName === 'push') {
      // For push events, try to find an associated open PR
      const { data: prs } = await octokit.rest.pulls.list({
        owner: ctx.repo.owner,
        repo:  ctx.repo.repo,
        state: 'open',
        head:  `${ctx.repo.owner}:${ctx.ref.replace('refs/heads/', '')}`,
      });
      pullNumber = prs[0]?.number;
    }

    // ── 3. Fetch the diff ────────────────────────────────────────────────
    let diffContent = '';

    if (pullNumber) {
      core.info(`Fetching diff for PR #${pullNumber}...`);
      const { data: files } = await octokit.rest.pulls.listFiles({
        owner:       ctx.repo.owner,
        repo:        ctx.repo.repo,
        pull_number: pullNumber,
        per_page:    100,
      });
      core.info(`PR has ${files.length} changed file(s).`);
      diffContent = files.map((f) =>
        `diff --git a/${f.filename} b/${f.filename}\n` +
        `--- a/${f.filename}\n` +
        `+++ b/${f.filename}\n` +
        (f.patch || '')
      ).join('\n');
    } else if (ctx.eventName === 'push' && ctx.payload.before) {
      // Compare base..head for a push event
      core.info('Fetching diff for push event...');
      const { data: cmp } = await octokit.rest.repos.compareCommits({
        owner: ctx.repo.owner,
        repo:  ctx.repo.repo,
        base:  ctx.payload.before,
        head:  ctx.payload.after,
      });
      diffContent = (cmp.files || []).map((f) =>
        `diff --git a/${f.filename} b/${f.filename}\n` +
        `--- a/${f.filename}\n` +
        `+++ b/${f.filename}\n` +
        (f.patch || '')
      ).join('\n');
    } else {
      core.warning('No pull request or push diff found. Skipping analysis.');
      setOutputs(0, 'A+', 0);
      return;
    }

    if (!diffContent || !diffContent.trim()) {
      core.info('Empty diff — nothing to analyse.');
      setOutputs(0, 'A+', 0);
      return;
    }

    // ── 4. Phase 1 — Deterministic pattern analysis ───────────────────────
    core.info('Phase 1: Running deterministic pattern analysis...');
    const parsedFiles   = parseDiff(diffContent).filter((f) => f.language);
    core.info(`Found ${parsedFiles.length} supported file(s) in the diff.`);

    const phase1All     = analyze(parsedFiles);
    const phase1        = filterBySeverity(phase1All, severityThresh);
    const energySummary = estimate(phase1);
    core.info(`Phase 1 complete: ${phase1.length} issue(s), grade ${energySummary.grade}.`);

    // ── 5. Phase 2 — LLM semantic analysis (optional) ────────────────────
    let llmResult = { findings: [], skipped: true, skipReason: 'LLM analysis not enabled.' };
    if (llmEnabled) {
      const backend = groqApiKey ? 'Groq' : `Ollama (${llmEndpoint})`;
      core.info(`Phase 2: Running LLM analysis via ${backend}...`);
      llmResult = await analyzeLLM(parsedFiles, phase1, {
        endpoint:   llmEndpoint,
        model:      llmModel,
        groqApiKey: groqApiKey || null,
      });
      core.info(llmResult.skipped
        ? `Phase 2 skipped: ${llmResult.skipReason}`
        : `Phase 2 complete: ${llmResult.findings.length} additional finding(s).`);
    } else {
      core.info('Phase 2: Skipped (set llm-enabled: true to activate).');
    }

    // ── 6. Phase 3 — Policy gates ────────────────────────────────────────
    core.info('Phase 3: Evaluating policy gates...');
    const allFindings = mergeFindings(phase1, llmResult.findings);
    const gateResult  = evaluateGates(allFindings, energySummary, 'soft');
    core.info(`Phase 3 complete: verdict ${gateResult.verdict} — ${gateResult.summary}`);

    // ── 7. Post PR comment ───────────────────────────────────────────────
    if (pullNumber) {
      const reportBody = COMMENT_MARKER + '\n' +
        buildMarkdownReport(phase1, energySummary, {
          repoUrl:   `https://github.com/${ctx.repo.owner}/${ctx.repo.repo}`,
          prNumber:  pullNumber,
          llmResult,
          gateResult,
        });

      await upsertComment(octokit, ctx.repo.owner, ctx.repo.repo, pullNumber, reportBody);
    }

    // ── 8. Set outputs ───────────────────────────────────────────────────
    setOutputs(energySummary.score, energySummary.grade, allFindings.length);

    // ── 9. Optionally fail ───────────────────────────────────────────────
    if (failOnIssues && allFindings.length > 0) {
      core.setFailed(
        `Green Code Analyzer found ${allFindings.length} energy issue(s). ` +
        `Grade: ${energySummary.grade}, Verdict: ${gateResult.verdict}.`
      );
    }

  } catch (err) {
    core.setFailed(`Green Code Analyzer failed: ${err.message}`);
    if (process.env.ACTIONS_RUNNER_DEBUG) core.error(err.stack);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setOutputs(score, grade, count) {
  core.setOutput('energy-score',    String(score));
  core.setOutput('grade',           grade);
  core.setOutput('findings-count',  String(count));
}

/**
 * Create a new PR comment or update the existing one from a previous run.
 * Uses COMMENT_MARKER to identify our own comments.
 */
async function upsertComment(octokit, owner, repo, prNumber, body) {
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
    per_page: 100,
  });

  const existing = comments.find((c) => c.body && c.body.includes(COMMENT_MARKER));

  if (existing) {
    core.info(`Updating existing comment #${existing.id}...`);
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existing.id,
      body,
    });
  } else {
    core.info('Creating new PR comment...');
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body,
    });
  }
}

run();
