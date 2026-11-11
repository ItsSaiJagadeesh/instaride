/* InstaRide trip tracking page. GPL-3.0-or-later.
 * Shows one shared trip. All text is inserted with textContent, never innerHTML. */
(() => {
  'use strict';
  const app = document.getElementById('app');
  const token = location.pathname.split('/').filter(Boolean).pop() || '';
  const STATUS = {
    requested: 'Looking for a driver',
    accepted: 'Driver is on the way to the pickup',
    arriving: 'Driver is on the way to the pickup',
    arrived: 'Driver has reached the pickup point',
    in_progress: 'Trip in progress',
    completed: 'Trip completed',
    cancelled: 'Trip cancelled',
  };
  let timer = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function showMessage(msg) {
    app.replaceChildren(el('h1', '', 'Track a trip'), el('div', 'card', msg));
  }

  function render(t) {
    const done = t.status === 'completed' || t.status === 'cancelled';
    const parts = [];
    parts.push(el('h1', '', (t.riderFirstName ? t.riderFirstName + '’s trip' : 'Shared trip')));
    const card = el('div', 'card');
    card.append(el('div', 'status' + (t.status === 'cancelled' ? ' bad' : ''), STATUS[t.status] || t.status));
    parts.push(card);

    if (t.sos) parts.push(el('div', 'card alert', 'An emergency alert was raised on this trip. If you are worried, call 112.'));

    if (t.driver) {
      const c = el('div', 'card');
      c.append(el('div', '', 'Driver: ' + (t.driver.firstName || '')));
      if (t.driver.vehicle) {
        const v = el('div', '');
        v.append(document.createTextNode(t.driver.vehicle.type + ' · '), el('span', 'plate', t.driver.vehicle.number));
        c.append(v);
      }
      if (t.driver.location && !done) {
        const a = el('a', 'btn', 'See driver on a map');
        a.href = 'https://www.openstreetmap.org/?mlat=' + encodeURIComponent(t.driver.location.lat) +
          '&mlon=' + encodeURIComponent(t.driver.location.lng) + '#map=17/' +
          encodeURIComponent(t.driver.location.lat) + '/' + encodeURIComponent(t.driver.location.lng);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        c.append(a);
      }
      parts.push(c);
    }

    const route = el('div', 'card');
    const r1 = el('div', 'row'); r1.append(el('span', 'dot p'), el('div', '', t.pickup.address));
    const r2 = el('div', 'row'); r2.append(el('span', 'dot d'), el('div', '', t.dropoff.address));
    route.append(r1, r2);
    parts.push(route);

    parts.push(el('div', 'muted', done ? 'This trip has ended.' : 'Updates every few seconds. Last update ' +
      new Date(t.serverTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })));
    app.replaceChildren(...parts);
    if (done && timer) { clearInterval(timer); timer = null; }
  }

  async function load() {
    try {
      const res = await fetch('/api/track/' + encodeURIComponent(token), { cache: 'no-store' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (timer) { clearInterval(timer); timer = null; }
        return showMessage(body.message || 'This trip link is not available.');
      }
      render(body);
    } catch (e) { /* keep the last picture and try again */ }
  }

  load();
  timer = setInterval(load, 5000);
})();
