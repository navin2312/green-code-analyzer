'use strict';

/**
 * Python Energy Anti-Patterns
 *
 * Same structure as js-patterns.js.
 * detect(lines, lineIndex) receives the full lines array (added + context)
 * and the index of the line to evaluate. Returns { match, detail } or null.
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

function countIndent(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

/**
 * Returns true if lines[lineIndex] appears to be inside a for/while loop.
 * Stops the upward search at function/class/if boundaries with lower indent.
 */
function isInsideLoopPy(lines, lineIndex) {
  const currentIndent = countIndent(lines[lineIndex]);

  for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 30); i--) {
    const prev = lines[i];
    if (!prev.trim()) continue;

    const prevIndent = countIndent(prev);
    if (prevIndent < currentIndent) {
      if (/^\s*(for|while)\s+/.test(prev)) return true;
      // Stop at enclosing def/class/if block to avoid false positives
      if (/^\s*(def|class|if|elif|else\s*:|try\s*:|except|finally\s*:|with\s+)/.test(prev)) return false;
    }
  }
  return false;
}

// ─── Pattern Definitions ─────────────────────────────────────────────────────

const PY_PATTERNS = [
  // ── PY001 ──────────────────────────────────────────────────────────────────
  {
    id: 'PY001',
    name: 'String Concatenation in Loop (O(n²) copies)',
    severity: 'high',
    energyPoints: 18,
    description:
      'Using += to build a string inside a loop creates a brand-new string ' +
      'object on every iteration (CPython strings are immutable). For n ' +
      'iterations this means O(n²) total bytes copied, wasting CPU and RAM.',
    suggestion:
      "Collect parts in a list and call ''.join(parts) once at the end, " +
      'which is O(n) total work. For simple transformations use a generator ' +
      'expression inside join().',
    example: {
      bad:  "result = ''\nfor item in items:\n    result += str(item) + ', '",
      good: "result = ', '.join(str(item) for item in items)",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      // += with a string literal, f-string, or str() call
      if (!/\+=\s*(?:['\"bf]|str\s*\()/.test(line)) return null;
      if (isInsideLoopPy(lines, lineIndex)) {
        return {
          match: line.trim().substring(0, 70),
          detail: "String += in loop creates O(n²) copies — use ''.join(parts)",
        };
      }
      return null;
    },
  },

  // ── PY002 ──────────────────────────────────────────────────────────────────
  {
    id: 'PY002',
    name: 'pandas DataFrame.iterrows() — Extremely Slow',
    severity: 'high',
    energyPoints: 25,
    description:
      'iterrows() boxes each row into a Python dict-like Series with full ' +
      'dtype inference, making it 10–1000× slower than vectorised operations. ' +
      'For a 1M-row DataFrame the difference is minutes vs milliseconds.',
    suggestion:
      'Use vectorised column arithmetic (df["c"] = df["a"] + df["b"]), ' +
      'numpy operations, or df.apply() with axis=1 as a last resort. ' +
      'If you need row objects, itertuples() is faster but still not ideal.',
    example: {
      bad:  "for idx, row in df.iterrows():\n    df.at[idx, 'total'] = row['qty'] * row['price']",
      good: "df['total'] = df['qty'] * df['price']  # vectorised",
    },
    detect(lines, lineIndex) {
      if (/\.iterrows\s*\(\s*\)/.test(lines[lineIndex])) {
        return {
          match: '.iterrows()',
          detail: 'iterrows() can be 1000× slower than vectorised pandas operations',
        };
      }
      return null;
    },
  },

  // ── PY003 ──────────────────────────────────────────────────────────────────
  {
    id: 'PY003',
    name: 'range(len(x)) Instead of enumerate()',
    severity: 'low',
    energyPoints: 5,
    description:
      'range(len(iterable)) forces an extra len() call and an index look-up ' +
      'per iteration. enumerate() is a built-in lazy iterator that avoids these ' +
      'and expresses intent more clearly.',
    suggestion:
      'Replace "for i in range(len(x)):" with "for i, val in enumerate(x):".',
    example: {
      bad:  "for i in range(len(items)):\n    process(items[i])",
      good: "for i, item in enumerate(items):\n    process(item)",
    },
    detect(lines, lineIndex) {
      if (/\bfor\s+\w+\s+in\s+range\s*\(\s*len\s*\(/.test(lines[lineIndex])) {
        return {
          match: 'range(len(...))',
          detail: 'Use enumerate() — avoids repeated index lookups',
        };
      }
      return null;
    },
  },

  // ── PY004 ──────────────────────────────────────────────────────────────────
  {
    id: 'PY004',
    name: 'Busy-Wait Spin Loop (while True without sleep)',
    severity: 'critical',
    energyPoints: 35,
    description:
      '"while True:" without a sleep / event-wait executes as fast as the ' +
      'interpreter allows, consuming 100% of a CPU core continuously and ' +
      'preventing it from entering any low-power state.',
    suggestion:
      'Add time.sleep(n) with a reasonable interval, use threading.Event.wait(), ' +
      'asyncio.sleep(), or replace with an event-driven architecture entirely.',
    example: {
      bad:  "while True:\n    if has_work():\n        do_work()\n    # no sleep → 100% CPU",
      good: "while True:\n    if has_work():\n        do_work()\n    time.sleep(0.5)",
    },
    detect(lines, lineIndex) {
      if (!/^\s*while\s+True\s*:/.test(lines[lineIndex])) return null;

      const body = lines.slice(lineIndex + 1, lineIndex + 20).join('\n');
      // Good: has a real sleep / event wait
      if (/\btime\.sleep\s*\(\s*[1-9]|\basyncio\.sleep\s*\(|\bEvent\b.*\.wait\s*\(|\bqueue\.get\s*\(/.test(body)) {
        return null;
      }
      // Bad: no sleep, or sleep(0) / sleep(very small)
      const sleepMatch = body.match(/\bsleep\s*\(\s*([\d.]+)\s*\)/);
      const detail = sleepMatch
        ? `sleep(${sleepMatch[1]}) is effectively a spin-wait`
        : 'No sleep() or event wait — 100% CPU spin loop';

      return { match: 'while True:', detail };
    },
  },

  // ── PY005 ──────────────────────────────────────────────────────────────────
  {
    id: 'PY005',
    name: 'Loading Entire File with .read() / .readlines()',
    severity: 'medium',
    energyPoints: 12,
    description:
      '.read() and .readlines() load the entire file into RAM before any ' +
      'processing begins. For large files this causes a large memory allocation, ' +
      'forces the OS to page in the full content, and prevents any parallelism ' +
      'between I/O and computation.',
    suggestion:
      'Iterate over the file object directly ("for line in f:") for line-by-line ' +
      'streaming, or use generators / itertools for lazy processing.',
    example: {
      bad:  "with open('big.log') as f:\n    for line in f.readlines():  # loads ALL lines",
      good: "with open('big.log') as f:\n    for line in f:  # streams one line at a time",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      if (/\.(readlines|read)\s*\(\s*\)/.test(line) && !/^\s*#/.test(line)) {
        return {
          match: line.includes('readlines') ? '.readlines()' : '.read()',
          detail: 'Loads entire file into RAM — iterate the file object directly instead',
        };
      }
      return null;
    },
  },

  // ── PY006 ──────────────────────────────────────────────────────────────────
  {
    id: 'PY006',
    name: 'Recursive Function Without @lru_cache',
    severity: 'medium',
    energyPoints: 15,
    description:
      'A pure recursive function (e.g., Fibonacci, tree traversal) that ' +
      'recomputes the same sub-problems exponentially wastes CPU cycles. ' +
      'Memoisation with @functools.lru_cache can reduce O(2^n) to O(n).',
    suggestion:
      'Add @functools.lru_cache(maxsize=None) or @functools.cache (Python 3.9+) ' +
      'above the function definition.',
    example: {
      bad:  "def fib(n):  # O(2^n) recomputation\n    if n <= 1: return n\n    return fib(n-1) + fib(n-2)",
      good: "@functools.lru_cache(maxsize=None)\ndef fib(n):  # O(n)\n    if n <= 1: return n\n    return fib(n-1) + fib(n-2)",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      const funcMatch = line.match(/^(\s*)def\s+(\w+)\s*\(/);
      if (!funcMatch) return null;

      const funcName = funcMatch[2];
      const baseIndent = funcMatch[1].length;

      // Check for existing cache decorator (look back 3 lines)
      const above = lines.slice(Math.max(0, lineIndex - 3), lineIndex).join('\n');
      if (/@lru_cache|@cache|@functools\.(lru_cache|cache)/.test(above)) return null;

      // Find the function body (lines with more indentation)
      const bodyLines = [];
      for (let j = lineIndex + 1; j < Math.min(lines.length, lineIndex + 25); j++) {
        const bl = lines[j];
        if (!bl.trim()) continue;
        if (countIndent(bl) <= baseIndent) break;
        bodyLines.push(bl);
      }
      const body = bodyLines.join('\n');

      // Self-call detection
      if (new RegExp(`\\b${funcName}\\s*\\(`).test(body)) {
        return {
          match: `def ${funcName}(...)`,
          detail: `Recursive '${funcName}' without @lru_cache may cause exponential recomputation`,
        };
      }
      return null;
    },
  },

  // ── PY007 ──────────────────────────────────────────────────────────────────
  {
    id: 'PY007',
    name: 'list.append() in Loop (vs List Comprehension)',
    severity: 'low',
    energyPoints: 6,
    description:
      'Building a list with repeated .append() calls in a loop involves ' +
      'per-call overhead (LOAD_ATTR + CALL_FUNCTION bytecodes). List ' +
      'comprehensions are compiled to a specialised LIST_APPEND opcode ' +
      'that is 20–50% faster in CPython.',
    suggestion:
      'Replace the loop + append with a list comprehension or generator ' +
      'expression when the transformation is straightforward.',
    example: {
      bad:  "result = []\nfor x in data:\n    result.append(transform(x))",
      good: "result = [transform(x) for x in data]",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      if (!/\.\s*append\s*\(/.test(line)) return null;
      if (isInsideLoopPy(lines, lineIndex)) {
        return {
          match: '.append() in loop',
          detail: 'Use a list comprehension — 20–50% faster than append() in CPython',
        };
      }
      return null;
    },
  },

  // ── PY008 ──────────────────────────────────────────────────────────────────
  {
    id: 'PY008',
    name: 'Empty Collection Initialised Inside Loop',
    severity: 'medium',
    energyPoints: 10,
    description:
      'Creating a new [] or {} inside a loop that is immediately populated ' +
      'and then discarded causes repeated heap allocations and GC pressure, ' +
      'especially inside tight inner loops.',
    suggestion:
      'Pre-allocate the collection outside the loop or use a comprehension ' +
      'to build it in a single expression.',
    example: {
      bad:  "for batch in batches:\n    tmp = []\n    for item in batch:\n        tmp.append(process(item))",
      good: "results = [process(item) for batch in batches for item in batch]",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      if (!/=\s*\[\s*\]|=\s*\{\s*\}|=\s*set\s*\(\s*\)|=\s*dict\s*\(\s*\)|=\s*list\s*\(\s*\)/.test(line)) return null;
      if (isInsideLoopPy(lines, lineIndex)) {
        return {
          match: line.trim().substring(0, 70),
          detail: 'Empty collection created per-iteration — pre-allocate outside the loop',
        };
      }
      return null;
    },
  },

  // ── PY009 ──────────────────────────────────────────────────────────────────
  {
    id: 'PY009',
    name: 'pandas itertuples() in Hot Path',
    severity: 'medium',
    energyPoints: 12,
    description:
      'itertuples() returns namedtuples (faster than iterrows()) but still ' +
      'iterates in pure Python. For DataFrames with more than a few thousand ' +
      'rows, vectorised operations are 10–100× faster.',
    suggestion:
      'Use column arithmetic (df["out"] = df["a"] * df["b"]), numpy ufuncs, ' +
      'or df.eval() for the best performance.',
    example: {
      bad:  "total = sum(row.amount * row.qty for row in df.itertuples())",
      good: "total = (df['amount'] * df['qty']).sum()  # vectorised",
    },
    detect(lines, lineIndex) {
      if (/\.itertuples\s*\(/.test(lines[lineIndex])) {
        return {
          match: '.itertuples()',
          detail: 'Still row-by-row Python iteration — prefer vectorised operations',
        };
      }
      return null;
    },
  },

  // ── PY010 ──────────────────────────────────────────────────────────────────
  {
    id: 'PY010',
    name: 'Nested Loops (Potential O(n²) Complexity)',
    severity: 'medium',
    energyPoints: 14,
    description:
      'A for loop directly nested inside another for loop has O(n×m) complexity. ' +
      'For large inputs this can be the dominant energy consumer in the program. ' +
      'Many O(n²) patterns can be reduced to O(n) with sets, dicts, or sorting.',
    suggestion:
      'Convert the inner lookup to a set/dict O(1) lookup, use numpy broadcasting, ' +
      'or apply sorting + two-pointer techniques.',
    example: {
      bad:  "for a in list_a:\n    for b in list_b:\n        if a == b:\n            matches.append(a)",
      good: "set_b = set(list_b)\nmatches = [a for a in list_a if a in set_b]  # O(n)",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      if (!/^\s*for\s+/.test(line)) return null;
      if (isInsideLoopPy(lines, lineIndex)) {
        return {
          match: 'Nested for loop',
          detail: 'Nested loops have O(n²) complexity — consider set/dict for O(n) lookups',
        };
      }
      return null;
    },
  },

  // ── PY011 ──────────────────────────────────────────────────────────────────
  {
    id: 'PY011',
    name: 'Old-Style String Formatting in Loop',
    severity: 'low',
    energyPoints: 7,
    description:
      'Using % or .format() for string formatting inside a loop is slower than ' +
      'f-strings (Python 3.6+), which are compiled to a single BUILD_STRING ' +
      'opcode and avoid attribute lookups.',
    suggestion:
      "Replace with f-strings: f'{name}: {value}' is the fastest option in CPython.",
    example: {
      bad:  "for row in rows:\n    label += '%s=%d, ' % (row.key, row.val)",
      good: "label = ', '.join(f'{row.key}={row.val}' for row in rows)",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      if (!/%\s*\(|\.\s*format\s*\(/.test(line)) return null;
      if (!/\+=/.test(line)) return null; // only flag when accumulating
      if (isInsideLoopPy(lines, lineIndex)) {
        return {
          match: line.trim().substring(0, 70),
          detail: 'Old-style string formatting in loop — use f-strings + join()',
        };
      }
      return null;
    },
  },

  // ── PY012 ──────────────────────────────────────────────────────────────────
  {
    id: 'PY012',
    name: 'Repeated Computation in Loop Condition',
    severity: 'low',
    energyPoints: 6,
    description:
      'Calling len(), sorted(), min(), or max() in a while-loop condition or ' +
      'for-loop header recomputes the value every iteration instead of caching it.',
    suggestion:
      'Cache the value before the loop: "n = len(items); while i < n:"',
    example: {
      bad:  "while i < len(items):  # len() called every iteration\n    process(items[i]); i += 1",
      good: "n = len(items)\nwhile i < n:\n    process(items[i]); i += 1",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      if (/^\s*while\s+.+<\s*(len|sorted|min|max)\s*\(/.test(line)) {
        return {
          match: line.trim().substring(0, 70),
          detail: 'Function call in while condition recomputes on every iteration',
        };
      }
      return null;
    },
  },
];

module.exports = { PY_PATTERNS };
