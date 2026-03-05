'use strict';

/**
 * Parse a unified git diff and extract file information for analysis.
 *
 * Output per file:
 *   {
 *     filename : string,          // path in the new tree
 *     language : string | null,   // 'javascript' | 'python' | null
 *     lineInfos: Array<{
 *       content  : string,   // line text (without leading +/space)
 *       lineNumber: number,  // 1-based line number in the NEW file
 *       isAdded  : boolean,  // true = added by this PR, false = context line
 *     }>
 *   }
 *
 * Files with language === null (unsupported extensions) are included so callers
 * can decide whether to warn; the analyzer simply skips them.
 */

/**
 * @param {string} diffContent  Raw unified diff text
 * @returns {Array}             Parsed file objects
 */
function parseDiff(diffContent) {
  const files = [];
  let currentFile = null;
  let newLineNum = 0;       // current line number in the new file

  for (const raw of diffContent.split('\n')) {
    // ── New file header ────────────────────────────────────────────────────
    if (raw.startsWith('diff --git ')) {
      if (currentFile) files.push(currentFile);

      // Extract the b/ path  (handles spaces in filenames)
      const m = raw.match(/^diff --git a\/.+ b\/(.+)$/);
      const filename = m ? m[1].trim() : 'unknown';

      currentFile = {
        filename,
        language: detectLanguage(filename),
        lineInfos: [],
      };
      newLineNum = 0;
      continue;
    }

    if (!currentFile) continue;

    // ── Metadata lines ─────────────────────────────────────────────────────
    if (
      raw.startsWith('index ') ||
      raw.startsWith('new file mode') ||
      raw.startsWith('old file mode') ||
      raw.startsWith('deleted file mode') ||
      raw.startsWith('rename from') ||
      raw.startsWith('rename to') ||
      raw.startsWith('Binary files') ||
      raw.startsWith('--- ') ||
      raw.startsWith('+++ ')
    ) {
      continue;
    }

    // ── Hunk header: @@ -oldStart,oldLen +newStart,newLen @@ ──────────────
    if (raw.startsWith('@@')) {
      const hm = raw.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hm) newLineNum = parseInt(hm[1], 10) - 1; // will be incremented below
      continue;
    }

    // ── Diff content lines ─────────────────────────────────────────────────
    if (raw.startsWith('+')) {
      // Added line
      currentFile.lineInfos.push({
        content:    raw.slice(1),
        lineNumber: ++newLineNum,
        isAdded:    true,
      });
    } else if (raw.startsWith('-')) {
      // Removed line — not in new file, don't advance newLineNum
    } else {
      // Context line (starts with ' ' or is blank within a hunk)
      const content = raw.startsWith(' ') ? raw.slice(1) : raw;
      currentFile.lineInfos.push({
        content,
        lineNumber: ++newLineNum,
        isAdded:    false,
      });
    }
  }

  if (currentFile && currentFile.lineInfos.length > 0) {
    files.push(currentFile);
  }

  return files;
}

/**
 * Detect the programming language from a filename.
 * @param {string} filename
 * @returns {'javascript'|'python'|null}
 */
function detectLanguage(filename) {
  if (/\.(js|jsx|ts|tsx|mjs|cjs)$/i.test(filename)) return 'javascript';
  if (/\.py$/i.test(filename)) return 'python';
  return null;
}

/**
 * Parse a raw file (not a diff) into the same lineInfos format.
 * All lines are treated as "added" so the analyzer checks everything.
 *
 * @param {string} filename
 * @param {string} content
 * @returns {Object} parsed file object
 */
function parseFile(filename, content) {
  const lines = content.split('\n');
  return {
    filename,
    language: detectLanguage(filename),
    lineInfos: lines.map((text, idx) => ({
      content:    text,
      lineNumber: idx + 1,
      isAdded:    true,
    })),
  };
}

module.exports = { parseDiff, parseFile, detectLanguage };
