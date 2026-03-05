'use strict';

/**
 * Phase 3 — Policy Gates
 *
 * Deterministic rules evaluated after Phase 1 (pattern analysis) and
 * Phase 2 (LLM analysis). In SOFT mode (default) every gate produces
 * a WARN at worst — the PR is never blocked.
 *
 * Gate result:
 *   { id, name, status: 'pass'|'warn'|'info', detail, recommendation }
 *
 * Final verdict:
 *   PASS  — all gates passed
 *   WARN  — one or more gates triggered (soft mode: always this, never BLOCK)
 */

// ─── Gate Definitions ─────────────────────────────────────────────────────────

const GATES = [
  // ── GATE001 ────────────────────────────────────────────────────────────────
  {
    id:   'GATE001',
    name: 'Critical Energy Pattern',
    description: 'One or more critical anti-patterns that cause severe energy waste were detected.',
    check(allFindings, estimate) {
      const criticals = allFindings.filter((f) => f.severity === 'critical');
      if (criticals.length === 0) {
        return pass('No critical patterns found');
      }
      const names = [...new Set(criticals.map((f) => f.patternName))].join(', ');
      return warn(
        `${criticals.length} critical pattern(s): ${names}`,
        'Fix critical patterns before merging — they have the highest energy impact.'
      );
    },
  },

  // ── GATE002 ────────────────────────────────────────────────────────────────
  {
    id:   'GATE002',
    name: 'Energy Score Threshold',
    description: 'Total energy debt score across all findings.',
    threshold: 80,
    check(allFindings, estimate) {
      const score = estimate.score;
      const limit = this.threshold;
      if (score <= limit) {
        return pass(`Score ${score} is within the ${limit}-point threshold`);
      }
      return warn(
        `Score ${score} exceeds the ${limit}-point threshold`,
        `Reduce high and critical findings to bring the score below ${limit}.`
      );
    },
  },

  // ── GATE003 ────────────────────────────────────────────────────────────────
  {
    id:   'GATE003',
    name: 'High Severity Count',
    description: 'Number of high-severity issues in this PR.',
    maxAllowed: 3,
    check(allFindings) {
      const highs = allFindings.filter((f) => f.severity === 'high');
      if (highs.length < this.maxAllowed) {
        return pass(`${highs.length} high-severity issue(s) — within limit of ${this.maxAllowed}`);
      }
      return warn(
        `${highs.length} high-severity issues (limit: ${this.maxAllowed})`,
        'Consider splitting this PR into smaller changes to keep energy impact manageable.'
      );
    },
  },

  // ── GATE004 ────────────────────────────────────────────────────────────────
  {
    id:   'GATE004',
    name: 'Energy Grade',
    description: 'Overall energy efficiency grade for this PR.',
    acceptableGrades: ['A+', 'A', 'B'],
    check(allFindings, estimate) {
      if (this.acceptableGrades.includes(estimate.grade)) {
        return pass(`Grade ${estimate.grade} — ${estimate.label}`);
      }
      return info(
        `Grade ${estimate.grade} — ${estimate.label}`,
        `Aim for grade B or above. Fix high and critical findings to improve the grade.`
      );
    },
  },

  // ── GATE005 ────────────────────────────────────────────────────────────────
  {
    id:   'GATE005',
    name: 'LLM Additional Findings',
    description: 'Extra issues found by semantic LLM analysis beyond deterministic patterns.',
    check(allFindings) {
      const llmFindings = allFindings.filter((f) => f.source === 'llm');
      if (llmFindings.length === 0) {
        return pass('No additional issues found by LLM analysis');
      }
      return info(
        `LLM detected ${llmFindings.length} additional issue(s) not caught by pattern rules`,
        'Review the LLM findings in Phase 2 — they may indicate deeper architectural issues.'
      );
    },
  },

  // ── GATE006 ────────────────────────────────────────────────────────────────
  {
    id:   'GATE006',
    name: 'Estimated Energy Impact',
    description: 'Estimated daily energy cost of the anti-patterns in this PR.',
    thresholdWh: 50,
    check(allFindings, estimate) {
      const wh = estimate.savings?.whPerDay || 0;
      if (wh < this.thresholdWh) {
        return pass(`Estimated impact: ~${wh} Wh/day — within acceptable range`);
      }
      return warn(
        `Estimated ~${wh} Wh/day (${estimate.savings?.co2GramsPerDay || 0} g CO₂/day) wasted`,
        'The patterns in this PR could have significant energy impact at production scale.'
      );
    },
  },
];

// ─── Evaluator ────────────────────────────────────────────────────────────────

/**
 * Evaluate all gates against the combined findings.
 *
 * @param {Array}  allFindings  Phase 1 + Phase 2 findings combined
 * @param {Object} estimate     From energy-estimator
 * @param {string} mode         'soft' (default) — warns only, never blocks
 * @returns {{ results, verdict, summary }}
 */
function evaluateGates(allFindings, estimate, mode = 'soft') {
  const results = GATES.map((gate) => {
    try {
      const result = gate.check(allFindings, estimate);
      return { id: gate.id, name: gate.name, description: gate.description, ...result };
    } catch (_) {
      return { id: gate.id, name: gate.name, description: gate.description,
        status: 'pass', detail: 'Gate check skipped (error)', recommendation: '' };
    }
  });

  // In soft mode: WARN at worst (never BLOCK)
  const hasWarn = results.some((r) => r.status === 'warn');
  const hasInfo = results.some((r) => r.status === 'info');

  let verdict, verdictEmoji, verdictDetail;
  if (!hasWarn && !hasInfo) {
    verdict      = 'PASS';
    verdictEmoji = '✅';
    verdictDetail = 'All policy gates passed. This PR looks energy-efficient!';
  } else if (hasWarn) {
    verdict      = 'WARN';
    verdictEmoji = '⚠️';
    verdictDetail = 'Some policy gates triggered. Review the warnings below before merging.';
  } else {
    verdict      = 'PASS';
    verdictEmoji = '💡';
    verdictDetail = 'No critical issues, but there are informational suggestions worth reviewing.';
  }

  const warnCount = results.filter((r) => r.status === 'warn').length;
  const infoCount = results.filter((r) => r.status === 'info').length;
  const passCount = results.filter((r) => r.status === 'pass').length;

  return {
    results,
    verdict,
    verdictEmoji,
    verdictDetail,
    mode,
    summary: `${passCount} passed · ${warnCount} warnings · ${infoCount} informational`,
  };
}

// ─── Result constructors ──────────────────────────────────────────────────────

function pass(detail) {
  return { status: 'pass', detail, recommendation: '' };
}

function warn(detail, recommendation = '') {
  return { status: 'warn', detail, recommendation };
}

function info(detail, recommendation = '') {
  return { status: 'info', detail, recommendation };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Merge Phase 1 and Phase 2 findings into a single array.
 */
function mergeFindings(phase1, phase2) {
  return [
    ...phase1.map((f) => ({ ...f, source: f.source || 'pattern' })),
    ...phase2.map((f) => ({ ...f, source: 'llm' })),
  ];
}

module.exports = { evaluateGates, mergeFindings, GATES };
