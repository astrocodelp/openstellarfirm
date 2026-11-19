#pragma once

// The page the pet serves on its own Wi-Fi network. It does not set the pet up any more:
// a phone cannot carry the computer's certificate fingerprint safely, so a pet is paired
// only over the USB cable (docs/desk-pets-plan.md, "Pairing over the USB cable"), and
// WifiSetup::handleJoin refuses what the form sends. The page says so and hides the form,
// which stays in the markup, with its script, until the setup network is built to pair
// with a pinned computer. Everything is in this one string:
// no external font, script, stylesheet or image, since the phone has no internet
// while it is joined to the pet.
//
// The firmware fills in two markers before it sends the page:
//   {{NAME}}      the pet's name (Nova, Zib or Comet)
//   {{NETWORKS}}  one <option> per Wi-Fi network found, each name HTML-escaped
// Anything the page shows that came from outside (a network name, a message) goes
// in with textContent or an escaped attribute, never as markup.
//
// Colours are the brand's: night #070709, ivory #f3efe6, lime #d9ff3f; rose
// #ff8fb1 marks a problem.

#include <Arduino.h>

namespace pet {

static const char kSetupPage[] PROGMEM = R"HTML(<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Set up {{NAME}}</title>
<style>
:root{--night:#070709;--ivory:#f3efe6;--lime:#d9ff3f;--mute:#a09c92;--line:#2a2a31;--rose:#ff8fb1}
*{box-sizing:border-box}
body{margin:0;background:var(--night);color:var(--ivory);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:30rem;margin:0 auto;padding:1.5rem 1rem 3rem}
h1{font-size:1.45rem;line-height:1.2;margin:0 0 .5rem}
p{color:var(--mute);margin:.25rem 0 1rem}
label{display:block;margin:1.1rem 0 .3rem;font-weight:600}
input,select{width:100%;padding:.75rem;border-radius:.6rem;border:1px solid var(--line);background:#111116;color:var(--ivory);font:inherit}
input:focus,select:focus,button:focus,a:focus{outline:2px solid var(--lime);outline-offset:2px}
button{margin-top:1.4rem;width:100%;padding:.85rem;border:0;border-radius:.6rem;background:var(--lime);color:var(--night);font:inherit;font-weight:700;cursor:pointer}
button[disabled]{opacity:.5}
a{color:var(--lime)}
.small{font-size:.9rem}
.code{font:700 2.1rem/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;text-align:center;padding:1rem;border:1px solid var(--lime);border-radius:.8rem;margin:1rem 0;color:var(--lime)}
.err{color:var(--rose)}
.hide{display:none}
</style>
</head>
<body>
<main>
<h1>Set up {{NAME}}</h1>
<p>I cannot be set up from a phone. Plug me into your computer with my USB cable, then open OpenStellarFirm and choose Settings, Desk pets, Add a desk pet.</p>
<noscript><p class="err">This page needs JavaScript to run.</p></noscript>

<form id="form" class="hide" autocomplete="off">
<label for="ssid">Wi-Fi network</label>
<select id="ssid" name="ssid">
{{NETWORKS}}
<option value="">Another network...</option>
</select>
<p class="small"><a href="/rescan">Look for networks again</a>. I can use 2.4 GHz networks only.</p>
<div id="otherbox" class="hide">
<label for="other">Network name</label>
<input id="other" name="other" maxlength="32">
</div>
<label for="pass">Wi-Fi password</label>
<input id="pass" name="pass" type="password" maxlength="64" autocomplete="off">
<p class="small">Leave it empty for a network with no password.</p>
<label for="code">Setup code</label>
<input id="code" name="code" maxlength="16" autocapitalize="characters" autocorrect="off" spellcheck="false" placeholder="XXXXX-XXXXX">
<button id="go" type="submit">Connect</button>
<p id="formerr" class="err hide"></p>
</form>

<section id="status" class="hide" aria-live="polite">
<p id="msg"></p>
<div id="confirm" class="code hide"></div>
<p id="hint" class="small hide">Type this code in OpenStellarFirm to approve me. I am saying it out loud too: if I am not saying it, do not approve. If this page stops updating, join my Wi-Fi network again.</p>
<button id="again" type="button" class="hide">Try again</button>
</section>
</main>
<script>
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var form = $('form'), status = $('status'), sel = $('ssid'), timer = null;

  function setText(id, text) { $(id).textContent = text; }
  function showForm(message) {
    status.className = 'hide';
    form.className = '';
    $('go').disabled = false;
    $('formerr').className = message ? 'err' : 'err hide';
    setText('formerr', message || '');
  }
  function showStatus() { form.className = 'hide'; status.className = ''; }

  function render(s) {
    showStatus();
    setText('msg', s.message || '');
    var haveCode = s.state === 'confirm' && s.code;
    $('confirm').className = haveCode ? 'code' : 'code hide';
    $('hint').className = haveCode ? 'small' : 'small hide';
    setText('confirm', haveCode ? s.code : '');
    $('msg').className = s.state === 'error' ? 'err' : '';
    $('again').className = s.state === 'error' ? '' : 'hide';
    if (s.state === 'done' || s.state === 'error') { stop(); }
  }
  // The pet answers /status and /join only to a request with this header, which a
  // page on another site cannot add (core/setup_access.h).
  var mine = { 'X-Pet-Setup': '1' };
  function poll() {
    fetch('/status', { cache: 'no-store', headers: mine })
      .then(function (r) { return r.json(); })
      .then(render)
      .catch(function () { /* the network may drop for a moment while I join yours */ });
  }
  function start() { stop(); poll(); timer = setInterval(poll, 2000); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  sel.addEventListener('change', function () {
    $('otherbox').className = sel.value === '' ? '' : 'hide';
  });
  if (sel.value === '') { $('otherbox').className = ''; }

  $('again').addEventListener('click', function () { showForm(''); });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var body = new URLSearchParams();
    body.set('ssid', sel.value === '' ? $('other').value : sel.value);
    body.set('pass', $('pass').value);
    body.set('code', $('code').value);
    $('go').disabled = true;
    fetch('/join', { method: 'POST', body: body, headers: mine })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, body: j }; }); })
      .then(function (x) {
        if (!x.ok) { showForm(x.body.message || 'That did not work.'); return; }
        showStatus();
        setText('msg', 'Joining your Wi-Fi...');
        start();
      })
      .catch(function () { showForm('I could not reach the page. Try again.'); });
  });

  // A page opened again while I am already working shows where I am.
  fetch('/status', { cache: 'no-store', headers: mine }).then(function (r) { return r.json(); }).then(function (s) {
    if (s.state && s.state !== 'ready') { render(s); start(); }
  }).catch(function () {});
})();
</script>
</body>
</html>
)HTML";

}  // namespace pet
