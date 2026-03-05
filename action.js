'use strict';

/**
 * GitHub Action entry point.
 *
 * This file is compiled by `npm run build` into dist/index.js using @vercel/ncc,
 * which bundles all dependencies into a single file.
 *
 * Flow:
 *   1. Read inputs (github-token, fail-on-issues, severity-threshold)
 *   2. Detect event context (pull_request or push)
 *   3. Fetch the diff from GitHub API
 *   4. Parse + analyse the diff
 *   5. Post (or update) a PR comment with the markdown report
 *   6. Set action outputs (energy-score, grade, findings-count)
 *   7. Optionally fail the action if issues were found
 */

const core   = require('@actions/core');
const github = require('@actions/github');

const { parseDiff }                  = require('./src/diff-parser');
const { analyze }                    = require('./src/analyzer');
const { estimate, filterBySeverity } = require('./src/energy-estimator');
const { buildMarkdownReport }        = require('./src/reporter');

// Marker so we can find and update our own previous comment
const COMMENT_MARKER = '<!-- green-code-analyzer -->';

async function run() {
  try {
    // ── 1. Read inputs ────────────────────────────────────────────────────
    const token          = core.getInput('github-token', { required: true });
    const failOnIssues   = core.getInput('fail-on-issues')      === 'true';
    const severityThresh = core.getInput('severity-threshold')  || 'low';

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
      const { data } = await octokit.rest.pulls.get({
        owner:      ctx.repo.owner,
        repo:       ctx.repo.repo,
        pull_number: pullNumber,
        mediaType:  { format: 'diff' },
      });
      diffContent = data;
    } else if (ctx.eventName === 'push' && ctx.payload.before) {
      // Compare base..head for a push event
      core.info('Fetching diff for push event...');
      const { data } = await octokit.rest.repos.compareCommits({
        owner: ctx.repo.owner,
        repo:  ctx.repo.repo,
        base:  ctx.payload.before,
        head:  ctx.payload.after,
        mediaType: { format: 'diff' },
      });
      diffContent = data;
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

    // ── 4. Parse + analyse ───────────────────────────────────────────────
    core.info('Parsing diff...');
    const parsedFiles = parseDiff(diffContent).filter((f) => f.language);

    core.info(`Found ${parsedFiles.length} supported file(s) in the diff.`);

    const allFindings   = analyze(parsedFiles);
    const filtered      = filterBySeverity(allFindings, severityThresh);
    const energySummary = estimate(filtered);

    core.info(`Analysis complete: ${filtered.length} issue(s) found, grade ${energySummary.grade}.`);

    // ── 5. Post PR comment ───────────────────────────────────────────────
    if (pullNumber) {
      const reportBody = COMMENT_MARKER + '\n' +
        buildMarkdownReport(filtered, energySummary, {
          repoUrl:   `https://github.com/${ctx.repo.owner}/${ctx.repo.repo}`,
          prNumber:  pullNumber,
        });

      await upsertComment(octokit, ctx.repo.owner, ctx.repo.repo, pullNumber, reportBody);
    }

    // ── 6. Set outputs ───────────────────────────────────────────────────
    setOutputs(energySummary.score, energySummary.grade, filtered.length);

    // ── 7. Optionally fail ───────────────────────────────────────────────
    if (failOnIssues && filtered.length > 0) {
      core.setFailed(
        `Green Code Analyzer found ${filtered.length} energy anti-pattern(s). ` +
        `Grade: ${energySummary.grade}. See PR comment for details.`
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
