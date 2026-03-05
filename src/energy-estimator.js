'use strict';

/**
 * Energy Estimation & Scoring
 *
 * Converts a list of findings into a human-readable energy score and grade.
 *
 * Scoring model
 * ─────────────
 * Each finding contributes its `energyPoints` value to a running total.
 * Multiple findings for the same pattern in the same file each add their
 * points independently (repeated patterns compound the waste).
 *
 * Grade thresholds
 * ────────────────
 *   Score   Grade  Label           Badge colour
 *   0       A+     Excellent        brightgreen
 *   1–15    A      Good             green
 *   16–40   B      Fair             yellowgreen
 *   41–80   C      Needs Work       orange
 *   81+     D      Critical         red
 */

const GRADES = [
  { maxScore: 0,  grade: 'A+', label: 'Excellent',   color: 'brightgreen', emoji: '🌿' },
  { maxScore: 15, grade: 'A',  label: 'Good',         color: 'green',       emoji: '✅' },
  { maxScore: 40, grade: 'B',  label: 'Fair',         color: 'yellowgreen', emoji: '🟡' },
  { maxScore: 80, grade: 'C',  label: 'Needs Work',   color: 'orange',      emoji: '⚠️'  },
  { maxScore: Infinity, grade: 'D', label: 'Critical', color: 'red',       emoji: '🔴' },
];

const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];

/**
 * Estimate energy impact from an array of findings.
 *
 * @param {Array} findings   From analyzer.analyze()
 * @returns {Object}         score, grade, label, color, emoji, breakdown, savings
 */
function estimate(findings) {
  const totalScore = findings.reduce((sum, f) => sum + f.energyPoints, 0);
  const gradeInfo  = getGrade(totalScore);

  // Breakdown by severity
  const breakdown = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const f of findings) breakdown[f.severity] = (breakdown[f.severity] || 0) + 1;

  // Rough energy saving estimate in watt-hours per day
  // (very approximate — assumes a busy server context)
  const savings = estimateSavings(findings);

  return {
    score:    totalScore,
    grade:    gradeInfo.grade,
    label:    gradeInfo.label,
    color:    gradeInfo.color,
    emoji:    gradeInfo.emoji,
    findings: findings.length,
    breakdown,
    savings,
    topIssues: topPatterns(findings, 3),
  };
}

// ─── Internal helpers ────────────────────────────────────────────────────────

function getGrade(score) {
  for (const g of GRADES) {
    if (score <= g.maxScore) return g;
  }
  return GRADES[GRADES.length - 1];
}

/**
 * Return the top N most-frequent patterns across all findings.
 */
function topPatterns(findings, n) {
  const counts = {};
  for (const f of findings) {
    const key = f.patternId;
    counts[key] = counts[key] || { patternId: f.patternId, name: f.patternName,
      severity: f.severity, count: 0, totalPoints: 0 };
    counts[key].count++;
    counts[key].totalPoints += f.energyPoints;
  }
  return Object.values(counts)
    .sort((a, b) => b.totalPoints - a.totalPoints)
    .slice(0, n);
}

/**
 * Very rough energy savings estimate.
 *
 * References / assumptions:
 *  - A typical web server idles at ~50 W and peaks at ~150 W
 *  - "critical" patterns can cause continuous 10–30% extra CPU usage
 *  - "high" patterns: 2–10% extra CPU depending on call frequency
 *  - "medium": 0.5–2%
 *  - "low": < 0.5%
 *
 * We assume an application runs 24 h/day on a 100 W server.
 * Extra CPU % × 100 W × 24 h = extra Wh/day.
 */
const SEVERITY_EXTRA_CPU_PCT = { critical: 15, high: 5, medium: 1.5, low: 0.4 };

function estimateSavings(findings) {
  if (findings.length === 0) return { whPerDay: 0, co2GramsPerDay: 0, description: 'No issues found.' };

  let extraCpuPct = 0;
  for (const f of findings) {
    extraCpuPct += SEVERITY_EXTRA_CPU_PCT[f.severity] || 0;
  }
  extraCpuPct = Math.min(extraCpuPct, 80); // cap at 80%

  const serverWatts   = 100;
  const hoursPerDay   = 24;
  const whPerDay      = (extraCpuPct / 100) * serverWatts * hoursPerDay;

  // US grid average: ~0.386 kg CO₂/kWh (EPA 2023)
  const co2GramsPerDay = (whPerDay / 1000) * 386;

  let description;
  if (whPerDay < 1) {
    description = 'Minimal estimated energy impact (< 1 Wh/day).';
  } else if (whPerDay < 50) {
    description = `~${Math.round(whPerDay)} Wh/day (~${Math.round(co2GramsPerDay)} g CO₂) could be saved.`;
  } else {
    description = `~${(whPerDay / 1000).toFixed(2)} kWh/day (~${Math.round(co2GramsPerDay / 1000)} kg CO₂) could be saved — significant!`;
  }

  return {
    whPerDay:         Math.round(whPerDay),
    co2GramsPerDay:   Math.round(co2GramsPerDay),
    extraCpuPct:      Math.round(extraCpuPct),
    description,
  };
}

/**
 * Filter findings by minimum severity.
 * @param {Array}  findings
 * @param {string} minSeverity  'low' | 'medium' | 'high' | 'critical'
 * @returns {Array}
 */
function filterBySeverity(findings, minSeverity) {
  const minIdx = SEVERITY_ORDER.indexOf(minSeverity);
  if (minIdx === -1) return findings;
  return findings.filter((f) => SEVERITY_ORDER.indexOf(f.severity) >= minIdx);
}

module.exports = { estimate, filterBySeverity, GRADES, SEVERITY_ORDER };
