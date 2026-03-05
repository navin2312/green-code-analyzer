# Green Code Analyzer

> A GitHub Action and CLI tool that detects energy anti-patterns in JavaScript and Python pull requests, estimates their environmental impact, and posts actionable suggestions directly into the PR workflow.

![Energy Grade A+](https://img.shields.io/badge/energy%20grade-A%2B-brightgreen?style=flat-square&logo=leaf)
[![CI](https://github.com/your-org/green-code-analyzer/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/green-code-analyzer/actions)

---

## Why this exists

Software runs on physical hardware that consumes electricity. Poor coding patterns — frequent polling, N+1 network requests, busy-wait loops, inefficient data processing — silently waste CPU cycles, keep the network radio active, and prevent the processor from entering low-power idle states. At scale across millions of deployments, these inefficiencies translate into measurable CO₂ emissions and electricity costs.

Green Code Analyzer makes these invisible costs visible, right inside the PR review workflow.

---

## Features

- **24 energy anti-patterns** detected across JavaScript and Python
- **Unified diff analysis** — only reports issues on *added* lines in the PR
- **Energy scoring & grading** — A+ through D based on severity-weighted findings
- **CO₂ & Wh savings estimate** — rough but tangible environmental impact numbers
- **GitHub PR comment** — rich markdown report with collapsible per-file details
- **Shields.io badge** — embeddable grade badge for your README
- **CLI tool** — run locally, against files, git diffs, or piped input
- **JSON, Markdown, and terminal output** formats

---

## Detected Patterns

### JavaScript

| ID | Name | Severity |
|----|------|----------|
| JS001 | Frequent Polling (`setInterval < 1s`) | High |
| JS002 | Network Request Inside Loop (N+1) | Critical |
| JS003 | Missing Debounce on High-Frequency Events | High |
| JS004 | DOM Query Inside Loop | High |
| JS005 | Synchronous XMLHttpRequest | High |
| JS006 | Triple-Chained Array Iterations | Medium |
| JS007 | `eval()` Disables JIT Optimisation | Medium |
| JS008 | JSON Serialisation Inside Loop | Medium |
| JS009 | `console.log` Inside Loop | Low |
| JS010 | `document.write()` Causes Full Re-render | Medium |
| JS011 | Inefficient `setTimeout` Recursion (Tight Loop) | High |
| JS012 | Unremoved Event Listener (Memory/Energy Leak) | Medium |

### Python

| ID | Name | Severity |
|----|------|----------|
| PY001 | String Concatenation in Loop (O(n²)) | High |
| PY002 | `pandas DataFrame.iterrows()` | High |
| PY003 | `range(len(x))` Instead of `enumerate()` | Low |
| PY004 | Busy-Wait Spin Loop (`while True` without sleep) | Critical |
| PY005 | Loading Entire File with `.read()` / `.readlines()` | Medium |
| PY006 | Recursive Function Without `@lru_cache` | Medium |
| PY007 | `list.append()` in Loop vs List Comprehension | Low |
| PY008 | Empty Collection Initialised Inside Loop | Medium |
| PY009 | `pandas itertuples()` in Hot Path | Medium |
| PY010 | Nested Loops (Potential O(n²) Complexity) | Medium |
| PY011 | Old-Style String Formatting in Loop | Low |
| PY012 | Repeated Computation in Loop Condition | Low |

---

## GitHub Action Usage

### Quick start

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
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Green Code Analyzer
        uses: your-org/green-code-analyzer@v1
        with:
          github-token:       ${{ secrets.GITHUB_TOKEN }}
          fail-on-issues:     'false'   # set 'true' to enforce a green gate
          severity-threshold: 'medium'  # ignore low-severity findings
```

### Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `github-token` | `${{ github.token }}` | Token for fetching diffs and posting comments |
| `fail-on-issues` | `false` | Exit code 1 if any issues found above threshold |
| `severity-threshold` | `low` | Minimum severity: `low`, `medium`, `high`, `critical` |

### Outputs

| Output | Description |
|--------|-------------|
| `energy-score` | Total energy debt score (integer) |
| `grade` | Letter grade: `A+`, `A`, `B`, `C`, or `D` |
| `findings-count` | Number of detected issues |

### Example PR comment

The action posts a comment like this on every PR:

```
## 🟡 Green Code Analyzer — Energy Anti-Pattern Report

![Energy Grade B](https://img.shields.io/badge/energy%20grade-B-yellowgreen?...)

### Summary
| Metric | Value |
|--------|-------|
| Grade | 🟡 B — Fair |
| Energy Score | 37 points |
| Total Issues | 4 |
| Critical | 1 |
| High | 2 |
...

### Detailed Findings
<details>
<summary>src/api/users.js — 2 issue(s)</summary>
...
```

---

## CLI Usage

### Installation

```bash
npm install -g green-code-analyzer
```

Or run without installing:

```bash
npx green-code-analyzer check src/myfile.js
```

### Commands

```bash
# Analyse specific source files
green-code check src/app.js src/utils.py

# Analyse the current git diff
green-code check --git-diff

# Analyse only staged changes
green-code check --git-diff --staged

# Analyse a saved diff file
green-code check --diff pr-123.diff

# Read diff from stdin
git diff HEAD | green-code check --stdin

# Change output format
green-code check src/app.js --format json
green-code check src/app.js --format markdown

# Only report high and critical issues
green-code check src/app.js --severity high

# Fail with exit code 1 if issues are found (useful in CI)
green-code check src/app.js --fail-on-issues

# List all known patterns
green-code list-patterns
green-code list-patterns js
green-code list-patterns py
```

### Sample terminal output

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Green Code Analyzer — Energy Anti-Pattern Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Grade      : C — Needs Work
  Score      : 72 energy points
  Issues     : 5 (critical: 1, high: 2, medium: 1, low: 1)
  Est. impact: ~14 Wh/day (~5 g CO₂) could be saved.

  📄 src/poller.js

    [CRITICAL] Network Request Inside Loop (N+1) (JS002)
    Line 14: const res = await fetch(`/api/users/${id}`);
    → HTTP request inside loop — N separate round-trips instead of 1 batched call
    Fix: Batch all requests into a single network call using Promise.all()
```

---

## Grading Scale

| Score | Grade | Label |
|-------|-------|-------|
| 0 | A+ | Excellent — no issues |
| 1–15 | A | Good — minor concerns |
| 16–40 | B | Fair — some improvements recommended |
| 41–80 | C | Needs Work — significant energy issues |
| 81+ | D | Critical — major energy anti-patterns present |

---

## Development

### Setup

```bash
git clone https://github.com/your-org/green-code-analyzer
cd green-code-analyzer
npm install
```

### Run tests

```bash
npm test
```

### Build the action bundle

The GitHub Action requires a bundled `dist/index.js` (generated with `@vercel/ncc`):

```bash
npm run build
git add dist/
git commit -m "chore: rebuild dist bundle"
```

> **Important:** Always commit the updated `dist/` when changing source files.

### Project structure

```
green-code-analyzer/
├── src/
│   ├── patterns/
│   │   ├── js-patterns.js      JavaScript anti-pattern definitions
│   │   └── py-patterns.js      Python anti-pattern definitions
│   ├── diff-parser.js          Unified diff parser
│   ├── analyzer.js             Core analysis engine
│   ├── energy-estimator.js     Scoring and grade calculation
│   └── reporter.js             Markdown / terminal / JSON output
├── tests/
│   ├── fixtures/
│   │   ├── bad-js.js           JS file with intentional anti-patterns
│   │   ├── bad-py.py           Python file with intentional anti-patterns
│   │   ├── good-js.js          JS file with correct patterns (0 findings)
│   │   └── sample.diff         Sample unified diff for integration tests
│   └── run-tests.js            Test runner
├── action.js                   GitHub Action entry point (pre-bundle)
├── action.yml                  GitHub Action definition
├── cli.js                      CLI entry point
├── package.json
└── .github/workflows/
    ├── ci.yml                  Build & test on every push/PR
    └── energy-check.yml        Self-check this repo's own PRs
```

### Adding a new pattern

1. Open `src/patterns/js-patterns.js` or `src/patterns/py-patterns.js`
2. Add a new object to the `JS_PATTERNS` / `PY_PATTERNS` array following the existing schema
3. Add a corresponding example to `tests/fixtures/bad-*.js` / `bad-*.py`
4. Run `npm test` to verify detection
5. Rebuild: `npm run build`

---

## Contributing

Pull requests are welcome! Please:

- Keep `detect()` functions fast (no I/O, no heavy computation)
- Avoid false positives — use context windows conservatively
- Add a test fixture for every new pattern
- Run `npm test` before submitting

---

## License

MIT © Green Code Team
