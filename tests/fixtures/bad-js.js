// ============================================================
// bad-js.js — Sample file containing JS energy anti-patterns
// Used by the test suite to verify detection accuracy.
// ============================================================

// JS001 — Frequent polling (interval < 1000ms)
setInterval(function checkUpdates() {
  fetch('/api/status').then(r => r.json()).then(console.log);
}, 200);

// JS002 — Network request inside loop
async function loadAllUsers(ids) {
  const results = [];
  for (const id of ids) {
    const res = await fetch(`/api/users/${id}`);   // N separate requests!
    results.push(await res.json());
  }
  return results;
}

// JS003 — Missing debounce on scroll
window.addEventListener('scroll', function handleScroll() {
  const pos = document.querySelector('.sidebar').getBoundingClientRect();
  updateLayout(pos);
});

// JS004 — DOM query inside loop
function renderItems(items) {
  for (let i = 0; i < items.length; i++) {
    const container = document.querySelector('#list');   // queried every iteration
    const li = document.createElement('li');
    li.textContent = items[i];
    container.appendChild(li);
  }
}

// JS005 — Synchronous XHR
function getDataSync(url) {
  const xhr = new XMLHttpRequest();
  xhr.open('GET', url, false);  // synchronous!
  xhr.send();
  return xhr.responseText;
}

// JS006 — Triple-chained array iterations
const activeHighValues = data
  .filter(x => x.active)
  .map(x => x.value)
  .filter(v => v > 100);

// JS007 — eval()
function dynamicCalc(expr) {
  return eval('(' + expr + ')');
}

// JS008 — JSON in loop
function cloneAll(items) {
  const copies = [];
  for (const item of items) {
    copies.push(JSON.parse(JSON.stringify(item)));  // expensive clone per item
  }
  return copies;
}

// JS009 — console.log in loop
function processOrders(orders) {
  for (const order of orders) {
    console.log('Processing order', order.id);
    processOrder(order);
  }
}

// JS010 — document.write
function injectBanner(html) {
  document.write('<div class="banner">' + html + '</div>');
}
