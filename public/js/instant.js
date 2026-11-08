// Instant buttons: swipe / like / rewind / reset / report actions run over
// fetch and update the page in place instead of a full POST -> redirect ->
// GET cycle (which cost ~1.5-2s per tap on the free tier). Every handler
// falls back to a normal form submit on any failure, so a broken fetch
// can never strand a tap. Attached by delegation on `document`, so forms
// swapped in by an XHR response keep working without rebinding.
(function () {
  'use strict';

  function toast(msg) {
    if (!msg) return;
    var el = document.getElementById('instant-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'instant-toast';
      el.className = 'instant-toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(function () { el.classList.remove('show'); }, 3200);
  }

  // The server parses urlencoded + JSON bodies, NOT multipart — so the
  // form must be sent URL-encoded. (FormData sends multipart, which
  // Express's urlencoded parser silently leaves as an empty req.body,
  // and every instant button then did nothing but reload the same card.)
  function postForm(form) {
    return fetch(form.action, {
      method: 'POST',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams(new FormData(form)),
      credentials: 'same-origin',
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    });
  }

  function showMessages(d) {
    if (d.msg) toast(d.msg);
    if (d.hint) toast(d.hint);
  }

  // Discover swipe / rewind / reset: the card flies out at once, then the
  // fresh Discover body swaps in — no full page reload.
  function handleDiscoverAction(form, e) {
    e.preventDefault();
    var card = document.querySelector('.swipe-card');
    var actions = document.querySelector('.swipe-actions');
    var kindInput = form.querySelector('input[name=kind]');
    var kind = kindInput ? kindInput.value : '';
    if (actions) actions.classList.add('busy');
    if (card) card.classList.add(kind === 'pass' ? 'swipe-out-left' : 'swipe-out-right');
    postForm(form).then(function (d) {
      if (d.redirect) { window.location.href = d.redirect; return; }
      if (d.html) {
        var root = document.getElementById('discover-root');
        if (root) root.outerHTML = d.html;
      }
      showMessages(d);
    }).catch(function () { form.submit(); });
  }

  // Grid heart (Discover end-state grid + Explore): fills in at once.
  function handleGridLike(form, e) {
    e.preventDefault();
    var btn = form.querySelector('button');
    if (btn) { btn.classList.add('liked'); btn.disabled = true; }
    postForm(form).then(function (d) {
      if (d.redirect) { window.location.href = d.redirect; return; }
      if (d.ok === false) {
        if (btn) { btn.classList.remove('liked'); btn.disabled = false; }
        form.submit();
        return;
      }
      showMessages(d);
    }).catch(function () {
      if (btn) { btn.classList.remove('liked'); btn.disabled = false; }
      form.submit();
    });
  }

  // Swipe buttons on a public profile page: there is no Discover card to
  // swap, so update the actions area in place instead of reloading.
  function handleProfileSwipe(form, e) {
    if (document.getElementById('discover-root')) { handleDiscoverAction(form, e); return; }
    e.preventDefault();
    var kindInput = form.querySelector('input[name=kind]');
    var kind = kindInput ? kindInput.value : '';
    var actions = form.closest('.swipe-actions');
    if (actions) actions.classList.add('busy');
    postForm(form).then(function (d) {
      if (d.redirect) { window.location.href = d.redirect; return; }
      if (actions) {
        var p = document.createElement('p');
        p.className = 'sub';
        p.style.textAlign = 'center';
        p.textContent = kind === 'pass' ? 'You passed this profile.' : 'You liked this profile.';
        actions.replaceWith(p);
      }
      showMessages(d);
    }).catch(function () { form.submit(); });
  }

  // Report on a public profile: no reload, just a toast.
  function handleReport(form, e) {
    e.preventDefault();
    var btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    postForm(form).then(function (d) {
      if (d.msg) toast(d.msg);
      var input = form.querySelector('input[name=reason]');
      if (input) input.value = '';
      if (btn) btn.disabled = false;
    }).catch(function () { form.submit(); });
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.classList.contains('js-swipe-form')) { handleProfileSwipe(form, e); return; }
    if (form.classList.contains('js-grid-like-form')) { handleGridLike(form, e); return; }
    if (form.classList.contains('js-reset-form')) { handleDiscoverAction(form, e); return; }
    if (form.classList.contains('js-report-form')) { handleReport(form, e); return; }
  });
})();
