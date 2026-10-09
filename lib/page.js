// The check-in / check-out page, served by api/page.js.
module.exports = `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex">
<title>Knightingale</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500&family=Newsreader:wght@300;400&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #f6f5f1;
    --ink: #1d1d1b;
    --muted: #7a7870;
    --faint: #8f8d86;
    --line: #dedbd3;
    --bad: #8a2f2a;
    --ok: #213530;
    --off: #e8e5df;
    --off-ink: #a8a49b;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: var(--bg);
    color: var(--ink);
    font-family: Geist, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap {
    min-height: 100vh;
    min-height: 100svh;
    max-width: 480px;
    margin: 0 auto;
    padding: 28px 30px 28px;
    display: flex;
    flex-direction: column;
  }
  header { display: flex; justify-content: space-between; }
  .eyebrow, header span {
    font-size: 11px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    color: var(--faint);
    margin: 0;
  }
  .top { margin-top: 52px; }
  h1 {
    font-family: Newsreader, Georgia, "Times New Roman", serif;
    font-weight: 300;
    font-size: 48px;
    line-height: 1.05;
    letter-spacing: -0.015em;
    margin: 14px 0 0;
    min-height: 50px;
  }
  .rows { margin-top: 42px; }
  .row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 20px;
    padding: 14px 0;
    border-top: 1px solid var(--line);
    font-size: 15px;
  }
  .row:last-child { border-bottom: 1px solid var(--line); }
  .row .k { color: var(--muted); }
  .row .v { text-align: right; }
  .rule { border: 0; border-top: 1px solid var(--ink); margin: 44px 0 0; }
  #dist { margin-top: 30px; }
  .big { margin: 14px 0 0; font-weight: 300; font-size: 60px; line-height: 1; letter-spacing: -0.02em; }
  .unit { font-size: 24px; color: var(--faint); margin-left: 8px; letter-spacing: 0; }
  .box {
    margin-top: 28px;
    border: 1px solid var(--line);
    padding: 22px 22px 24px;
  }
  .box.bad { border-color: var(--bad); }
  .box.ok { border-color: var(--ok); }
  .box-t {
    margin: 0;
    font-size: 12px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .box.bad .box-t { color: var(--bad); }
  .box.ok .box-t { color: var(--ok); }
  .box-b { margin: 10px 0 0; font-size: 16px; line-height: 1.45; color: var(--muted); }
  .box-b:empty { display: none; }
  .spacer { flex: 1; min-height: 28px; }
  .actions { display: flex; flex-direction: column; gap: 10px; }
  .btn {
    width: 100%;
    height: 52px;
    font: inherit;
    font-size: 12px;
    letter-spacing: 0.24em;
    text-transform: uppercase;
    border-radius: 0;
    cursor: pointer;
  }
  .ghost { background: transparent; color: var(--ink); border: 1px solid var(--ink); }
  .solid { background: var(--ink); color: #fff; border: 1px solid var(--ink); }
  .btn:disabled { cursor: default; }
  .ghost:disabled { opacity: 0.45; }
  .solid:disabled { background: var(--off); color: var(--off-ink); border-color: var(--off); }
  .hidden { display: none; }
</style>
</head>
<body>
<div class="wrap">
  <header><span>Knightingale</span><span>Shift</span></header>

  <section class="top">
    <p class="eyebrow" id="day">&nbsp;</p>
    <h1 id="title"></h1>
  </section>

  <div class="rows" id="rows"></div>
  <hr class="rule">

  <section id="dist" class="hidden">
    <p class="eyebrow">Your distance</p>
    <p class="big"><span id="num">-</span><span class="unit" id="unit"></span></p>
  </section>

  <div class="box neutral" id="box" role="status" aria-live="polite">
    <p class="box-t" id="boxT">Loading</p>
    <p class="box-b" id="boxB"></p>
  </div>

  <div class="spacer"></div>

  <div class="actions hidden" id="actions">
    <button id="refresh" class="btn ghost" type="button">Refresh location</button>
    <button id="go" class="btn solid" type="button" disabled>Check in</button>
  </div>
</div>
<script>
(function () {
  var token = location.pathname.split('/')[2] || '';
  var $ = function (id) { return document.getElementById(id); };
  var kind = 'in';
  var radius = 500;
  var ready = false;
  var geoOpts = { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 };

  function word() { return kind === 'in' ? 'check in' : 'check out'; }
  function label() { return kind === 'in' ? 'Check in' : 'Check out'; }

  function setBox(tone, title, body) {
    var b = $('box');
    b.className = 'box ' + tone;
    $('boxT').textContent = title;
    $('boxB').textContent = body || '';
  }

  function setDistance(m) {
    if (m === null || m === undefined) { $('num').textContent = '-'; $('unit').textContent = ''; return; }
    if (m >= 1000) { $('num').textContent = (m / 1000).toFixed(1); $('unit').textContent = 'km'; }
    else { $('num').textContent = String(m); $('unit').textContent = 'm'; }
  }

  function post(url, body) {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); });
  }

  function position(pos) {
    return { token: token, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
  }

  function geoError(err) {
    if (err && err.code === 1) {
      setBox('bad', 'Location is off', 'Allow location for this page in your browser settings, then tap Refresh location.');
    } else {
      setBox('bad', 'No location', 'Could not get your location. Move outside and tap Refresh location.');
    }
    $('refresh').disabled = false;
  }

  function addRow(k, v) {
    var row = document.createElement('div');
    row.className = 'row';
    var a = document.createElement('span'); a.className = 'k'; a.textContent = k;
    var b = document.createElement('span'); b.className = 'v'; b.textContent = v;
    row.appendChild(a); row.appendChild(b);
    $('rows').appendChild(row);
  }

  function timeRange(s, e) {
    if (!s || !e) return '';
    var same = s.slice(-2) === e.slice(-2);
    return (same ? s.slice(0, -3) : s) + ' \\u2014 ' + e;
  }

  function finish(r) {
    $('actions').classList.add('hidden');
    $('dist').classList.add('hidden');
    $('title').textContent = r.already ? 'Already done' : (kind === 'in' ? 'You are checked in' : 'You are checked out');
    setBox('ok', kind === 'in' ? 'Checked in' : 'Checked out', 'at ' + r.time);
  }

  function locate() {
    if (!ready) return;
    $('go').disabled = true;
    $('refresh').disabled = true;
    setDistance(null);
    setBox('neutral', 'Locating', 'Finding your location...');
    if (!navigator.geolocation) {
      setBox('bad', 'No location', 'This browser cannot share location. Please open the link in Safari or Chrome.');
      $('refresh').disabled = false;
      return;
    }
    navigator.geolocation.getCurrentPosition(function (pos) {
      post('/api/distance', position(pos)).then(function (r) {
        $('refresh').disabled = false;
        if (!r.ok) { setBox('bad', 'Problem', r.message || 'Something went wrong. Please try again.'); return; }
        setDistance(r.distance);
        if (!r.precise) {
          setBox('bad', 'Location not precise', 'Your phone could not get a precise location. Move outside or turn on precise location, then tap Refresh location.');
          return;
        }
        if (!r.inRange) {
          setBox('bad', 'Outside ' + word() + ' range', 'You need to be within ' + radius + ' m of the shift location.');
          return;
        }
        setBox('ok', 'Within range', 'You are close enough to ' + word() + '.');
        $('go').disabled = false;
      }).catch(function () {
        $('refresh').disabled = false;
        setBox('bad', 'No connection', 'Could not reach the server. Check your connection and tap Refresh location.');
      });
    }, geoError, geoOpts);
  }

  $('refresh').addEventListener('click', locate);

  $('go').addEventListener('click', function () {
    var btn = $('go');
    btn.disabled = true;
    $('refresh').disabled = true;
    btn.textContent = 'Finding your location...';
    navigator.geolocation.getCurrentPosition(function (pos) {
      btn.textContent = 'Checking...';
      post('/api/checkin', position(pos)).then(function (r) {
        if (r.ok) { finish(r); return; }
        if (typeof r.distance === 'number') setDistance(r.distance);
        setBox('bad', 'Could not ' + word(), r.message || 'Something went wrong. Please try again.');
        btn.textContent = label();
        $('refresh').disabled = false;
      }).catch(function () {
        setBox('bad', 'No connection', 'Could not reach the server. Check your connection and tap Refresh location.');
        btn.textContent = label();
        $('refresh').disabled = false;
      });
    }, function (err) {
      btn.textContent = label();
      geoError(err);
    }, geoOpts);
  });

  fetch('/api/shift?t=' + encodeURIComponent(token))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok) {
        $('title').textContent = 'Link problem';
        setBox('bad', 'Problem', d.message);
        return;
      }
      kind = d.kind;
      radius = d.radiusM;
      $('title').textContent = label();
      $('day').textContent = d.day;
      addRow('Time', timeRange(d.start, d.end));
      if (d.name) addRow(d.label, d.name);
      $('go').textContent = label();
      $('actions').classList.remove('hidden');
      if (d.done) { finish({ already: true, time: d.doneAt }); return; }
      $('dist').classList.remove('hidden');
      ready = true;
      locate();
    })
    .catch(function () {
      $('title').textContent = 'Link problem';
      setBox('bad', 'No connection', 'Could not load. Check your connection and try again.');
    });
})();
</script>
</body>
</html>
`;
