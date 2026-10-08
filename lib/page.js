// The check-in page, served by api/page.js.
module.exports = `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Knightingale</title>
<style>
  :root {
    --cherry: #681334;
    --eucalypt: #213530;
    --gumleaf: #E4F7D6;
    --sand: #EDE8DC;
    --charcoal: #2E2E2B;
    --error: #8a1c1c;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: Geist, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    background: var(--sand);
    color: var(--charcoal);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
  }
  main {
    width: 100%;
    max-width: 420px;
    background: #fff;
    border-radius: 20px;
    padding: 28px 22px;
    box-shadow: 0 2px 14px rgba(33, 53, 48, 0.12);
    text-align: center;
  }
  .brand { color: var(--cherry); font-weight: 600; letter-spacing: 0.04em; font-size: 14px; text-transform: uppercase; }
  h1 { color: var(--eucalypt); font-size: 26px; margin: 10px 0 6px; }
  p { margin: 6px 0; line-height: 1.45; }
  .meta { color: #5a5a55; font-size: 15px; }
  button {
    margin-top: 22px;
    width: 100%;
    padding: 18px;
    font-size: 18px;
    font-weight: 600;
    color: #fff;
    background: var(--cherry);
    border: 0;
    border-radius: 14px;
    cursor: pointer;
  }
  button:disabled { opacity: 0.6; cursor: default; }
  .ok { background: var(--gumleaf); border-radius: 14px; padding: 16px; margin-top: 18px; color: var(--eucalypt); font-weight: 600; }
  .err { color: var(--error); margin-top: 16px; font-weight: 500; }
  .hidden { display: none; }
</style>
</head>
<body>
<main>
  <div class="brand">Knightingale</div>
  <h1 id="title">Loading...</h1>
  <p class="meta" id="addr"></p>
  <p class="meta" id="when"></p>
  <button id="go" class="hidden">Check in</button>
  <div id="done" class="ok hidden"></div>
  <p id="err" class="err hidden"></p>
</main>
<script>
(function () {
  var token = location.pathname.split('/')[2] || '';
  var $ = function (id) { return document.getElementById(id); };
  var kind = 'in';

  function show(el, text) { if (text !== undefined) el.textContent = text; el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }
  function fail(msg) { hide($('done')); show($('err'), msg); }

  function label() { return kind === 'in' ? 'Check in' : 'Check out'; }

  function finish(r) {
    hide($('go')); hide($('err'));
    $('title').textContent = r.already ? 'Already done' : (kind === 'in' ? 'You are checked in' : 'You are checked out');
    show($('done'), (kind === 'in' ? 'Checked in at ' : 'Checked out at ') + r.time);
  }

  fetch('/api/shift?t=' + encodeURIComponent(token))
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d.ok) { $('title').textContent = 'Link problem'; fail(d.message); return; }
      kind = d.kind;
      $('title').textContent = label();
      $('addr').textContent = d.address;
      $('when').textContent = d.day + ', ' + d.start + ' to ' + d.end;
      if (d.done) { finish({ already: true, time: d.doneAt }); return; }
      $('go').textContent = label();
      show($('go'));
    })
    .catch(function () { $('title').textContent = 'Link problem'; fail('Could not load. Check your connection and try again.'); });

  $('go').addEventListener('click', function () {
    hide($('err'));
    if (!navigator.geolocation) { fail('This browser cannot share location. Please open the link in Safari or Chrome.'); return; }
    var btn = $('go');
    btn.disabled = true;
    btn.textContent = 'Finding your location...';
    navigator.geolocation.getCurrentPosition(function (pos) {
      btn.textContent = 'Checking...';
      fetch('/api/checkin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token: token,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy
        })
      })
        .then(function (r) { return r.json(); })
        .then(function (r) {
          if (r.ok) { finish(r); return; }
          fail(r.message || 'Something went wrong. Please try again.');
          btn.disabled = false; btn.textContent = label();
        })
        .catch(function () {
          fail('Could not reach the server. Check your connection and try again.');
          btn.disabled = false; btn.textContent = label();
        });
    }, function (err) {
      var msg = err && err.code === 1
        ? 'Location is blocked. Allow location for this page in your browser settings, then try again.'
        : 'Could not get your location. Move outside and try again.';
      fail(msg);
      btn.disabled = false; btn.textContent = label();
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });
})();
</script>
</body>
</html>
`;
