'use strict';

const { JS_PATTERNS } = require('./patterns/js-patterns');
const { PY_PATTERNS } = require('./patterns/py-patterns');

const PATTERNS = {
  javascript: JS_PATTERNS,
  python:     PY_PATTERNS,
};

/**
 * Analyse a single parsed file (from diff-parser) for energy anti-patterns.
 *
 * @param {Object} parsedFile  { filename, language, lineInfos }
 * @returns {Array} findings   Array of finding objects
 */
function analyzeFile(parsedFile) {
  const { filename, language, lineInfos } = parsedFile;
  const patterns = PATTERNS[language];
  if (!patterns || !lineInfos.length) return [];

  // Build a plain string array for the detect() helpers (they need string[])
  const lines = lineInfos.map((li) => li.content);
  const findings = [];

  for (let i = 0; i < lineInfos.length; i++) {
    // Only check lines that were added in this PR / file
    if (!lineInfos[i].isAdded) continue;

    for (const pattern of patterns) {
      let result = null;
      try {
        result = pattern.detect(lines, i);
      } catch (_) {
        // Swallow pattern errors so one broken regex can't abort the whole run
      }
      if (!result) continue;

      findings.push({
        patternId:    pattern.id,
        patternName:  pattern.name,
        severity:     pattern.severity,
        energyPoints: pattern.energyPoints,
        description:  pattern.description,
        suggestion:   pattern.suggestion,
        example:      pattern.example,
        filename,
        lineNumber:   lineInfos[i].lineNumber,
        match:        result.match   || lines[i].trim().substring(0, 80),
        detail:       result.detail  || '',
      });
    }
  }

  return findings;
}

/**
 * Analyse an array of parsed files and return all findings.
 *
 * @param {Array} parsedFiles
 * @returns {Array} findings
 */
function analyze(parsedFiles) {
  const all = [];
  for (const pf of parsedFiles) {
    all.push(...analyzeFile(pf));
  }
  return all;
}

/**
 * Return the list of supported language identifiers.
 */
function supportedLanguages() {
  return Object.keys(PATTERNS);
}

module.exports = { analyze, analyzeFile, supportedLanguages };
