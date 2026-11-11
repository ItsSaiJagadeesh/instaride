/* InstaRide Super Admin console. GPL-3.0-or-later.
 * Plain JavaScript, no build step. All dynamic text is added with textContent / createTextNode
 * (never innerHTML), so names and addresses typed by users cannot inject code. */
(() => {
  'use strict';

  const VEHICLES = { bike: 'Bike', auto: 'Auto', erickshaw: 'E-rickshaw', car: 'Car' };
  const VTYPES = Object.keys(VEHICLES);
  const DOCS = [
    ['vehicle_front', 'Vehicle front'], ['vehicle_back', 'Vehicle back'],
    ['vehicle_left', 'Vehicle left'], ['vehicle_right', 'Vehicle right'],
    ['plate', 'Number plate'], ['rc', 'RC'], ['licence', 'Driving licence'],
    ['insurance', 'Insurance'], ['selfie', 'Selfie with vehicle number'],
  ];
  const VAHAN_URL = 'https://vahan.parivahan.gov.in/nrservices/';
  const VERIFY_LABEL = { not_submitted: 'Not submitted', pending: 'Waiting for review', needs_fix: 'Needs new photos', approved: 'Approved', rejected: 'Rejected' };
  const VERIFY_CLASS = { not_submitted: '', pending: 'warn', needs_fix: 'warn', approved: 'good', rejected: 'bad' };
  const ACTIVE = ['requested', 'accepted', 'arriving', 'arrived', 'in_progress'];

  let token = sessionStorage.getItem('ir_token');
  let me = null;
  let current = 'overview';
  let objectUrls = [];
  let badgeTimer = null;
  const root = document.getElementById('app');

  // ---------------------------------------------------------------- helpers
  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'style') n.style.cssText = v; // CSSOM: allowed by the strict CSP, unlike a style attribute
      else if (k === 'value') n.value = v;
      else if (k === 'checked') n.checked = !!v;
      else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
      if (kid === null || kid === undefined || kid === false) continue;
      n.append(kid && kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }
  const fmtINR = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso.length === 10 ? iso + 'T00:00:00+05:30' : iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
  }
  function fmtDateTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'short' });
  }
  function parseIndianDate(s) {
    const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(String(s).trim());
    if (!m) return null;
    const dd = +m[1], mm = +m[2], yy = +m[3];
    const dt = new Date(Date.UTC(yy, mm - 1, dd));
    if (dt.getUTCFullYear() !== yy || dt.getUTCMonth() !== mm - 1 || dt.getUTCDate() !== dd) return null;
    return yy + '-' + String(mm).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
  }
  function toast(msg, isErr) {
    const t = el('div', { class: 'toast' + (isErr ? ' err' : ''), role: 'status' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), isErr ? 6000 : 2500);
  }
  function pill(text, cls) { return el('span', { class: 'pill ' + (cls || '') }, text); }

  async function api(method, path, body) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 401 && token) {
      logout();
      throw new Error('Please log in again');
    }
    let data = null;
    try { data = await res.json(); } catch (e) { /* no body */ }
    if (!res.ok) throw new Error((data && data.message) || 'Request failed (' + res.status + ')');
    return data;
  }

  function clearObjectUrls() {
    objectUrls.forEach((u) => URL.revokeObjectURL(u));
    objectUrls = [];
  }

  // ------------------------------------------------------------------ login
  function logout() {
    token = null; me = null;
    sessionStorage.removeItem('ir_token');
    if (badgeTimer) { clearInterval(badgeTimer); badgeTimer = null; }
    clearObjectUrls();
    renderLogin();
  }

  function renderLogin(message) {
    root.replaceChildren();
    const err = el('p', { class: 'error', role: 'alert' }, message || '');
    const phone = el('input', { type: 'tel', autocomplete: 'username', inputmode: 'numeric', required: true, maxlength: '14' });
    const pass = el('input', { type: 'password', autocomplete: 'current-password', required: true });
    const btn = el('button', { class: 'btn primary', type: 'submit', style: 'width:100%;margin-top:16px' }, 'Sign in');
    const form = el('form', { class: 'card login', onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true; err.textContent = '';
      try {
        const out = await api('POST', '/api/auth/login', { phone: phone.value.trim(), password: pass.value });
        if (!out.user || out.user.role !== 'admin') throw new Error('This account is not a Super Admin');
        token = out.token; me = out.user;
        sessionStorage.setItem('ir_token', token);
        renderShell();
      } catch (ex) {
        err.textContent = ex.message;
      } finally {
        btn.disabled = false;
      }
    } },
      el('h1', {}, 'InstaRide Super Admin'),
      el('p', { class: 'muted small' }, 'Sign in with your admin mobile number.'),
      el('label', { class: 'field' }, 'Mobile number', phone),
      el('label', { class: 'field' }, 'Password', pass),
      err, btn);
    root.append(el('div', { class: 'center' }, form));
    phone.focus();
  }

  // ------------------------------------------------------------------ shell
  const NAV = [
    ['overview', 'Overview'], ['golive', 'Go-live meter'], ['verify', 'Verification'], ['rides', 'Rides'],
    ['users', 'People'], ['settings', 'Settings'], ['audit', 'Audit log'],
  ];

  function renderShell() {
    root.replaceChildren();
    const nav = NAV.map(([key, label]) => {
      const b = el('button', { class: 'nav', 'data-view': key, onclick: () => go(key) },
        el('span', {}, label),
        key === 'verify' ? el('span', { class: 'badge', id: 'vbadge', hidden: true }, '0') : null,
        key === 'overview' ? el('span', { class: 'badge', id: 'sbadge', hidden: true, title: 'Open SOS alerts' }, '0') : null,
        key === 'golive' ? el('span', { class: 'badge', id: 'mbadge', hidden: true, title: 'Checks that need fixing before going live' }, '0') : null);
      return b;
    });
    const side = el('nav', { class: 'side' },
      el('div', { class: 'brand' }, 'Insta', el('span', {}, 'Ride')), nav,
      el('div', { class: 'spacer' }),
      el('div', { class: 'small muted', style: 'padding:0 12px 8px' }, me ? me.fullName : ''),
      el('button', { class: 'nav', onclick: logout }, 'Sign out'));
    root.append(el('div', { class: 'shell' }, side, el('main', { class: 'main', id: 'main' })));
    updateBadge();
    api('GET', '/api/admin/readiness').then((m) => setMeterBadge(m.summary)).catch(() => {});
    badgeTimer = setInterval(updateBadge, 10000);
    go('overview');
  }

  function setBadges(s) {
    const b = document.getElementById('vbadge');
    if (b) { b.textContent = String(s.pendingVerifications); b.hidden = s.pendingVerifications === 0; }
    const sb = document.getElementById('sbadge');
    if (sb) { sb.textContent = 'SOS ' + s.sosOpen; sb.hidden = !s.sosOpen; }
  }

  async function updateBadge() {
    try { setBadges(await api('GET', '/api/admin/stats')); } catch (e) { /* ignore */ }
  }

  function setMeterBadge(summary) {
    const mb = document.getElementById('mbadge');
    if (mb) { mb.textContent = String(summary.fail); mb.hidden = !summary.fail; }
  }

  function go(view) {
    current = view;
    clearObjectUrls();
    document.querySelectorAll('.nav[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    const loaders = { overview: viewOverview, golive: viewGolive, verify: viewVerify, rides: viewRides, users: viewUsers, settings: viewSettings, audit: viewAudit };
    const main = document.getElementById('main');
    main.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
    loaders[view]().catch((e) => {
      main.replaceChildren(el('p', { class: 'error' }, e.message), el('button', { class: 'btn', onclick: () => go(view) }, 'Try again'));
    });
  }

  function page(title, subtitle, ...content) {
    const main = document.getElementById('main');
    main.replaceChildren(
      el('div', { class: 'topline' },
        el('div', {}, el('h1', {}, title), subtitle ? el('div', { class: 'muted small' }, subtitle) : null),
        el('button', { class: 'btn small', onclick: () => go(current) }, 'Refresh')),
      ...content);
    return main;
  }

  // --------------------------------------------------------------- overview
  async function viewOverview() {
    const [s, c, sosList] = await Promise.all([api('GET', '/api/admin/stats'), api('GET', '/api/admin/config'), api('GET', '/api/admin/sos')]);
    setBadges(s);
    const stat = (v, l, cls) => el('div', { class: 'stat ' + (cls || '') }, el('div', { class: 'v' }, v), el('div', { class: 'l' }, l));
    const mapLink = (lat, lng, text) => el('a', { href: 'https://www.openstreetmap.org/?mlat=' + encodeURIComponent(lat) + '&mlon=' + encodeURIComponent(lng) + '#map=17/' + encodeURIComponent(lat) + '/' + encodeURIComponent(lng), target: '_blank', rel: 'noopener noreferrer' }, text);
    const sosCard = (x) => {
      const open = !x.sos.ackAt;
      const where = x.sos.lat !== undefined && x.sos.lng !== undefined ? mapLink(x.sos.lat, x.sos.lng, 'Open the alert location on a map') : null;
      const live = x.driver && x.driver.location ? mapLink(x.driver.location.lat, x.driver.location.lng, 'Driver’s latest position') : null;
      return el('div', { class: 'card sosalert', style: open ? 'border-color:var(--bad);margin-bottom:12px' : 'margin-bottom:12px', 'data-ride': x.rideId },
        el('div', { class: 'row' },
          el('strong', { style: open ? 'color:var(--bad)' : '' }, (open ? 'SOS: ' : 'SOS (handled): ') + 'raised by the ' + x.sos.raisedBy + ' at ' + fmtDateTime(x.sos.at)),
          open ? el('button', { class: 'btn small danger', onclick: async () => {
            try { await api('POST', '/api/admin/sos/' + x.rideId + '/ack'); toast('Marked as handled'); updateBadge(); go('overview'); } catch (e) { toast(e.message, true); }
          } }, 'I have handled this') : null),
        el('div', {}, 'Rider: ' + (x.rider ? x.rider.name + ' · ' + x.rider.phone : 'unknown') +
          (x.rider && x.rider.emergencyContact ? ' · emergency contact ' + x.rider.emergencyContact.name + ' ' + x.rider.emergencyContact.phone : '')),
        el('div', {}, 'Driver: ' + (x.driver ? x.driver.name + ' · ' + x.driver.phone + (x.driver.vehicle ? ' · ' + x.driver.vehicle.number : '') : 'none yet')),
        el('div', { class: 'small muted' }, x.pickup.address + ' → ' + x.dropoff.address + ' · trip is ' + x.status.replace('_', ' ')),
        el('div', { class: 'small' }, where, where && live ? ' · ' : null, live),
        open ? el('div', { class: 'small muted' }, 'Call the rider and the driver now. If anyone is in danger, call 112.') : null);
    };
    page('Overview', 'Updated ' + fmtDateTime(new Date().toISOString()),
      sosList.length ? el('div', {}, el('h2', { style: 'margin-top:8px' }, 'SOS alerts'), sosList.map(sosCard)) : null,
      el('div', { class: 'grid' },
        stat(fmtINR(s.platformFeesEarned), 'Platform fees earned (flat ' + fmtINR(c.platformFeePerRide) + ' per completed ride)', 'hero'),
        stat(fmtINR(s.platformFeesCollected), 'Collected'),
        stat(fmtINR(s.feesDueTotal), 'Still due from drivers'),
        stat(fmtINR(s.totalFares), 'Total fares (paid to drivers in cash)'),
        stat(fmtINR(s.totalDriverEarnings), 'Driver earnings after fee')),
      el('h2', {}, 'People and rides'),
      el('div', { class: 'grid' },
        stat(String(s.pendingVerifications), 'Drivers waiting for review'),
        stat(String(s.totalDrivers), 'InstaDrivers'), stat(String(s.onlineDrivers), 'Online now'),
        stat(String(s.totalRiders), 'InstaRiders'), stat(String(s.activeRides), 'Active rides'),
        stat(String(s.completedRides), 'Completed rides'), stat(String(s.cancelledRides), 'Cancelled rides'),
        stat(String(s.suspendedUsers), 'Suspended accounts')));
  }

  // ------------------------------------------------------------ go-live meter
  async function viewGolive() {
    const m = await api('GET', '/api/admin/readiness');
    setMeterBadge(m.summary);
    const total = m.checks.length;
    const okCount = m.summary.ok;
    const label = { ok: 'Done', warn: 'Check', fail: 'Fix now', manual: 'Your turn' };
    const groups = [];
    m.checks.forEach((c) => { if (!groups.includes(c.group)) groups.push(c.group); });

    const row = (c) => {
      const left = c.done !== undefined
        ? el('input', { type: 'checkbox', class: 'meter-check', checked: !!c.done, 'aria-label': 'Mark done: ' + c.title, onchange: async (e) => {
            e.target.disabled = true;
            try { await api('PUT', '/api/admin/readiness/manual/' + c.id, { done: e.target.checked }); go('golive'); }
            catch (ex) { toast(ex.message, true); e.target.checked = !e.target.checked; e.target.disabled = false; }
          } })
        : el('span', { class: 'dot ' + c.status, title: label[c.status] });
      return el('div', { class: 'meter-row', 'data-check': c.id, 'data-status': c.status },
        left,
        el('div', { class: 'meter-text' },
          el('div', { class: 'meter-title' }, c.title, ' ', el('span', { class: 'pill ' + (c.status === 'ok' ? 'good' : c.status === 'fail' ? 'bad' : c.status === 'warn' ? 'warn' : '') }, label[c.status])),
          el('div', { class: 'small muted' }, c.detail),
          c.status !== 'ok' && c.fix ? el('div', { class: 'small meter-fix' }, 'What to do: ' + c.fix) : null));
    };

    const pct = Math.round((okCount / total) * 100);
    page('Go-live meter', 'Checked just now. Anything red must be fixed before real riders and drivers use the app.',
      el('div', { class: 'card' },
        el('div', { class: 'row', style: 'border:0;padding:0' },
          el('div', {}, el('div', { class: 'meter-big' }, okCount + ' of ' + total + ' done'),
            el('div', { class: 'small muted' }, m.summary.fail + ' to fix now · ' + m.summary.warn + ' to check · ' + m.summary.manual + ' waiting for you')),
          el('div', { class: 'meter-pct' }, pct + '%')),
        el('div', { class: 'meter-bar' }, el('div', { class: 'meter-fill', style: 'width:' + pct + '%' }))),
      ...groups.map((g) => el('div', {},
        el('h2', {}, g),
        el('div', { class: 'card', style: 'padding:6px 16px' }, m.checks.filter((c) => c.group === g).map(row)))));
  }

  // ----------------------------------------------------------- verification
  async function viewVerify() {
    const list = await api('GET', '/api/admin/verifications?status=pending');
    const body = list.length === 0
      ? el('div', { class: 'card muted' }, 'No applications waiting.')
      : el('div', { class: 'tablewrap' }, el('table', {},
        el('thead', {}, el('tr', {}, ['Driver', 'Mobile', 'Vehicle', 'Submitted', ''].map((h) => el('th', {}, h)))),
        el('tbody', {}, list.map((d) => el('tr', {},
          el('td', {}, d.fullName), el('td', {}, d.phone),
          el('td', {}, d.vehicle ? VEHICLES[d.vehicle.type] + ' · ' + d.vehicle.number : ''),
          el('td', {}, fmtDateTime(d.verification && d.verification.submittedAt)),
          el('td', {}, el('button', { class: 'btn small primary', onclick: () => reviewDriver(d) }, 'Review')))))));
    page('Driver verification', list.length + ' waiting', body);
  }

  async function loadImage(img, userId, kind) {
    try {
      const res = await fetch('/api/admin/documents/' + userId + '/' + kind, { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) throw new Error('x');
      const url = URL.createObjectURL(await res.blob());
      objectUrls.push(url);
      img.src = url;
      img.addEventListener('click', () => {
        const lb = el('div', { class: 'lightbox', onclick: () => lb.remove() }, el('img', { src: url, alt: kind }));
        document.body.append(lb);
      });
    } catch (e) {
      img.replaceWith(el('div', { class: 'error' }, 'Could not load photo'));
    }
  }

  function reviewDriver(d) {
    const fix = new Set();
    const ins = el('input', { class: 'input', placeholder: 'DD/MM/YYYY', inputmode: 'numeric' });
    const fit = el('input', { class: 'input', placeholder: 'DD/MM/YYYY', inputmode: 'numeric' });
    const vahan = el('input', { type: 'checkbox', id: 'vahan' });
    const reason = el('textarea', { class: 'input', rows: '2', placeholder: 'Reason shown to the driver, e.g. "plate is not readable" or "white number plate"' });
    const buttons = [];
    const send = async (body, doneMsg) => {
      buttons.forEach((b) => (b.disabled = true));
      try {
        await api('POST', '/api/admin/drivers/' + d.id + '/verify', body);
        toast(doneMsg);
        updateBadge();
        go('verify');
      } catch (e) {
        toast(e.message, true);
        buttons.forEach((b) => (b.disabled = false));
      }
    };
    const approve = el('button', { class: 'btn primary', onclick: () => {
      const i = parseIndianDate(ins.value), f = parseIndianDate(fit.value);
      if (!vahan.checked) return toast('Check the vehicle on VAHAN, then tick the box', true);
      if (!i || !f) return toast('Enter both expiry dates as DD/MM/YYYY', true);
      send({ decision: 'approve', vahanChecked: true, insuranceExpiry: i, fitnessExpiry: f }, 'Driver approved');
    } }, 'Approve driver');
    const ask = el('button', { class: 'btn warn', onclick: () => {
      if (fix.size === 0) return toast('Pick the photos to take again', true);
      if (reason.value.trim().length < 3) return toast('Add a reason for the driver', true);
      send({ decision: 'needs_fix', kinds: [...fix], reason: reason.value.trim() }, 'Asked the driver to re-upload');
    } }, 'Ask to re-upload');
    const reject = el('button', { class: 'btn danger', onclick: () => {
      if (reason.value.trim().length < 3) return toast('Add a reason for the driver', true);
      if (!confirm('Reject this application? The driver will see your reason.')) return;
      send({ decision: 'reject', reason: reason.value.trim() }, 'Application rejected');
    } }, 'Reject');
    buttons.push(approve, ask, reject);

    const docEls = DOCS.map(([k, label]) => {
      const img = el('img', { alt: label });
      loadImage(img, d.id, k);
      return el('div', { class: 'doc', 'data-kind': k }, el('div', { class: 't' }, label), img);
    });
    const chips = DOCS.map(([k, label]) => {
      const c = el('button', { class: 'chip', type: 'button', onclick: () => {
        if (fix.has(k)) fix.delete(k); else fix.add(k);
        c.classList.toggle('on', fix.has(k));
      } }, label);
      return c;
    });

    page(d.fullName, (d.vehicle ? VEHICLES[d.vehicle.type] + ' · ' + d.vehicle.number + ' · ' : '') + d.phone,
      el('p', {}, el('button', { class: 'btn small', onclick: () => go('verify') }, '← Back to list')),
      el('div', { class: 'two' },
        el('div', {}, el('div', { class: 'docs' }, docEls)),
        el('div', {},
          el('div', { class: 'card' },
            el('h2', { style: 'margin-top:0' }, 'Check before approving'),
            el('ul', { class: 'checklist' },
              el('li', {}, 'Plate is yellow, readable, and matches the RC'),
              el('li', {}, 'Same vehicle in all four side photos'),
              el('li', {}, 'RC owner name matches the licence (or the owner has given permission)'),
              el('li', {}, 'Selfie face matches the licence photo'),
              el('li', {}, 'On VAHAN: a transport class, insurance and fitness valid')),
            el('p', {}, el('a', { href: VAHAN_URL, target: '_blank', rel: 'noopener noreferrer' }, 'Open VAHAN to look up ' + (d.vehicle ? d.vehicle.number : ''))),
            el('label', { class: 'row', for: 'vahan' }, el('span', {}, 'I checked this vehicle on VAHAN'), vahan),
            el('label', { class: 'field' }, 'Insurance valid till', ins),
            el('label', { class: 'field' }, 'Fitness valid till', fit),
            el('p', {}, approve)),
          el('div', { class: 'card', style: 'margin-top:14px' },
            el('h2', { style: 'margin-top:0' }, 'Or ask for new photos / reject'),
            el('div', { class: 'chips' }, chips), reason,
            el('p', {}, ask, ' ', reject)))));
  }

  // ------------------------------------------------------------------ rides
  async function viewRides() {
    const rides = await api('GET', '/api/admin/rides');
    const filter = el('select', { class: 'input' },
      ['all', 'active', 'completed', 'cancelled'].map((o) => el('option', { value: o }, o === 'all' ? 'All rides' : o[0].toUpperCase() + o.slice(1))));
    const tbody = el('tbody');
    const draw = () => {
      const f = filter.value;
      const shown = rides.filter((r) => f === 'all' || (f === 'active' ? ACTIVE.includes(r.status) : r.status === f)).slice(0, 200);
      tbody.replaceChildren(...(shown.length ? shown.map(rideRow) : [el('tr', {}, el('td', { colspan: '7', class: 'muted' }, 'No rides'))]));
    };
    const rideRow = (r) => el('tr', {},
      el('td', {}, fmtDateTime(r.createdAt)),
      el('td', {}, pill(r.status.replace('_', ' '), r.status === 'completed' ? 'good' : r.status === 'cancelled' ? 'bad' : 'blue'), r.sos ? [' ', pill('SOS', 'bad')] : null),
      el('td', {}, VEHICLES[r.vehicleType] || r.vehicleType),
      el('td', {}, (r.riderName || '?') + (r.driverName ? ' → ' + r.driverName : '')),
      el('td', {}, r.pickup.address + ' → ' + r.dropoff.address),
      el('td', {}, r.fare ? fmtINR(r.fare.totalFare) : ''),
      el('td', {}, ACTIVE.includes(r.status) ? el('button', { class: 'btn small danger', onclick: async () => {
        if (!confirm('Cancel this ride?')) return;
        try { await api('PUT', '/api/admin/rides/' + r.id + '/cancel'); toast('Ride cancelled'); go('rides'); } catch (e) { toast(e.message, true); }
      } }, 'Cancel') : (r.review ? '★ ' + r.review.rating : '')));
    filter.addEventListener('change', draw);
    page('Rides', rides.length + ' in total',
      el('div', { class: 'toolbar' }, filter),
      el('div', { class: 'tablewrap' }, el('table', {},
        el('thead', {}, el('tr', {}, ['When', 'Status', 'Type', 'Rider → Driver', 'Route', 'Fare', ''].map((h) => el('th', {}, h)))), tbody)));
    draw();
  }

  // ------------------------------------------------------------------ users
  async function viewUsers() {
    const users = await api('GET', '/api/admin/users');
    const role = el('select', { class: 'input' }, [['all', 'Everyone'], ['driver', 'InstaDrivers'], ['rider', 'InstaRiders']].map(([v, l]) => el('option', { value: v }, l)));
    const q = el('input', { class: 'input', placeholder: 'Search name, mobile, vehicle number', style: 'min-width:260px' });
    const tbody = el('tbody');
    const act = async (fn, msg) => { try { await fn(); toast(msg); go('users'); } catch (e) { toast(e.message, true); } };
    const row = (u) => {
      const due = u.feesDue || 0;
      const vs = u.verification ? u.verification.status : null;
      return el('tr', {},
        el('td', {}, u.fullName, u.suspended ? [' ', pill('Suspended', 'bad')] : null),
        el('td', {}, u.phone),
        el('td', {}, u.role === 'driver' ? 'InstaDriver' : 'InstaRider', u.isOnline && !u.suspended ? [' ', pill('Online', 'good')] : null),
        el('td', {}, u.vehicle ? VEHICLES[u.vehicle.type] + ' · ' + u.vehicle.number : ''),
        el('td', {}, vs ? pill(VERIFY_LABEL[vs], VERIFY_CLASS[vs]) : '',
          vs === 'approved' && u.verification.insuranceExpiry ? el('div', { class: 'small muted' }, 'Insurance ' + fmtDate(u.verification.insuranceExpiry) + ' · Fitness ' + fmtDate(u.verification.fitnessExpiry)) : null),
        el('td', {}, u.role === 'driver' ? (u.rating || 5).toFixed(1) + ' ★ · ' + (u.totalRides || 0) + ' rides' : ''),
        el('td', {}, u.role === 'driver' ? fmtINR(due) : ''),
        el('td', {},
          u.role === 'driver' && due > 0 ? el('button', { class: 'btn small', onclick: () => {
            if (confirm('Mark ' + fmtINR(due) + ' as paid by ' + u.fullName + '? Only do this after you have received the money.'))
              act(() => api('POST', '/api/admin/drivers/' + u.id + '/settle', { amount: due }), 'Payment recorded');
          } }, 'Mark paid') : null, ' ',
          el('button', { class: 'btn small warn', onclick: () => act(() => api('PUT', '/api/admin/users/' + u.id + '/suspend'), u.suspended ? 'Account restored' : 'Account suspended') }, u.suspended ? 'Restore' : 'Suspend'), ' ',
          el('button', { class: 'btn small danger', onclick: () => {
            if (confirm('Remove ' + u.fullName + ' permanently? Their documents are deleted too.'))
              act(() => api('DELETE', '/api/admin/users/' + u.id), 'User removed');
          } }, 'Remove')));
    };
    const draw = () => {
      const needle = q.value.trim().toLowerCase();
      const shown = users.filter((u) => (role.value === 'all' || u.role === role.value) &&
        (!needle || [u.fullName, u.phone, u.vehicle && u.vehicle.number].some((x) => x && String(x).toLowerCase().includes(needle))));
      tbody.replaceChildren(...(shown.length ? shown.map(row) : [el('tr', {}, el('td', { colspan: '8', class: 'muted' }, 'Nobody found'))]));
    };
    role.addEventListener('change', draw);
    q.addEventListener('input', draw);
    page('People', users.length + ' accounts',
      el('div', { class: 'toolbar' }, role, q),
      el('div', { class: 'tablewrap' }, el('table', {},
        el('thead', {}, el('tr', {}, ['Name', 'Mobile', 'Role', 'Vehicle', 'Verification', 'Rating', 'Fees due', ''].map((h) => el('th', {}, h)))), tbody)));
    draw();
  }

  // --------------------------------------------------------------- settings
  async function viewSettings() {
    const c = await api('GET', '/api/admin/config');
    const inp = (v) => el('input', { class: 'input num', value: String(v), inputmode: 'decimal' });
    const fee = inp(c.platformFeePerRide), maxDue = inp(c.maxFeesDue);
    const surge = el('input', { type: 'checkbox', checked: c.surgePricing });
    const mult = inp(c.surgeMultiplier);
    const area = { name: el('input', { class: 'input', value: c.serviceArea.name, style: 'width:200px;text-align:right;margin:0' }),
      lat: inp(c.serviceArea.lat), lng: inp(c.serviceArea.lng), radius: inp(c.serviceArea.radiusKm) };
    const support = {
      phone: el('input', { class: 'input', value: c.supportPhone || '', placeholder: '+91 …', style: 'width:200px;text-align:right;margin:0' }),
      email: el('input', { class: 'input', value: c.supportEmail || '', placeholder: 'help@…', style: 'width:200px;text-align:right;margin:0' }),
      source: el('input', { class: 'input', value: c.sourceCodeUrl || '', placeholder: 'https://…', style: 'width:260px;text-align:right;margin:0' }),
    };
    const veh = {};
    VTYPES.forEach((t) => {
      const r = c.rates[t];
      veh[t] = { on: el('input', { type: 'checkbox', checked: c.enabledVehicleTypes.includes(t) }),
        baseFare: inp(r.baseFare), perKm: inp(r.perKm), perMinute: inp(r.perMinute), minimumFare: inp(r.minimumFare) };
    });
    const row = (label, ctl) => el('div', { class: 'row' }, el('span', {}, label), ctl);
    const num = (input) => {
      const n = Number(input.value);
      if (input.value.trim() === '' || !isFinite(n)) throw new Error('Please check the numbers you entered');
      return n;
    };
    const save = el('button', { class: 'btn primary', onclick: async () => {
      save.disabled = true;
      try {
        const rates = {}, enabled = [];
        VTYPES.forEach((t) => {
          rates[t] = { baseFare: num(veh[t].baseFare), perKm: num(veh[t].perKm), perMinute: num(veh[t].perMinute), minimumFare: num(veh[t].minimumFare) };
          if (veh[t].on.checked) enabled.push(t);
        });
        if (!enabled.length) throw new Error('Keep at least one vehicle type switched on');
        await api('PUT', '/api/admin/config', {
          enabledVehicleTypes: enabled, rates, platformFeePerRide: num(fee), maxFeesDue: num(maxDue),
          surgePricing: surge.checked, surgeMultiplier: num(mult),
          serviceArea: { name: area.name.value.trim(), lat: num(area.lat), lng: num(area.lng), radiusKm: num(area.radius) },
          supportPhone: support.phone.value.trim(), supportEmail: support.email.value.trim(), sourceCodeUrl: support.source.value.trim(),
        });
        toast('Settings saved');
      } catch (e) { toast(e.message, true); } finally { save.disabled = false; }
    } }, 'Save changes');

    page('Settings', 'Changes apply to new rides only. Every change is recorded in the audit log.',
      el('div', { class: 'two' },
        el('div', {},
          el('div', { class: 'card' }, el('h2', { style: 'margin-top:0' }, 'Driver fee'),
            row('Fee per completed ride (₹)', fee), row('Driver goes offline when dues reach (₹)', maxDue)),
          el('div', { class: 'card', style: 'margin-top:14px' }, el('h2', { style: 'margin-top:0' }, 'Surge pricing'),
            row('Enable surge', surge), row('Multiplier (1 to 2)', mult)),
          el('div', { class: 'card', style: 'margin-top:14px' }, el('h2', { style: 'margin-top:0' }, 'Service area'),
            row('Town name', area.name), row('Centre latitude', area.lat), row('Centre longitude', area.lng), row('Radius (km)', area.radius),
            el('p', { class: 'muted small' }, 'Rides can only start and end inside this circle. Check the centre on a map.')),
          el('div', { class: 'card', style: 'margin-top:14px' }, el('h2', { style: 'margin-top:0' }, 'Help and legal'),
            row('Support phone', support.phone), row('Support email', support.email), row('Source code link (GPL)', support.source),
            el('p', { class: 'muted small' }, 'Shown on the apps’ Help and About screens. The privacy policy and terms pages are at /legal/privacy and /legal/terms: edit the drafts in the “legal” folder first.'))),
        el('div', {}, VTYPES.map((t, i) => el('div', { class: 'card', style: i ? 'margin-top:14px' : '' },
          el('h2', { style: 'margin-top:0' }, VEHICLES[t] + ' fares'),
          row('Available to book', veh[t].on), row('Base fare (₹)', veh[t].baseFare), row('Per km (₹)', veh[t].perKm),
          row('Per minute (₹)', veh[t].perMinute), row('Minimum fare (₹)', veh[t].minimumFare))))),
      el('p', {}, save));
  }

  // ------------------------------------------------------------------ audit
  async function viewAudit() {
    const list = await api('GET', '/api/admin/audit');
    page('Audit log', 'Last ' + list.length + ' admin actions',
      el('div', { class: 'tablewrap' }, el('table', {},
        el('thead', {}, el('tr', {}, ['When', 'Who', 'Action', 'About'].map((h) => el('th', {}, h)))),
        el('tbody', {}, list.length ? list.map((a) => el('tr', {},
          el('td', {}, fmtDateTime(a.createdAt)), el('td', {}, a.actorName),
          el('td', {}, a.action.replace(/_/g, ' ')), el('td', { class: 'small muted' }, a.entity))) :
          [el('tr', {}, el('td', { colspan: '4', class: 'muted' }, 'Nothing yet'))]))));
  }

  // ------------------------------------------------------------------ start
  async function start() {
    if (!token) return renderLogin();
    try {
      me = await api('GET', '/api/me');
      if (me.role !== 'admin') throw new Error('This account is not a Super Admin');
      renderShell();
    } catch (e) {
      token = null; sessionStorage.removeItem('ir_token');
      renderLogin(e.message === 'Please log in again' ? '' : e.message);
    }
  }
  start();
})();
