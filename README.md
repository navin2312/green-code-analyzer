# Green Code Analyzer

> A GitHub Action and CLI tool that detects energy anti-patterns in JavaScript and Python pull requests, estimates their environmental impact, and posts a detailed multi-phase report directly into the PR workflow.

![Energy Grade A+](https://img.shields.io/badge/energy%20grade-A%2B-brightgreen?style=flat-square&logo=leaf)
[![CI](https://github.com/navin2312/green-code-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/navin2312/green-code-analyzer/actions)

---

## Why This Exists

Software runs on physical hardware that consumes electricity 24/7. Poor coding patterns — frequent polling, N+1 network requests, inefficient data processing, nested loops — silently waste CPU cycles, keep the network radio active, and prevent the processor from entering low-power idle states. At scale across millions of deployments, these inefficiencies translate into measurable CO₂ emissions and electricity costs.

Green Code Analyzer makes these invisible costs visible, right inside the PR review workflow.

---

## How It Works — 3-Phase Pipeline

### Phase 1 — Deterministic Pattern Analysis
Scans only the **added lines** in the PR diff using 24 hand-crafted energy rules across JavaScript and Python. Each rule has a severity level and energy points score.

### Phase 2 — LLM Semantic Analysis (optional)
Sends the diff to an AI model to catch inefficiencies that pattern matching misses — hidden O(n²) algorithms, missing memoization, inefficient data structure choices. Supports:
- **Groq API** (cloud, free tier) — set `groq-api-key` secret
- **Ollama** (local) — run `ollama serve` with any model

### Phase 3 — Policy Gates
Evaluates combined findings against 6 gate conditions and produces a verdict (PASS / WARN). Runs in soft mode by default — warns only, never blocks merges.

---

## Features

- **24 energy anti-patterns** detected across JavaScript and Python
- **Unified diff analysis** — only reports issues on *added* lines in the PR
- **3-phase pipeline** — pattern rules + LLM semantics + policy gates
- **Energy scoring & grading** — A+ through D based on severity-weighted findings
- **CO₂ & Wh savings estimate** — tangible environmental impact numbers
- **GitHub PR comment** — rich markdown report with collapsible per-file details, auto-updated on re-runs
- **Groq API support** — free cloud LLM analysis via `llama-3.1-8b-instant`
- **Ollama support** — local LLM analysis with any model
- **CLI tool** — run locally against any file or folder
- **JSON, Markdown, and terminal output** formats
- **67 passing unit tests**

---

## Detected Patterns

### JavaScript (15 rules)

| ID | Name | Severity |
|----|------|----------|
| JS001 | Frequent Polling (`setInterval < 1s`) | High |
| JS002 | Network Request Inside Loop (N+1) | Critical |
| JS003 | Missing Debounce on High-Frequency DOM Events | High |
| JS004 | DOM Query Inside Loop | High |
| JS005 | Synchronous XMLHttpRequest | High |
| JS006 | Triple-Chained Array Iterations | Medium |
| JS007 | `eval()` Disables JIT Optimisation | Medium |
| JS008 | JSON Serialisation Inside Loop | Medium |
| JS009 | `console.log` Inside Loop | Low |
| JS010 | `document.write()` Causes Full Re-render | Medium |
| JS011 | Inefficient `setTimeout` Recursion (Tight Loop) | High |
| JS012 | Unremoved Event Listener (Memory/Energy Leak) | Medium |
| JS013 | Missing `async`/`await` (Blocking Promise Chain) | Medium |
| JS014 | Large Object Spread Inside Loop | Medium |
| JS015 | Wildcard Import (`import * from`) | Low |

### Python (9 rules)

| ID | Name | Severity |
|----|------|----------|
| PY001 | String Concatenation in Loop (O(n²)) | High |
| PY002 | `pandas DataFrame.iterrows()` — Extremely Slow | High |
| PY003 | `range(len(x))` Instead of `enumerate()` | Low |
| PY004 | Busy-Wait Spin Loop (`while True` without sleep) | Critical |
| PY005 | Loading Entire File with `.read()` / `.readlines()` | Medium |
| PY006 | Recursive Function Without `@lru_cache` | Medium |
| PY007 | `list.append()` in Loop vs List Comprehension | Low |
| PY008 | Empty Collection Initialised Inside Loop | Medium |
| PY009 | `pandas itertuples()` in Hot Path | Medium |
| PY010 | Nested Loops (Potential O(n²) Complexity) | Medium |

---

## GitHub Action Usage

### Quick Start

Add this to `.github/workflows/energy-check.yml` in your repository:

```yaml
name: Energy Anti-Pattern Check

on:
  pull_request:
    types: [opened, synchronize, reopened]

permissions:
  contents: read
  pull-requests: write

jobs:
  green-code:
    name: Green Code Analyzer
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Analyze energy anti-patterns
        uses: navin2312/green-code-analyzer@main
        id: green
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          fail-on-issues: 'false'
          severity-threshold: 'low'
          groq-api-key: ${{ secrets.GROQ_API_KEY }}

      - name: Print result
        run: |
          echo "Grade  : ${{ steps.green.outputs.grade }}"
          echo "Score  : ${{ steps.green.outputs.energy-score }}"
          echo "Issues : ${{ steps.green.outputs.findings-count }}"
```

### Enable Phase 2 LLM Analysis

**Option A — Groq (free cloud, recommended):**
1. Get a free API key at [console.groq.com](https://console.groq.com)
2. Add it as a GitHub Secret: `Settings → Secrets → New secret → GROQ_API_KEY`
3. Add to your workflow: `groq-api-key: ${{ secrets.GROQ_API_KEY }}`

**Option B — Ollama (local model):**
```yaml
with:
  llm-enabled: 'true'
  llm-endpoint: 'http://localhost:11434'
  llm-model: 'codellama'
```

### Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `github-token` | `${{ github.token }}` | Token for fetching diffs and posting comments |
| `fail-on-issues` | `false` | Exit code 1 if any issues found above threshold |
| `severity-threshold` | `low` | Minimum severity: `low`, `medium`, `high`, `critical` |
| `groq-api-key` | `''` | Groq API key — auto-enables Phase 2 LLM |
| `llm-enabled` | `false` | Set `true` to use local Ollama for Phase 2 |
| `llm-endpoint` | `http://localhost:11434` | Ollama server URL |
| `llm-model` | `codellama` | Ollama model name |

### Outputs

| Output | Example | Description |
|--------|---------|-------------|
| `energy-score` | `124` | Total energy debt score |
| `grade` | `D` | Letter grade: `A+`, `A`, `B`, `C`, or `D` |
| `findings-count` | `6` | Number of detected issues above threshold |

---

## Grading Scale

| Score | Grade | Label |
|-------|-------|-------|
| 0 | A+ | Excellent — no issues |
| 1–20 | A | Good — minor concerns |
| 21–50 | B | Fair — some improvements recommended |
| 51–80 | C | Needs Work — significant energy issues |
| 80+ | D | Critical — major energy anti-patterns present |

---

## CLI Usage

### Run locally

```bash
# Analyze a single file
node cli.js src/myfile.js

# Analyze multiple files
node cli.js api.js analytics.py

# Analyze an entire folder
node cli.js src/

# Only show high and critical issues
node cli.js --severity high src/

# Output as JSON
node cli.js --format json src/

# Enable Phase 2 via Groq
node cli.js --groq-api-key YOUR_KEY src/

# Enable Phase 2 via local Ollama
node cli.js --llm-enabled --llm-model codellama src/

# Fail with exit code 1 if issues found (useful in CI)
node cli.js --fail-on-issues src/

# Show help
node cli.js --help
```

### Sample terminal output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Green Code Analyzer — Energy Anti-Pattern Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Grade      : D — Critical
  Score      : 124 energy points
  Issues     : 6 (critical: 1, high: 3, medium: 2, low: 0)
  Est. impact: ~792 Wh/day (~306 g CO₂) could be saved — significant!

  📄 api.js

    [CRITICAL] Network Request Inside Loop (N+1) (JS002)
    Line 7: const res = await fetch(`/api/users/${id}`);
    → HTTP request inside loop — N separate round-trips instead of 1 batched call
    Fix: Batch all requests into a single network call using Promise.all()
```

---

## Development

### Setup

```bash
git clone https://github.com/navin2312/green-code-analyzer
cd green-code-analyzer
npm install
```

### Run tests

```bash
npm test
```

### Build the action bundle

The GitHub Action runs from a single bundled `dist/index.js` (built with `@vercel/ncc`):

```bash
npm run build
git add dist/
git commit -m "chore: rebuild dist bundle"
```

> **Important:** Always rebuild and commit `dist/` after changing any source file.

### Project structure

```
green-code-analyzer/
├── src/
│   ├── diff-parser.js       Unified diff parser
│   ├── analyzer.js          24-rule pattern engine
│   ├── energy-estimator.js  Scoring, grading, CO₂ estimation
│   ├── llm-analyzer.js      Phase 2 — Groq & Ollama backends
│   ├── policy-gates.js      Phase 3 — gate condition evaluation
│   └── reporter.js          Markdown / terminal / JSON output
├── tests/                   67 Jest unit tests
├── dist/
│   └── index.js             Bundled single file for GitHub Actions
├── action.js                Action entry point (3-phase orchestrator)
├── action.yml               GitHub Action definition
├── cli.js                   CLI entry point
└── package.json
```

### Adding a new pattern

1. Open `src/analyzer.js`
2. Add a new rule object to the `JS_RULES` or `PY_RULES` array:
```js
{
  id:           'JS016',
  name:         'Your pattern name',
  pattern:      /your-regex/,
  severity:     'high',
  energyPoints: 20,
  description:  'Why this wastes energy.',
  suggestion:   'How to fix it.',
}
```
3. Add a test in `tests/`
4. Run `npm test` to verify
5. Run `npm run build` to rebuild the bundle

---

## Contributing

Pull requests are welcome! Please:

- Keep pattern functions fast (no I/O, no heavy computation)
- Avoid false positives — use conservative regex patterns
- Add a test for every new pattern
- Run `npm test` before submitting
- Rebuild `dist/` before pushing

---

## License

MIT © Green Code Team
