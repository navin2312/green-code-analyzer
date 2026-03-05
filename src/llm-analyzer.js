'use strict';

/**
 * Phase 2 — LLM Semantic Analyzer
 *
 * Supports three backends in priority order:
 *   1. Groq API  (cloud, free tier) — set groqApiKey opt
 *   2. Anthropic API (cloud)        — set anthropicApiKey opt
 *   3. Ollama   (local)             — set llm-endpoint or use default localhost
 *
 * Falls back gracefully (returns empty findings) if none are reachable.
 */

const http  = require('http');
const https = require('https');

// ─── Default config ──────────────────────────────────────────────────────────

const DEFAULTS = {
  endpoint:        'http://localhost:11434',
  model:           'codellama',
  timeout:         60000,
  groqApiKey:      null,
  anthropicApiKey: null,
  groqModel:       'llama3-8b-8192',
  anthropicModel:  'claude-haiku-4-5-20251001',
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run LLM semantic analysis on a list of parsed files.
 *
 * @param {Array}  parsedFiles     From diff-parser (only files with language set)
 * @param {Array}  phase1Findings  Already-found findings (to avoid duplicates)
 * @param {Object} opts            { endpoint, model, timeout, groqApiKey, anthropicApiKey }
 * @returns {Promise<{ findings, model, skipped, skipReason }>}
 */
async function analyzeLLM(parsedFiles, phase1Findings = [], opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };

  const diffText = buildDiffSummary(parsedFiles);
  if (!diffText.trim()) {
    return skip('No supported diff content to analyse');
  }

  const prompt = buildPrompt(diffText, phase1Findings);

  // Priority: Groq → Anthropic → Ollama → skip
  if (cfg.groqApiKey) {
    return callGroq(cfg, prompt, parsedFiles);
  }

  if (cfg.anthropicApiKey) {
    return callAnthropic(cfg, prompt, parsedFiles);
  }

  return callOllama(cfg, prompt, parsedFiles);
}

// ─── Backend: Groq (OpenAI-compatible, free tier) ────────────────────────────

async function callGroq(cfg, prompt, parsedFiles) {
  let raw;
  try {
    raw = await groqGenerate(cfg.groqApiKey, cfg.groqModel, prompt, cfg.timeout);
  } catch (err) {
    return skip(`Groq API request failed: ${err.message}`);
  }

  const { findings, parseError } = parseResponse(raw);
  if (parseError) return skip(`Could not parse Groq response: ${parseError}`);

  return {
    findings:   normalizeFindings(findings, parsedFiles),
    model:      `groq/${cfg.groqModel}`,
    skipped:    false,
    skipReason: null,
  };
}

// ─── Backend: Anthropic (Claude) ─────────────────────────────────────────────

async function callAnthropic(cfg, prompt, parsedFiles) {
  let raw;
  try {
    raw = await anthropicGenerate(cfg.anthropicApiKey, cfg.anthropicModel, prompt, cfg.timeout);
  } catch (err) {
    return skip(`Anthropic API request failed: ${err.message}`);
  }

  const { findings, parseError } = parseResponse(raw);
  if (parseError) return skip(`Could not parse Anthropic response: ${parseError}`);

  return {
    findings:   normalizeFindings(findings, parsedFiles),
    model:      `anthropic/${cfg.anthropicModel}`,
    skipped:    false,
    skipReason: null,
  };
}

// ─── Backend: Ollama (local) ──────────────────────────────────────────────────

async function callOllama(cfg, prompt, parsedFiles) {
  const alive = await pingOllama(cfg.endpoint, cfg.timeout);
  if (!alive) {
    return skip(`Ollama not reachable at ${cfg.endpoint} — start with: ollama serve`);
  }

  let raw;
  try {
    raw = await ollamaGenerate(cfg.endpoint, cfg.model, prompt, cfg.timeout);
  } catch (err) {
    return skip(`Ollama request failed: ${err.message}`);
  }

  const { findings, parseError } = parseResponse(raw);
  if (parseError) return skip(`Could not parse LLM response: ${parseError}`);

  return {
    findings:   normalizeFindings(findings, parsedFiles),
    model:      cfg.model,
    skipped:    false,
    skipReason: null,
  };
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(diffText, phase1Findings) {
  const alreadyList = phase1Findings.length
    ? phase1Findings.map((f) => `  - ${f.patternId}: ${f.patternName} (line ${f.lineNumber} in ${f.filename})`).join('\n')
    : '  (none detected yet)';

  return `You are an expert in energy-efficient software engineering. Your job is to find code patterns that waste CPU, memory, or network energy.

Analyze the following code diff and identify energy inefficiencies.

Already detected by our deterministic analyzer (DO NOT repeat these):
${alreadyList}

Look specifically for issues that pattern-matching misses:
- Hidden O(n\u00b2) or exponential algorithmic complexity
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

// ─── Groq HTTP helper ─────────────────────────────────────────────────────────

function groqGenerate(apiKey, model, prompt, timeout) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      messages:    [{ role: 'user', content: prompt }],
      max_tokens:  1500,
      temperature: 0.1,
    });

    const options = {
      hostname: 'api.groq.com',
      port:     443,
      path:     '/openai/v1/chat/completions',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const timer = setTimeout(() => reject(new Error('Request timed out')), timeout);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || 'Groq API error'));
          resolve(parsed.choices?.[0]?.message?.content || '');
        } catch (e) {
          reject(new Error('Invalid JSON response from Groq'));
        }
      });
    });

    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.write(body);
    req.end();
  });
}

// ─── Anthropic HTTP helper ────────────────────────────────────────────────────

function anthropicGenerate(apiKey, model, prompt, timeout) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model,
      max_tokens: 1500,
      messages:   [{ role: 'user', content: prompt }],
    });

    const options = {
      hostname: 'api.anthropic.com',
      port:     443,
      path:     '/v1/messages',
      method:   'POST',
      headers:  {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(body),
      },
    };

    const timer = setTimeout(() => reject(new Error('Request timed out')), timeout);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message || 'Anthropic API error'));
          resolve(parsed.content?.[0]?.text || '');
        } catch (e) {
          reject(new Error('Invalid JSON response from Anthropic'));
        }
      });
    });

    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.write(body);
    req.end();
  });
}

// ─── Ollama HTTP helpers ──────────────────────────────────────────────────────

function pingOllama(endpoint, timeout) {
  return new Promise((resolve) => {
    const url   = new URL('/api/tags', endpoint);
    const lib   = url.protocol === 'https:' ? https : http;
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
      source:       'llm',
    }));
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function skip(reason) {
  return { findings: [], model: null, skipped: true, skipReason: reason };
}

module.exports = { analyzeLLM, DEFAULTS };
