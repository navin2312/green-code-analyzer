'use strict';

/**
 * Phase 2 — LLM Semantic Analyzer (Ollama)
 *
 * Sends the PR diff to a locally-running Ollama instance for deeper
 * semantic analysis that goes beyond what regex patterns can detect.
 *
 * Ollama must be running:  ollama serve
 * Recommended models:      codellama, deepseek-coder, mistral, llama3
 *
 * Falls back gracefully (returns empty findings) if Ollama is not
 * reachable or the model returns unparseable output.
 */

const http  = require('http');
const https = require('https');

// ─── Default config ──────────────────────────────────────────────────────────

const DEFAULTS = {
  endpoint: 'http://localhost:11434',
  model:    'codellama',
  timeout:  60000,   // 60 s — LLMs can be slow on first run
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run LLM semantic analysis on a list of parsed files.
 *
 * @param {Array}  parsedFiles   From diff-parser (only files with language set)
 * @param {Array}  phase1Findings Already-found findings (to avoid duplicates)
 * @param {Object} opts          { endpoint, model, timeout }
 * @returns {Promise<{ findings, model, tokensUsed, skipped, skipReason }>}
 */
async function analyzeLLM(parsedFiles, phase1Findings = [], opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };

  // ── Build context ──────────────────────────────────────────────────────────
  const diffText   = buildDiffSummary(parsedFiles);
  const alreadyIds = [...new Set(phase1Findings.map((f) => f.patternId))].join(', ');

  if (!diffText.trim()) {
    return skip('No supported diff content to analyse');
  }

  // ── Check Ollama is reachable ──────────────────────────────────────────────
  const alive = await pingOllama(cfg.endpoint, cfg.timeout);
  if (!alive) {
    return skip(`Ollama not reachable at ${cfg.endpoint} — start with: ollama serve`);
  }

  // ── Build prompt ───────────────────────────────────────────────────────────
  const prompt = buildPrompt(diffText, alreadyIds, phase1Findings);

  // ── Call Ollama ────────────────────────────────────────────────────────────
  let raw;
  try {
    raw = await ollamaGenerate(cfg.endpoint, cfg.model, prompt, cfg.timeout);
  } catch (err) {
    return skip(`Ollama request failed: ${err.message}`);
  }

  // ── Parse response ─────────────────────────────────────────────────────────
  const { findings, parseError } = parseResponse(raw);
  if (parseError) {
    return skip(`Could not parse LLM response: ${parseError}`);
  }

  return {
    findings:   normalizeFindings(findings, parsedFiles),
    model:      cfg.model,
    skipped:    false,
    skipReason: null,
  };
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(diffText, alreadyDetectedIds, phase1Findings) {
  const alreadyList = phase1Findings.length
    ? phase1Findings.map((f) => `  - ${f.patternId}: ${f.patternName} (line ${f.lineNumber} in ${f.filename})`).join('\n')
    : '  (none detected yet)';

  return `You are an expert in energy-efficient software engineering. Your job is to find code patterns that waste CPU, memory, or network energy.

Analyze the following code diff and identify energy inefficiencies.

Already detected by our deterministic analyzer (DO NOT repeat these):
${alreadyList}

Look specifically for issues that pattern-matching misses:
- Hidden O(n²) or exponential algorithmic complexity
- Missing memoization / caching for expensive pure functions
- Redundant recomputation of the same value across iterations
- Inefficient data structure choices (e.g., list lookup when a set would be O(1))
- Blocking I/O patterns that prevent parallelism
- Memory allocation anti-patterns that increase GC pressure
- Missed opportunities to use lazy evaluation or generators

Respond ONLY with valid JSON in exactly this format (no markdown, no explanation):
{
  "findings": [
    {
      "filename": "src/example.js",
      "line": 42,
      "severity": "high",
      "name": "Missing result caching",
      "description": "One sentence: what the pattern is and why it wastes energy.",
      "suggestion": "One sentence: how to fix it.",
      "energyPoints": 15
    }
  ],
  "summary": "One sentence overall summary."
}

Rules:
- severity must be one of: low, medium, high, critical
- energyPoints must be a number between 1 and 35
- If you find no additional issues, return: { "findings": [], "summary": "No additional issues found." }
- filename must match exactly one of the files in the diff
- line must be a plausible line number for the issue

Code diff to analyze:
\`\`\`
${diffText.substring(0, 6000)}
\`\`\``;
}

// ─── Diff summary builder ─────────────────────────────────────────────────────

function buildDiffSummary(parsedFiles) {
  return parsedFiles.map((pf) => {
    const addedLines = pf.lineInfos
      .filter((li) => li.isAdded)
      .map((li) => `+${li.lineNumber.toString().padStart(4)}: ${li.content}`)
      .join('\n');
    return `### ${pf.filename} (${pf.language})\n${addedLines}`;
  }).join('\n\n');
}

// ─── Ollama HTTP helpers ──────────────────────────────────────────────────────

function pingOllama(endpoint, timeout) {
  return new Promise((resolve) => {
    const url  = new URL('/api/tags', endpoint);
    const lib  = url.protocol === 'https:' ? https : http;
    const timer = setTimeout(() => resolve(false), Math.min(timeout, 5000));

    const req = lib.get(url.toString(), (res) => {
      clearTimeout(timer);
      resolve(res.statusCode === 200);
    });
    req.on('error', () => { clearTimeout(timer); resolve(false); });
  });
}

function ollamaGenerate(endpoint, model, prompt, timeout) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model, prompt, stream: false });
    const url  = new URL('/api/generate', endpoint);
    const lib  = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      port:     url.port || (url.protocol === 'https:' ? 443 : 80),
      path:     url.pathname,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };

    const timer = setTimeout(() => reject(new Error('Request timed out')), timeout);

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.response || '');
        } catch (e) {
          reject(new Error('Invalid JSON response from Ollama'));
        }
      });
    });

    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.write(body);
    req.end();
  });
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseResponse(raw) {
  try {
    // Strip markdown code fences if the model added them
    const cleaned = raw
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();

    const obj = JSON.parse(cleaned);
    if (!Array.isArray(obj.findings)) {
      return { findings: [], parseError: 'Response missing "findings" array' };
    }
    return { findings: obj.findings, parseError: null };
  } catch (e) {
    // Try to extract a JSON object/array from the response
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        return { findings: obj.findings || [], parseError: null };
      } catch (_) { /* fall through */ }
    }
    return { findings: [], parseError: e.message };
  }
}

// ─── Normalize findings ───────────────────────────────────────────────────────

const VALID_SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);

function normalizeFindings(raw, parsedFiles) {
  const validFiles = new Set(parsedFiles.map((f) => f.filename));

  return raw
    .filter((f) => f && typeof f === 'object' && f.name && f.description)
    .map((f, i) => ({
      patternId:    `LLM${String(i + 1).padStart(3, '0')}`,
      patternName:  String(f.name || 'LLM Finding').substring(0, 80),
      severity:     VALID_SEVERITIES.has(f.severity) ? f.severity : 'medium',
      energyPoints: Math.min(35, Math.max(1, parseInt(f.energyPoints, 10) || 10)),
      description:  String(f.description || ''),
      suggestion:   String(f.suggestion  || ''),
      filename:     validFiles.has(f.filename) ? f.filename : (parsedFiles[0]?.filename || 'unknown'),
      lineNumber:   parseInt(f.line, 10) || 1,
      match:        f.code || '',
      detail:       String(f.description || ''),
      source:       'llm',   // tag so reporter can distinguish
    }));
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function skip(reason) {
  return { findings: [], model: null, skipped: true, skipReason: reason };
}

module.exports = { analyzeLLM, DEFAULTS };
