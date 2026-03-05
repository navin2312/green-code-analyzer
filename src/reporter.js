'use strict';

/**
 * Reporter
 *
 * Generates human-readable output in three formats:
 *   1. Markdown  – for GitHub PR comments
 *   2. Terminal  – ANSI-coloured text for the CLI
 *   3. JSON      – machine-readable summary
 *
 * Also provides a shields.io badge URL for embedding in README files.
 */

// ─── Markdown (GitHub PR comment) ───────────────────────────────────────────

/**
 * Build the full GitHub PR comment markdown body.
 *
 * @param {Array}  findings   From analyzer.analyze()
 * @param {Object} estimate   From energy-estimator.estimate()
 * @param {Object} [opts]     { repoUrl, prNumber, minSeverity }
 * @returns {string}
 */
function buildMarkdownReport(findings, estimate, opts = {}) {
  const lines = [];

  // ── Header with badge ────────────────────────────────────────────────────
  const badgeUrl   = shieldsBadgeUrl(estimate.grade, estimate.color);
  const badgeMarkdown = `![Energy Grade ${estimate.grade}](${badgeUrl})`;

  lines.push(`## ${estimate.emoji} Green Code Analyzer — Energy Anti-Pattern Report`);
  lines.push('');
  lines.push(badgeMarkdown);
  lines.push('');

  // ── Summary table ────────────────────────────────────────────────────────
  lines.push('### Summary');
  lines.push('');
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| **Grade** | ${estimate.emoji} **${estimate.grade}** — ${estimate.label} |`);
  lines.push(`| **Energy Score** | ${estimate.score} points |`);
  lines.push(`| **Total Issues** | ${estimate.findings} |`);
  lines.push(`| **Critical** | ${estimate.breakdown.critical || 0} |`);
  lines.push(`| **High** | ${estimate.breakdown.high || 0} |`);
  lines.push(`| **Medium** | ${estimate.breakdown.medium || 0} |`);
  lines.push(`| **Low** | ${estimate.breakdown.low || 0} |`);
  lines.push(`| **Est. Savings** | ${estimate.savings.description} |`);
  lines.push('');

  if (estimate.findings === 0) {
    lines.push('> **No energy anti-patterns detected in this PR.** Great work! 🌱');
    lines.push('');
    lines.push(signature());
    return lines.join('\n');
  }

  // ── Savings detail ───────────────────────────────────────────────────────
  if (estimate.savings.whPerDay > 0) {
    lines.push('### 💡 Estimated Impact');
    lines.push('');
    lines.push(
      `Fixing these patterns could save approximately ` +
      `**${estimate.savings.whPerDay} Wh/day** ` +
      `(**${estimate.savings.co2GramsPerDay} g CO₂/day**) on a single server instance. ` +
      `Across many deployments this compounds significantly.`
    );
    lines.push('');
  }

  // ── Top issues ───────────────────────────────────────────────────────────
  if (estimate.topIssues.length) {
    lines.push('### 🔥 Top Issues');
    lines.push('');
    for (const issue of estimate.topIssues) {
      lines.push(`- **${issue.name}** (\`${issue.patternId}\`) — ${issue.count} occurrence(s), ` +
        `${issue.totalPoints} energy points, severity: \`${issue.severity}\``);
    }
    lines.push('');
  }

  // ── Findings grouped by file ─────────────────────────────────────────────
  lines.push('### 🔍 Detailed Findings');
  lines.push('');

  const byFile = groupBy(findings, 'filename');

  for (const [file, fileFindings] of Object.entries(byFile)) {
    lines.push(`<details>`);
    lines.push(`<summary><strong>${escapeHtml(file)}</strong> — ${fileFindings.length} issue(s)</summary>`);
    lines.push('');

    for (const f of fileFindings) {
      const severityIcon = severityEmoji(f.severity);
      lines.push(`#### ${severityIcon} \`${f.patternId}\` — ${f.patternName}`);
      lines.push('');
      lines.push(`**Line:** \`${f.lineNumber}\`  |  **Severity:** \`${f.severity}\`  |  **Energy points:** ${f.energyPoints}`);
      lines.push('');
      lines.push(`> ${f.detail || f.description}`);
      lines.push('');
      lines.push(`**Detected code:**`);
      lines.push('```');
      lines.push(f.match);
      lines.push('```');
      lines.push('');
      lines.push(`**Suggestion:** ${f.suggestion}`);
      lines.push('');
      if (f.example) {
        lines.push(`<details><summary>Show example fix</summary>`);
        lines.push('');
        lines.push('**Before:**');
        lines.push('```');
        lines.push(f.example.bad);
        lines.push('```');
        lines.push('**After:**');
        lines.push('```');
        lines.push(f.example.good);
        lines.push('```');
        lines.push('</details>');
        lines.push('');
      }
      lines.push('---');
      lines.push('');
    }

    lines.push(`</details>`);
    lines.push('');
  }

  lines.push(signature());
  return lines.join('\n');
}

// ─── Terminal (CLI) output ───────────────────────────────────────────────────

/**
 * Build a chalk-coloured terminal report.
 * chalk is loaded lazily so this module doesn't hard-require it
 * (allows the reporter to be used in environments without chalk).
 *
 * @param {Array}  findings
 * @param {Object} estimate
 * @param {Object} chalk     chalk instance
 * @returns {string}
 */
function buildTerminalReport(findings, estimate, chalk) {
  const c = chalk || { bold: (s) => s, red: (s) => s, yellow: (s) => s,
    green: (s) => s, cyan: (s) => s, gray: (s) => s, white: (s) => s,
    bgRed: (s) => s };

  const gradeColor = {
    'A+': c.green,  A: c.green,
    B:    c.yellow, C: c.yellow,
    D:    c.red,
  };
  const colorFn = gradeColor[estimate.grade] || c.white;

  const out = [];
  out.push('');
  out.push(c.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  out.push(c.bold('  Green Code Analyzer — Energy Anti-Pattern Report'));
  out.push(c.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  out.push('');
  out.push(`  Grade      : ${colorFn(c.bold(`${estimate.grade} — ${estimate.label}`))}`);
  out.push(`  Score      : ${estimate.score} energy points`);
  out.push(`  Issues     : ${estimate.findings} (critical: ${estimate.breakdown.critical || 0}, high: ${estimate.breakdown.high || 0}, medium: ${estimate.breakdown.medium || 0}, low: ${estimate.breakdown.low || 0})`);
  out.push(`  Est. impact: ${estimate.savings.description}`);
  out.push('');

  if (findings.length === 0) {
    out.push(c.green('  ✔  No energy anti-patterns detected. Great work!'));
    out.push('');
    return out.join('\n');
  }

  // Group by file
  const byFile = groupBy(findings, 'filename');
  for (const [file, fileFindings] of Object.entries(byFile)) {
    out.push(c.cyan(c.bold(`  📄 ${file}`)));
    for (const f of fileFindings) {
      const sevColor = f.severity === 'critical' ? c.red :
                       f.severity === 'high'     ? c.red :
                       f.severity === 'medium'   ? c.yellow : c.gray;
      out.push('');
      out.push(`    ${sevColor(c.bold(`[${f.severity.toUpperCase()}]`))} ${c.bold(f.patternName)} (${f.patternId})`);
      out.push(`    Line ${f.lineNumber}: ${c.gray(f.match.substring(0, 80))}`);
      out.push(`    ${c.gray('→')} ${f.detail || f.description}`);
      out.push(`    ${c.cyan('Fix:')} ${f.suggestion.split('\n')[0]}`);
    }
    out.push('');
  }

  return out.join('\n');
}

// ─── JSON ────────────────────────────────────────────────────────────────────

function buildJsonReport(findings, estimate) {
  return JSON.stringify({ estimate, findings }, null, 2);
}

// ─── Badge ───────────────────────────────────────────────────────────────────

/**
 * Return a shields.io badge URL for embedding in a README.
 * @param {string} grade  'A+' | 'A' | 'B' | 'C' | 'D'
 * @param {string} color  shields.io colour name
 * @returns {string}
 */
function shieldsBadgeUrl(grade, color) {
  const label   = encodeURIComponent('energy grade');
  const message = encodeURIComponent(grade);
  return `https://img.shields.io/badge/${label}-${message}-${color}?style=flat-square&logo=leaf`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupBy(arr, key) {
  const result = {};
  for (const item of arr) {
    const k = item[key];
    (result[k] = result[k] || []).push(item);
  }
  return result;
}

function severityEmoji(sev) {
  return { critical: '🔴', high: '🟠', medium: '🟡', low: '🔵' }[sev] || '⚪';
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function signature() {
  return (
    '\n---\n' +
    '*Generated by [Green Code Analyzer](https://github.com/your-org/green-code-analyzer) — ' +
    'helping developers write more energy-efficient software.*'
  );
}

module.exports = {
  buildMarkdownReport,
  buildTerminalReport,
  buildJsonReport,
  shieldsBadgeUrl,
};
