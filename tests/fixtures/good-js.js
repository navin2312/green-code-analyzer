// ============================================================
// good-js.js — Correct patterns (should produce zero findings)
// ============================================================

// ✅ Event-driven instead of polling
const ws = new WebSocket('wss://api.example.com/updates');
ws.onmessage = (event) => handleUpdate(JSON.parse(event.data));

// ✅ Batched network request
async function loadAllUsers(ids) {
  const res = await fetch('/api/users/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return res.json();
}

// ✅ Debounced scroll handler
function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}
window.addEventListener('scroll', debounce(handleScroll, 100));

// ✅ DOM query cached before loop
function renderItems(items) {
  const container = document.querySelector('#list');
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item;
    container.appendChild(li);
  }
}

// ✅ Async fetch
async function getDataAsync(url) {
  const res = await fetch(url);
  return res.text();
}

// ✅ Single-pass reduce instead of chained array iterations
const activeHighValues = data.reduce((acc, x) => {
  if (x.active && x.value > 100) acc.push(x.value);
  return acc;
}, []);

// ✅ JSON.parse outside the loop
const template = JSON.parse(JSON.stringify(baseTemplate));
function cloneAll(items) {
  return items.map((item) => structuredClone(item));
}
