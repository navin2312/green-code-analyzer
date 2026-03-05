'use strict';

/**
 * JavaScript Energy Anti-Patterns
 *
 * Each pattern has:
 *   id          - unique identifier
 *   name        - human-readable name
 *   severity    - 'low' | 'medium' | 'high' | 'critical'
 *   energyPoints - contribution to energy debt score
 *   description - what the pattern is and why it wastes energy
 *   suggestion  - how to fix it
 *   example     - { bad, good } code snippets
 *   detect(lines, lineIndex) - returns { line, match, detail } or null
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

function countIndent(line) {
  const m = line.match(/^(\s*)/);
  return m ? m[1].length : 0;
}

/**
 * Heuristic: is lines[lineIndex] inside a loop?
 * Looks back up to 30 lines for a loop construct with less indentation.
 */
function isInsideLoopJS(lines, lineIndex) {
  const loopRe = [
    /^\s*(for\s*\(|for\s+(?:const|let|var)\s+|while\s*\(|do\s*\{)/,
    /\.(forEach|map|filter|reduce|flatMap|every|some|find)\s*\(\s*(?:function|(?:async\s*)?\(|[a-zA-Z_$])/,
  ];

  const currentIndent = countIndent(lines[lineIndex]);

  for (let i = lineIndex - 1; i >= Math.max(0, lineIndex - 30); i--) {
    const prev = lines[i];
    if (!prev.trim()) continue;

    const prevIndent = countIndent(prev);
    if (prevIndent < currentIndent) {
      if (loopRe.some((re) => re.test(prev))) return true;
      // Hitting a function/class boundary stops the upward search
      if (/^\s*(function|class|const\s+\w+\s*=\s*(?:async\s*)?\(|=>\s*\{)/.test(prev)) return false;
    }
  }
  return false;
}

// ─── Pattern Definitions ─────────────────────────────────────────────────────

const JS_PATTERNS = [
  // ── JS001 ──────────────────────────────────────────────────────────────────
  {
    id: 'JS001',
    name: 'Frequent Polling (setInterval < 1s)',
    severity: 'high',
    energyPoints: 20,
    description:
      'setInterval with an interval < 1000 ms causes repeated CPU wake-ups, ' +
      'preventing the processor from entering low-power idle states. ' +
      'At 100 ms intervals the CPU wakes 10× per second solely for this task.',
    suggestion:
      'Replace polling with event-driven patterns: WebSockets, Server-Sent Events, ' +
      'BroadcastChannel, or Intersection/Mutation Observer. ' +
      'If polling is unavoidable use intervals ≥ 5000 ms.',
    example: {
      bad:  "setInterval(fetchUpdates, 200); // 5 wakes/sec",
      good: "const ws = new WebSocket(url);\nws.onmessage = handleUpdate; // zero idle wakes",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];

      // Pattern A: single-line  setInterval(fn, 200)
      const inlineMatch = line.match(/setInterval\s*\([^,)]+,\s*(\d+)\s*\)/);
      if (inlineMatch) {
        const ms = parseInt(inlineMatch[1], 10);
        if (ms > 0 && ms < 1000) {
          return {
            match: inlineMatch[0],
            detail: `Polling every ${ms} ms → ~${Math.round(1000 / ms)} CPU wake-ups/sec`,
          };
        }
      }

      // Pattern B: multi-line closing  }, 200);  after a setInterval( opening
      const closingMatch = line.match(/^\s*\}\s*,\s*(\d+)\s*\)\s*;/);
      if (closingMatch) {
        const ms = parseInt(closingMatch[1], 10);
        if (ms > 0 && ms < 1000) {
          const preceding = lines.slice(Math.max(0, lineIndex - 25), lineIndex).join('\n');
          if (/setInterval\s*\(/.test(preceding)) {
            return {
              match: `setInterval(..., ${ms})`,
              detail: `Polling every ${ms} ms → ~${Math.round(1000 / ms)} CPU wake-ups/sec`,
            };
          }
        }
      }

      return null;
    },
  },

  // ── JS002 ──────────────────────────────────────────────────────────────────
  {
    id: 'JS002',
    name: 'Network Request Inside Loop (N+1)',
    severity: 'critical',
    energyPoints: 35,
    description:
      'Calling fetch / axios / http.request inside a loop sends a separate HTTP ' +
      'request per iteration. This keeps the network radio active for far longer ' +
      'than a single batched request and is the #1 source of avoidable energy ' +
      'waste in web applications.',
    suggestion:
      'Collect all IDs / payloads and send one batched request using Promise.all() ' +
      'or a bulk API endpoint.',
    example: {
      bad:  "for (const id of ids) {\n  const res = await fetch(`/api/item/${id}`);\n}",
      good: "const res = await fetch('/api/items', {\n  method: 'POST',\n  body: JSON.stringify({ ids }),\n});",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      if (!/\bfetch\s*\(|axios\s*\.\s*(get|post|put|patch|delete)\s*\(|https?\.request\s*\(/.test(line)) return null;
      if (isInsideLoopJS(lines, lineIndex)) {
        return {
          match: line.trim().substring(0, 70),
          detail: 'HTTP request inside loop — N separate round-trips instead of 1 batched call',
        };
      }
      return null;
    },
  },

  // ── JS003 ──────────────────────────────────────────────────────────────────
  {
    id: 'JS003',
    name: 'Missing Debounce on High-Frequency DOM Events',
    severity: 'high',
    energyPoints: 18,
    description:
      'scroll, resize, mousemove, touchmove, keyup/down events can fire 60–300× ' +
      'per second. Attaching an un-debounced handler forces JS execution on every ' +
      'frame, blocking the browser from coalescing frames and entering idle.',
    suggestion:
      'Wrap handlers with debounce() / throttle() (Lodash or a 10-line custom ' +
      'implementation). For layout tracking prefer IntersectionObserver / ' +
      'ResizeObserver.',
    example: {
      bad:  "window.addEventListener('scroll', heavyLayoutCalc);",
      good: "window.addEventListener('scroll', debounce(heavyLayoutCalc, 100));",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      const evtMatch = line.match(/addEventListener\s*\(\s*['"](\w+)['"]/);
      if (!evtMatch) return null;
      const HIGH_FREQ = new Set(['scroll', 'resize', 'mousemove', 'touchmove',
        'keyup', 'keydown', 'keypress', 'pointermove', 'wheel']);
      if (!HIGH_FREQ.has(evtMatch[1])) return null;

      // Look ±3 lines for debounce / throttle / rAF (skip comment-only lines)
      const ctx = lines
        .slice(Math.max(0, lineIndex - 2), lineIndex + 4)
        .filter((l) => !/^\s*\/\//.test(l))
        .join('\n');
      if (/debounce|throttle|requestAnimationFrame|\brAF\b/.test(ctx)) return null;

      return {
        match: evtMatch[0],
        detail: `'${evtMatch[1]}' fires up to 300×/sec without debouncing/throttling`,
      };
    },
  },

  // ── JS004 ──────────────────────────────────────────────────────────────────
  {
    id: 'JS004',
    name: 'DOM Query Inside Loop',
    severity: 'high',
    energyPoints: 15,
    description:
      'querySelector / getElementById inside a loop forces the browser to ' +
      'traverse and re-calculate the DOM on every iteration, triggering repeated ' +
      'layout/reflow — one of the most energy-intensive browser operations.',
    suggestion:
      'Cache the DOM reference before the loop:\n' +
      '  const el = document.querySelector(".box");\n' +
      '  for (...) { el.doSomething(); }',
    example: {
      bad:  "for (const item of items) {\n  document.querySelector('.list').appendChild(item);\n}",
      good: "const list = document.querySelector('.list');\nfor (const item of items) { list.appendChild(item); }",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      if (!/querySelector(?:All)?|getElementById|getElementsBy(?:ClassName|TagName|Name)/.test(line)) return null;
      if (isInsideLoopJS(lines, lineIndex)) {
        return {
          match: line.trim().substring(0, 70),
          detail: 'DOM query in loop causes repeated layout recalculation per iteration',
        };
      }
      return null;
    },
  },

  // ── JS005 ──────────────────────────────────────────────────────────────────
  {
    id: 'JS005',
    name: 'Synchronous XMLHttpRequest',
    severity: 'high',
    energyPoints: 20,
    description:
      'Synchronous XHR (third argument = false) blocks the main thread for the ' +
      'entire network round-trip. The CPU cannot yield or sleep while waiting, ' +
      'burning energy and freezing the UI.',
    suggestion:
      'Use the Fetch API with async/await, which yields the thread during ' +
      'network I/O and allows the browser to enter idle states.',
    example: {
      bad:  "xhr.open('GET', url, false); // blocks thread",
      good: "const res = await fetch(url); // yields during wait",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      if (/\.open\s*\([^)]+,\s*false\s*\)/.test(line)) {
        return {
          match: line.trim().substring(0, 70),
          detail: 'Synchronous XHR blocks the main thread for the entire network wait',
        };
      }
      return null;
    },
  },

  // ── JS006 ──────────────────────────────────────────────────────────────────
  {
    id: 'JS006',
    name: 'Triple-Chained Array Iterations',
    severity: 'medium',
    energyPoints: 10,
    description:
      'Chaining 3 or more array methods (.filter().map().filter()) creates ' +
      'multiple intermediate arrays and iterates the data multiple times, ' +
      'multiplying memory allocations and CPU work.',
    suggestion:
      'Combine all transformations into a single .reduce() pass or a plain ' +
      'for loop that builds the output in one iteration.',
    example: {
      bad:  "const r = items.filter(x => x.ok).map(x => x.val).filter(v => v > 0);",
      good: "const r = items.reduce((a, x) => { if (x.ok && x.val > 0) a.push(x.val); return a; }, []);",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      const arrayMethods = '(?:map|filter|flatMap|forEach|find|findIndex|some|every|reduce)';
      const triple = new RegExp(
        `\\.${arrayMethods}\\s*\\([^)]*\\)\\s*\\.${arrayMethods}\\s*\\([^)]*\\)\\s*\\.${arrayMethods}`
      );
      if (triple.test(line)) {
        return {
          match: '3+ chained array iterations',
          detail: 'Three or more array iterations traverse the data multiple times',
        };
      }
      return null;
    },
  },

  // ── JS007 ──────────────────────────────────────────────────────────────────
  {
    id: 'JS007',
    name: 'eval() Disables JIT Optimisation',
    severity: 'medium',
    energyPoints: 12,
    description:
      'eval() forces the JavaScript engine to keep the entire enclosing scope ' +
      'in a de-optimised "slow path". The JIT compiler cannot inline, constant-fold, ' +
      'or eliminate dead code, so every call in that scope consumes more energy.',
    suggestion:
      'Replace with JSON.parse() for data parsing, the Function() constructor ' +
      'for truly dynamic code, or ideally refactor to static logic.',
    example: {
      bad:  "const result = eval('(' + jsonString + ')');",
      good: "const result = JSON.parse(jsonString);",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      // Skip commented lines
      if (/^\s*\/\//.test(line)) return null;
      if (/\beval\s*\(/.test(line)) {
        return {
          match: 'eval()',
          detail: 'eval() prevents JIT optimisation in the entire enclosing function scope',
        };
      }
      return null;
    },
  },

  // ── JS008 ──────────────────────────────────────────────────────────────────
  {
    id: 'JS008',
    name: 'JSON Serialisation Inside Loop',
    severity: 'medium',
    energyPoints: 12,
    description:
      'JSON.parse() and JSON.stringify() inside a loop perform expensive ' +
      'serialisation/deserialisation on every iteration. For deep-cloning, ' +
      'structuredClone() is faster; for shallow cloning, spread syntax is O(1).',
    suggestion:
      'Move JSON operations outside the loop, or use structuredClone() / ' +
      'spread syntax for copying objects.',
    example: {
      bad:  "for (const item of items) {\n  const copy = JSON.parse(JSON.stringify(item));\n}",
      good: "for (const item of items) {\n  const copy = structuredClone(item); // native deep clone\n}",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      if (!/JSON\.(parse|stringify)\s*\(/.test(line)) return null;
      if (isInsideLoopJS(lines, lineIndex)) {
        return {
          match: line.trim().substring(0, 70),
          detail: 'JSON serialisation per loop iteration — use structuredClone() instead',
        };
      }
      return null;
    },
  },

  // ── JS009 ──────────────────────────────────────────────────────────────────
  {
    id: 'JS009',
    name: 'console.log Inside Loop',
    severity: 'low',
    energyPoints: 5,
    description:
      'console.log inside a loop triggers synchronous I/O on every iteration. ' +
      'At scale (thousands of iterations) this causes measurable execution overhead ' +
      'and indicates debug code left in production.',
    suggestion:
      'Remove debug logging from production paths. If logging is required, ' +
      'collect messages and log once after the loop.',
    example: {
      bad:  "for (const item of items) { console.log('Processing', item); work(item); }",
      good: "for (const item of items) { work(item); } // remove debug log",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      if (!/console\.(log|warn|error|info|debug|trace)\s*\(/.test(line)) return null;
      if (isInsideLoopJS(lines, lineIndex)) {
        return {
          match: 'console.log() in loop',
          detail: 'I/O operation on every loop iteration — remove or collect-then-log',
        };
      }
      return null;
    },
  },

  // ── JS010 ──────────────────────────────────────────────────────────────────
  {
    id: 'JS010',
    name: 'document.write() Causes Full Re-render',
    severity: 'medium',
    energyPoints: 10,
    description:
      'document.write() called after page load destroys the current DOM and ' +
      'forces the browser to re-parse, re-layout, and re-paint the entire page — ' +
      'wasting significant GPU/CPU energy.',
    suggestion:
      'Use DOM APIs (createElement, appendChild, innerHTML, insertAdjacentHTML) ' +
      'to modify only the relevant part of the page.',
    example: {
      bad:  "document.write('<div>' + content + '</div>');",
      good: "const div = document.createElement('div');\ndiv.textContent = content;\ndocument.body.appendChild(div);",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      if (/^\s*\/\//.test(line)) return null;
      if (/\bdocument\.write\s*\(/.test(line)) {
        return {
          match: 'document.write()',
          detail: 'Causes full DOM destruction and re-render after page load',
        };
      }
      return null;
    },
  },

  // ── JS011 ──────────────────────────────────────────────────────────────────
  {
    id: 'JS011',
    name: 'Inefficient setTimeout Recursion (Tight Loop)',
    severity: 'high',
    energyPoints: 16,
    description:
      'Calling setTimeout(fn, 0) or setTimeout(fn, <50ms) recursively creates a ' +
      'tight asynchronous loop that fires as fast as the event loop allows, ' +
      'saturating the CPU similarly to a synchronous busy-wait.',
    suggestion:
      'Use requestAnimationFrame() for rendering work, or increase the delay. ' +
      'For background work consider requestIdleCallback() or Web Workers.',
    example: {
      bad:  "function tick() { update(); setTimeout(tick, 0); }\ntick();",
      good: "function tick() { update(); requestAnimationFrame(tick); }\nrequestAnimationFrame(tick);",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      const m = line.match(/setTimeout\s*\([^,)]+,\s*(\d+)\s*\)/);
      if (!m) return null;
      const ms = parseInt(m[1], 10);
      if (ms > 50) return null;

      // Only flag if there's a recursive-looking pattern nearby (same function called)
      const ctx = lines.slice(Math.max(0, lineIndex - 15), lineIndex + 2).join('\n');
      const funcNames = ctx.match(/function\s+(\w+)/g) || [];
      const hasSelfCall = funcNames.some((fn) => {
        const name = fn.replace('function ', '');
        return new RegExp(`setTimeout\\s*\\(\\s*${name}`).test(line);
      });
      if (!hasSelfCall && ms > 0) return null;

      return {
        match: m[0],
        detail: `setTimeout(fn, ${ms}ms) in a recursive pattern creates a near-busy-wait loop`,
      };
    },
  },

  // ── JS012 ──────────────────────────────────────────────────────────────────
  {
    id: 'JS012',
    name: 'Unremoved Event Listener (Memory / Energy Leak)',
    severity: 'medium',
    energyPoints: 10,
    description:
      'Event listeners that are never removed keep their callback and all closure ' +
      'variables alive. In long-running SPAs this causes memory leaks and prevents ' +
      'garbage collection, increasing memory pressure and GC energy cost.',
    suggestion:
      'Always call removeEventListener when the component / element is destroyed, ' +
      'or use AbortController to cancel multiple listeners at once.',
    example: {
      bad:  "useEffect(() => {\n  window.addEventListener('resize', handleResize);\n}, []); // no cleanup!",
      good: "useEffect(() => {\n  window.addEventListener('resize', handleResize);\n  return () => window.removeEventListener('resize', handleResize);\n}, []);",
    },
    detect(lines, lineIndex) {
      const line = lines[lineIndex];
      if (!/addEventListener\s*\(/.test(line)) return null;

      // Look at a window of 20 following lines for matching removeEventListener
      const futureCtx = lines.slice(lineIndex, Math.min(lines.length, lineIndex + 20)).join('\n');
      if (/removeEventListener|AbortController|abort\(\)/.test(futureCtx)) return null;

      // Look back for React-style cleanup patterns
      const prevCtx = lines.slice(Math.max(0, lineIndex - 5), lineIndex).join('\n');
      if (/useEffect|componentDidMount/.test(prevCtx) &&
          !/removeEventListener|return\s*\(\s*\)\s*=>/.test(
            lines.slice(lineIndex, Math.min(lines.length, lineIndex + 30)).join('\n')
          )) {
        return {
          match: line.trim().substring(0, 70),
          detail: 'addEventListener in useEffect/lifecycle without cleanup — potential memory leak',
        };
      }
      return null;
    },
  },
];

module.exports = { JS_PATTERNS };
