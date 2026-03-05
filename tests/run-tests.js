'use strict';

/**
 * Lightweight test runner (no external deps).
 * Run with: node tests/run-tests.js
 */

const fs   = require('fs');
const path = require('path');

const { parseDiff, parseFile }    = require('../src/diff-parser');
const { analyze }                 = require('../src/analyzer');
const { estimate, filterBySeverity } = require('../src/energy-estimator');
const { buildMarkdownReport, buildTerminalReport, buildJsonReport } = require('../src/reporter');
const { evaluateGates, mergeFindings } = require('../src/policy-gates');
const { analyzeLLM }              = require('../src/llm-analyzer');

let passed = 0;
let failed = 0;

// Wrap in async main so we can await LLM tests without top-level await (CJS)
async function main() {

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅  ${message}`);
    passed++;
  } else {
    console.error(`  ❌  ${message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual === expected) {
    console.log(`  ✅  ${message}`);
    passed++;
  } else {
    console.error(`  ❌  ${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n── ${name} ──────────────────────────────────────`);
}

// ─── Test: diff-parser ───────────────────────────────────────────────────────
section('diff-parser');

const diffContent = fs.readFileSync(path.join(__dirname, 'fixtures/sample.diff'), 'utf8');
const parsedFiles = parseDiff(diffContent);

assert(parsedFiles.length === 3, `Parsed 3 files from sample.diff (got ${parsedFiles.length})`);
const jsFiles  = parsedFiles.filter((f) => f.language === 'javascript');
const pyFiles  = parsedFiles.filter((f) => f.language === 'python');
assert(jsFiles.length === 2,  `2 JavaScript files detected`);
assert(pyFiles.length === 1,  `1 Python file detected`);

const poller = parsedFiles.find((f) => f.filename.includes('poller.js'));
assert(poller !== undefined, 'Found poller.js');
const addedLines = poller.lineInfos.filter((li) => li.isAdded);
assert(addedLines.length > 0, `poller.js has added lines (found ${addedLines.length})`);

// ─── Test: parseFile ─────────────────────────────────────────────────────────
section('parseFile (full-file mode)');

const badJsContent = fs.readFileSync(path.join(__dirname, 'fixtures/bad-js.js'), 'utf8');
const badJsParsed  = parseFile(path.join(__dirname, 'fixtures/bad-js.js'), badJsContent);
assert(badJsParsed.language === 'javascript', 'bad-js.js detected as JavaScript');
assert(badJsParsed.lineInfos.every((li) => li.isAdded), 'All lines marked as added in full-file mode');

const badPyContent = fs.readFileSync(path.join(__dirname, 'fixtures/bad-py.py'), 'utf8');
const badPyParsed  = parseFile(path.join(__dirname, 'fixtures/bad-py.py'), badPyContent);
assert(badPyParsed.language === 'python', 'bad-py.py detected as Python');

// ─── Test: analyzer on bad-js.js ────────────────────────────────────────────
section('analyzer — bad-js.js (expect many findings)');

const jsFindings = analyze([badJsParsed]);
assert(jsFindings.length > 0, `Found ${jsFindings.length} issues in bad-js.js`);

const js001 = jsFindings.find((f) => f.patternId === 'JS001');
assert(js001 !== undefined, 'JS001 (frequent polling) detected');

const js002 = jsFindings.find((f) => f.patternId === 'JS002');
assert(js002 !== undefined, 'JS002 (fetch in loop) detected');

const js003 = jsFindings.find((f) => f.patternId === 'JS003');
assert(js003 !== undefined, 'JS003 (no debounce) detected');

const js004 = jsFindings.find((f) => f.patternId === 'JS004');
assert(js004 !== undefined, 'JS004 (DOM query in loop) detected');

const js005 = jsFindings.find((f) => f.patternId === 'JS005');
assert(js005 !== undefined, 'JS005 (sync XHR) detected');

const js007 = jsFindings.find((f) => f.patternId === 'JS007');
assert(js007 !== undefined, 'JS007 (eval) detected');

const js008 = jsFindings.find((f) => f.patternId === 'JS008');
assert(js008 !== undefined, 'JS008 (JSON in loop) detected');

const js009 = jsFindings.find((f) => f.patternId === 'JS009');
assert(js009 !== undefined, 'JS009 (console.log in loop) detected');

const js010 = jsFindings.find((f) => f.patternId === 'JS010');
assert(js010 !== undefined, 'JS010 (document.write) detected');

// ─── Test: analyzer on bad-py.py ────────────────────────────────────────────
section('analyzer — bad-py.py (expect many findings)');

const pyFindings = analyze([badPyParsed]);
assert(pyFindings.length > 0, `Found ${pyFindings.length} issues in bad-py.py`);

const py001 = pyFindings.find((f) => f.patternId === 'PY001');
assert(py001 !== undefined, 'PY001 (string concat in loop) detected');

const py002 = pyFindings.find((f) => f.patternId === 'PY002');
assert(py002 !== undefined, 'PY002 (iterrows) detected');

const py003 = pyFindings.find((f) => f.patternId === 'PY003');
assert(py003 !== undefined, 'PY003 (range(len())) detected');

const py004 = pyFindings.find((f) => f.patternId === 'PY004');
assert(py004 !== undefined, 'PY004 (busy-wait) detected');

const py005 = pyFindings.find((f) => f.patternId === 'PY005');
assert(py005 !== undefined, 'PY005 (readlines) detected');

const py006 = pyFindings.find((f) => f.patternId === 'PY006');
assert(py006 !== undefined, 'PY006 (recursive without lru_cache) detected');

const py007 = pyFindings.find((f) => f.patternId === 'PY007');
assert(py007 !== undefined, 'PY007 (list.append in loop) detected');

const py010 = pyFindings.find((f) => f.patternId === 'PY010');
assert(py010 !== undefined, 'PY010 (nested loops) detected');

// ─── Test: analyzer on good-js.js (expect zero or few findings) ─────────────
section('analyzer — good-js.js (expect 0 findings)');

const goodJsContent = fs.readFileSync(path.join(__dirname, 'fixtures/good-js.js'), 'utf8');
const goodJsParsed  = parseFile(path.join(__dirname, 'fixtures/good-js.js'), goodJsContent);
const goodJsFindings = analyze([goodJsParsed]);
assert(goodJsFindings.length === 0,
  `good-js.js produced ${goodJsFindings.length} findings (expected 0)`);

// ─── Test: energy-estimator ──────────────────────────────────────────────────
section('energy-estimator');

const allFindings = [...jsFindings, ...pyFindings];
const summary     = estimate(allFindings);

assert(summary.score > 0,   `Score > 0 for files with issues (${summary.score})`);
assert(['A+','A','B','C','D'].includes(summary.grade), `Valid grade: ${summary.grade}`);
assert(summary.findings === allFindings.length, 'findings count matches');
assert(summary.savings !== undefined, 'savings object present');
assert(summary.breakdown !== undefined, 'breakdown object present');

const noFindingsSummary = estimate([]);
assertEqual(noFindingsSummary.grade, 'A+', 'Empty findings → A+ grade');
assertEqual(noFindingsSummary.score, 0,   'Empty findings → score 0');

// ─── Test: severity filter ───────────────────────────────────────────────────
section('filterBySeverity');

const highOnly = filterBySeverity(allFindings, 'high');
assert(highOnly.every((f) => ['high','critical'].includes(f.severity)),
  'filterBySeverity("high") returns only high and critical findings');

// ─── Test: reporter ──────────────────────────────────────────────────────────
section('reporter');

const markdown = buildMarkdownReport(allFindings, summary);
assert(typeof markdown === 'string' && markdown.length > 100, 'buildMarkdownReport returns non-empty string');
assert(markdown.includes('## '),             'Markdown has a heading');
assert(markdown.includes('shields.io'),      'Markdown contains badge URL');
assert(markdown.includes('Grade'),           'Markdown contains Grade');

const json = buildJsonReport(allFindings, summary);
const parsed = JSON.parse(json);
assert(parsed.findings !== undefined,  'JSON report has findings array');
assert(parsed.estimate !== undefined,  'JSON report has estimate object');

const terminal = buildTerminalReport(allFindings, summary, null);
assert(typeof terminal === 'string' && terminal.length > 50, 'buildTerminalReport returns non-empty string');

// ─── Test: diff-based analysis ───────────────────────────────────────────────
section('analyzer — sample.diff end-to-end');

const diffFindings = analyze(parsedFiles);
assert(diffFindings.length > 0, `Found ${diffFindings.length} issues in sample.diff`);
const diffSummary  = estimate(diffFindings);
assert(diffSummary.grade !== 'A+', `Grade is not A+ for sample.diff (got ${diffSummary.grade})`);

// ─── Test: policy gates ───────────────────────────────────────────────────────
section('policy-gates');

const gateResult = evaluateGates(allFindings, summary, 'soft');
assert(gateResult.results.length > 0,           'evaluateGates returns gate results');
assert(['PASS','WARN'].includes(gateResult.verdict), `Verdict is PASS or WARN (got ${gateResult.verdict})`);
assert(typeof gateResult.summary === 'string',   'Gate summary is a string');
assert(gateResult.mode === 'soft',               'Mode is soft');

// Soft mode: verdict must never be BLOCK
assert(gateResult.verdict !== 'BLOCK',           'Soft mode never produces BLOCK verdict');

// With critical findings, GATE001 should warn
const criticalFindings = allFindings.filter(f => f.severity === 'critical');
if (criticalFindings.length > 0) {
  const gate001 = gateResult.results.find(r => r.id === 'GATE001');
  assert(gate001?.status === 'warn', 'GATE001 warns when critical patterns present');
}

// Clean findings → all gates pass
const cleanGates = evaluateGates([], estimate([]), 'soft');
assert(cleanGates.verdict === 'PASS', 'Clean findings → PASS verdict');
assert(cleanGates.results.every(r => r.status === 'pass'), 'Clean findings → all gates pass');

// mergeFindings combines sources correctly
const fakePatternFinding = { ...allFindings[0], source: 'pattern' };
const fakeLlmFinding     = { ...allFindings[0], patternId: 'LLM001', source: 'llm' };
const merged = mergeFindings([fakePatternFinding], [fakeLlmFinding]);
assert(merged.length === 2,                      'mergeFindings returns both findings');
assert(merged.some(f => f.source === 'llm'),     'mergeFindings preserves LLM source tag');
assert(merged.some(f => f.source === 'pattern'), 'mergeFindings preserves pattern source tag');

// ─── Test: LLM analyzer (offline / skipped) ──────────────────────────────────
section('llm-analyzer (offline fallback)');

// Without Ollama running the analyzer should gracefully skip
const llmResult = await analyzeLLM(parsedFiles.slice(0, 1), [], {
  endpoint: 'http://localhost:19999', // port nothing is running on
  model:    'codellama',
  timeout:  3000,
});
assert(llmResult.skipped === true,               'LLM analyzer skips gracefully when Ollama unreachable');
assert(Array.isArray(llmResult.findings),        'LLM result always has findings array');
assert(llmResult.findings.length === 0,          'Skipped LLM result has 0 findings');
assert(typeof llmResult.skipReason === 'string', 'LLM result includes skipReason');

// ─── Test: reporter shows 3-phase sections ────────────────────────────────────
section('reporter — 3-phase output');

const multiPhaseMarkdown = buildMarkdownReport(allFindings, summary, {
  llmResult: { skipped: true, skipReason: 'Test mode', findings: [] },
  gateResult,
});
assert(multiPhaseMarkdown.includes('Phase 2'),   'Markdown includes Phase 2 section');
assert(multiPhaseMarkdown.includes('Phase 3'),   'Markdown includes Phase 3 section');
assert(multiPhaseMarkdown.includes('Policy Gates'), 'Markdown includes Policy Gates table');
assert(multiPhaseMarkdown.includes('Verdict'),   'Markdown includes Verdict');

const multiPhaseTerminal = buildTerminalReport(allFindings, summary, null, {
  llmResult: { skipped: true, skipReason: 'Test mode', findings: [] },
  gateResult,
});
assert(multiPhaseTerminal.includes('Phase 1'),   'Terminal includes Phase 1 section');
assert(multiPhaseTerminal.includes('Phase 2'),   'Terminal includes Phase 2 section');
assert(multiPhaseTerminal.includes('Phase 3'),   'Terminal includes Phase 3 section');

// ─── Results ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(50)}\n`);

if (failed > 0) process.exit(1);

} // end main()

main().catch((err) => { console.error(err); process.exit(2); });
