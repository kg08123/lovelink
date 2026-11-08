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
  // fresh Discover body swaps in — no full page reload. `preFlown` is set
  // by the drag handler, which already flew the card out with its own
  // inline transform — then no CSS fly-out class is added on top of it.
  function handleDiscoverAction(form, e, preFlown) {
    if (e) e.preventDefault();
    var card = document.querySelector('.swipe-card:not(.peek)');
    var actions = document.querySelector('.swipe-actions');
    var kindInput = form.querySelector('input[name=kind]');
    var kind = kindInput ? kindInput.value : '';
    if (actions) actions.classList.add('busy');
    if (card && !preFlown) card.classList.add(kind === 'pass' ? 'swipe-out-left' : 'swipe-out-right');
    postForm(form).then(function (d) {
      if (d.redirect) { window.location.href = d.redirect; return; }
      if (d.html) {
        var root = document.getElementById('discover-root');
        if (root) root.outerHTML = d.html;
      }
      showMessages(d);
    }).catch(function () { form.submit(); });
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
    if (form.classList.contains('js-reset-form')) { handleDiscoverAction(form, e); return; }
    if (form.classList.contains('js-report-form')) { handleReport(form, e); return; }
  });

  // Skeleton shimmer: photo containers shimmer until their image loads.
  // `load` does not bubble, so listen in the capture phase; the CSS kills
  // the shimmer (::before) once the container has .img-loaded.
  document.addEventListener('load', function (e) {
    var t = e.target;
    if (!t || t.tagName !== 'IMG') return;
    var p = t.closest('.swipe-photo-link');
    if (p) p.classList.add('img-loaded');
    if (t.complete && t.naturalWidth > 0) {
      var q = t.closest('.swipe-photo-link');
      if (q) q.classList.add('img-loaded');
    }
  }, true);

  // ---- Dark mode toggle (Settings) ----
  // The choice lives in a cookie (the server renders <html class="dark">,
  // so there is no white flash) AND localStorage (the <head> boot script
  // reads it when there is no cookie yet, e.g. system-preference
  // default). Flipping the switch changes the theme instantly, no reload.
  var themeToggle = document.getElementById('themeToggle');
  function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) { /* private mode */ }
    document.cookie = 'theme=' + (dark ? 'dark' : 'light') + '; max-age=31536000; path=/; SameSite=Lax';
  }
  if (themeToggle) {
    themeToggle.checked = document.documentElement.classList.contains('dark');
    themeToggle.addEventListener('change', function () { applyTheme(themeToggle.checked); });
  }

  // ---- Drag to swipe (Discover card) ----
  // Pointer Events, works for touch and mouse. The card follows the
  // finger, rotates a little, LIKE / NOPE stamps fade in as it moves.
  // Release past the threshold = swipe (same fetch flow as the buttons);
  // release early = the card springs back. Taps on links/buttons inside
  // the card still work: a drag only starts after 10px of movement, and
  // a tap-length press is never treated as a drag.
  var DRAG_MIN = 10, SWIPE_PX = 90;
  var drag = null, suppressClickUntil = 0;

  function dragCard() {
    return document.querySelector('#discover-root .swipe-card:not(.peek)');
  }

  function dragForm(kind) {
    var forms = document.querySelectorAll('#discover-root .js-swipe-form');
    for (var i = 0; i < forms.length; i++) {
      var k = forms[i].querySelector('input[name=kind]');
      if (k && k.value === kind) return forms[i];
    }
    return null;
  }

  document.addEventListener('pointerdown', function (e) {
    if (drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var card = e.target.closest ? e.target.closest('.swipe-card') : null;
    if (!card || card.classList.contains('peek')) return;
    if (!card.closest('#discover-root')) return;
    if (e.target.closest('form, button, .swipe-info-btn')) return;
    if (document.querySelector('.swipe-actions.busy')) return;
    drag = { card: card, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, active: false, pointerId: e.pointerId };
    try { card.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
  });

  document.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.active) {
      if (Math.abs(dx) < DRAG_MIN && Math.abs(dy) < DRAG_MIN) return;
      // Vertical scroll wins: if the user is mostly scrolling, bail out
      // and let the page scroll normally.
      if (Math.abs(dy) > Math.abs(dx) * 1.4) { drag = null; return; }
      drag.active = true;
      drag.card.classList.add('dragging');
    }
    drag.dx = dx; drag.dy = dy;
    var rot = Math.max(-12, Math.min(12, dx * 0.06));
    drag.card.style.transform = 'translate(' + dx + 'px,' + (dy * 0.35) + 'px) rotate(' + rot + 'deg)';
    var like = drag.card.querySelector('.stamp-like');
    var nope = drag.card.querySelector('.stamp-nope');
    var strength = Math.min(1, Math.abs(dx) / 80);
    if (like) like.style.opacity = dx > 0 ? strength : 0;
    if (nope) nope.style.opacity = dx < 0 ? strength : 0;
  });

  function dragEnd(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    var d = drag; drag = null;
    if (!d.active) return;
    suppressClickUntil = Date.now() + 350;
    var card = d.card;
    var like = card.querySelector('.stamp-like');
    var nope = card.querySelector('.stamp-nope');
    if (like) like.style.opacity = 0;
    if (nope) nope.style.opacity = 0;
    var threshold = Math.min(SWIPE_PX, card.offsetWidth * 0.25);
    if (Math.abs(d.dx) >= threshold) {
      var kind = d.dx > 0 ? 'like' : 'pass';
      var form = dragForm(kind);
      if (!form) { springBack(card); return; }
      // Fly the card off with the same inline transform it already has,
      // then run the normal instant swipe flow (fetch + HTML swap).
      card.style.transition = 'transform .22s ease, opacity .22s ease';
      card.style.transform = 'translate(' + (d.dx > 0 ? 120 : -120) + '%, ' + (d.dy * 0.35) + 'px) rotate(' + (d.dx > 0 ? 14 : -14) + 'deg)';
      card.style.opacity = '0';
      handleDiscoverAction(form, null, true);
    } else {
      springBack(card);
    }
  }

  function springBack(card) {
    card.style.transition = 'transform .3s cubic-bezier(.2,1.4,.4,1)';
    card.style.transform = '';
    card.classList.remove('dragging');
    setTimeout(function () { card.style.transition = ''; }, 320);
  }

  document.addEventListener('pointerup', dragEnd);
  // A cancelled gesture (browser took over, e.g. scroll) never swipes —
  // the card just springs back. (pointerup above is the only path that
  // can fire a swipe.)
  document.addEventListener('pointercancel', function (e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    var d = drag; drag = null;
    if (d.active) springBack(d.card);
  });

  // The card photo is an <img> inside a link: without this, the browser
  // starts a native image drag on mousedown+move, fires pointercancel,
  // and the drag-to-swipe gesture dies after 2 moves. (draggable="false"
  // on the img is the first line of defence; this is the second.)
  document.addEventListener('dragstart', function (e) {
    if (e.target.closest && e.target.closest('.swipe-card')) e.preventDefault();
  });

  // A drag must never trigger the link underneath it: if the pointer
  // moved, swallow the click that follows the drag. (The drag state is
  // already cleared by the time the click fires, so a timestamp flag
  // carries the suppression across.)
  document.addEventListener('click', function (e) {
    if (Date.now() < suppressClickUntil) { e.preventDefault(); e.stopPropagation(); }
  }, true);
})();
