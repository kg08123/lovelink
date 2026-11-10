// Instant buttons: swipe / like / message / rewind / reset / report actions
// run over fetch and update the page in place instead of a full POST ->
// redirect -> GET cycle (which cost ~1.5-2s per tap on the free tier).
// Every handler falls back to a normal form submit on any failure, so a
// broken fetch can never strand a tap. Attached by delegation on
// `document`, so forms swapped in by an XHR response keep working
// without rebinding.
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

  function postJson(url, obj) {
    return fetch(url, {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
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

  // ---- Bottom sheets (premium gate / report) ----
  function openSheet(id) {
    var sheet = document.getElementById(id);
    if (!sheet) return false;
    var backdrop = document.getElementById(id + 'Backdrop');
    sheet.hidden = false;
    if (backdrop) backdrop.hidden = false;
    return true;
  }
  function closeSheet(id) {
    var sheet = document.getElementById(id);
    if (sheet) sheet.hidden = true;
    var backdrop = document.getElementById(id + 'Backdrop');
    if (backdrop) backdrop.hidden = true;
  }
  function closeAllSheets() {
    document.querySelectorAll('.sheet').forEach(function (s) { s.hidden = true; });
    document.querySelectorAll('.sheet-backdrop').forEach(function (b) { b.hidden = true; });
  }

  // ---- Photo viewer: story-progress tap zones on Discover + public profile ----
  // Discover card: photos[] holds the 360px thumbs; index 0 shows the full
  // first photo (the <img>'s initial src). Public profile: full photos.
  function initPhotoViewers() {
    var card = document.querySelector('#discover-root .swipe-card:not(.peek)');
    if (card && !card._photosInit) {
      card._photosInit = true;
      var img = card.querySelector('.fs-photo');
      var list = [];
      try { list = JSON.parse(card.dataset.photos || '[]'); } catch (e) { list = []; }
      card._photos = list;
      card._photoIdx = 0;
      card._fullFirst = img ? img.src : null;
    }
    var heroWrap = document.querySelector('.pub-hero');
    var hero = document.getElementById('pubHeroImg');
    if (heroWrap && hero && !heroWrap._photosInit) {
      heroWrap._photosInit = true;
      var list2 = [hero.src];
      document.querySelectorAll('.pub-more img[data-full]').forEach(function (im) {
        list2.push(im.getAttribute('data-full') || im.src);
      });
      heroWrap._photos = list2;
      heroWrap._photoIdx = 0;
      heroWrap._fullFirst = hero.src;
    }
  }

  function cyclePhoto(container, dir) {
    if (!container || !container._photos || container._photos.length < 2) return;
    var n = container._photos.length;
    var idx = (container._photoIdx + dir + n) % n;
    container._photoIdx = idx;
    var img = container.classList.contains('fs-card')
      ? container.querySelector('.fs-photo')
      : document.getElementById('pubHeroImg');
    if (!img) return;
    img.src = idx === 0 ? container._fullFirst : container._photos[idx];
    container.querySelectorAll('.story-bar').forEach(function (b, i) {
      b.classList.toggle('on', i === idx);
    });
  }

  var recycledToastShown = false;
  function maybeRecycledToast() {
    var root = document.getElementById('discover-root');
    if (root && root.dataset.recycled && !recycledToastShown) {
      recycledToastShown = true;
      toast(root.dataset.recycledMsg || 'Showing profiles again.');
    }
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
        initPhotoViewers();
        maybeRecycledToast();
      }
      if (d.sheet === 'premium') openSheet('pointsSheet');
      showMessages(d);
    }).catch(function () { form.submit(); });
  }

  // Message button on a card: matched -> chat; not matched -> like first.
  // On Discover the next card swaps in; on a public profile the actions
  // area becomes a "You liked this profile" note (there is no deck there).
  function handleMessageForm(form, e) {
    if (e) e.preventDefault();
    var actions = form.closest('.swipe-actions');
    if (actions) actions.classList.add('busy');
    postForm(form).then(function (d) {
      if (d.redirect) { window.location.href = d.redirect; return; }
      if (d.sheet === 'premium') {
        if (!openSheet('pointsSheet')) { window.location.href = '/premium?blocked=1'; return; }
      }
      var root = document.getElementById('discover-root');
      if (d.html && root) {
        root.outerHTML = d.html;
        initPhotoViewers();
        maybeRecycledToast();
      } else if (actions) {
        var p = document.createElement('p');
        p.className = 'sub';
        p.style.textAlign = 'center';
        p.textContent = 'You liked this profile.';
        actions.replaceWith(p);
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
      if (d.sheet === 'premium') { window.location.href = '/premium?blocked=1'; return; }
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

  // Report on a public profile: no reload, just a toast + close the sheet.
  function handleReport(form, e) {
    e.preventDefault();
    var btn = form.querySelector('button[type=submit]');
    if (btn) btn.disabled = true;
    postForm(form).then(function (d) {
      if (d.msg) toast(d.msg);
      var input = form.querySelector('input[name=reason]');
      if (input) input.value = '';
      if (btn) btn.disabled = false;
      closeAllSheets();
    }).catch(function () { form.submit(); });
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.classList.contains('js-swipe-form')) { handleProfileSwipe(form, e); return; }
    if (form.classList.contains('js-message-form')) { handleMessageForm(form, e); return; }
    if (form.classList.contains('js-reset-form')) { handleDiscoverAction(form, e); return; }
    if (form.classList.contains('js-report-form')) { handleReport(form, e); return; }
  });

  // Sheet open/close wiring (delegated: sheets are re-rendered by swaps).
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#pointsSheetClose')) { closeSheet('pointsSheet'); return; }
    if (t.closest('#pointsSheetBackdrop')) { closeSheet('pointsSheet'); return; }
    if (t.closest('#pubReportBtn')) { openSheet('reportSheet'); return; }
    if (t.closest('#reportSheetClose')) { closeSheet('reportSheet'); return; }
    if (t.closest('#reportSheetBackdrop')) { closeSheet('reportSheet'); return; }
  });

  // Photo tap zones: left third = previous photo, right = next photo.
  // A drag (10px+) never reaches here as a click — the drag handler
  // swallows the click that follows it.
  var suppressClickUntil = 0;
  document.addEventListener('click', function (e) {
    if (Date.now() < suppressClickUntil) return;
    var t = e.target;
    if (!t || !t.closest) return;
    var zone = t.closest('.pz');
    if (!zone) return;
    var card = t.closest('.swipe-card:not(.peek)');
    var hero = t.closest('.pub-hero');
    if (card) cyclePhoto(card, zone.classList.contains('pz-prev') ? -1 : 1);
    else if (hero) cyclePhoto(hero, zone.classList.contains('pz-prev') ? -1 : 1);
  });

  // Likes tabs: swap the grid over fetch, no full reload; back button
  // reloads the page so the tab always matches the URL.
  document.addEventListener('click', function (e) {
    var tab = e.target && e.target.closest ? e.target.closest('#likesTabs a[data-tab]') : null;
    if (!tab) return;
    e.preventDefault();
    var name = tab.dataset.tab;
    fetch('/likes?tab=' + name + '&fragment=1', {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      credentials: 'same-origin',
    }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.text();
    }).then(function (html) {
      var wrap = document.getElementById('likesGridWrap');
      if (wrap) wrap.innerHTML = html;
      document.querySelectorAll('#likesTabs .text-tab').forEach(function (t) {
        t.classList.toggle('on', t === tab);
      });
      try { history.pushState(null, '', '/likes?tab=' + name); } catch (err) { /* ignore */ }
    }).catch(function () { window.location.href = '/likes?tab=' + name; });
  });
  window.addEventListener('popstate', function () {
    if (document.getElementById('likesTabs')) window.location.reload();
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

  // ---- Dark mode: Settings switch, one shared state ----
  // The choice lives in a cookie (the server renders <html class="dark">,
  // so there is no white flash) AND localStorage (the <head> boot script
  // reads it when there is no cookie yet). Dark is the default now.
  var themeToggle = document.getElementById('themeToggle');
  function applyTheme(dark) {
    document.documentElement.classList.toggle('dark', dark);
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch (e) { /* private mode */ }
    document.cookie = 'theme=' + (dark ? 'dark' : 'light') + '; max-age=31536000; path=/; SameSite=Lax';
    if (themeToggle) themeToggle.checked = dark;
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
  var drag = null;

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

  // ---- My Profile photo grid: tap to replace, drag to reorder ----
  // Pointer drag: press a tile and move >8px to drag it; dropping it on
  // another tile reorders the photos (saved at once). A plain tap opens
  // the file picker for that slot. The × removes that photo.
  var grid = document.getElementById('photoGrid');
  var replaceInput = document.getElementById('photoReplaceInput');
  var pendingSlot = null;
  if (grid && replaceInput) {
    var tileDrag = null;
    grid.addEventListener('pointerdown', function (e) {
      var tile = e.target.closest ? e.target.closest('.photo-tile') : null;
      if (!tile) return;
      if (e.target.closest('.photo-x')) return;
      tileDrag = { tile: tile, x0: e.clientX, y0: e.clientY, active: false, pointerId: e.pointerId };
      try { tile.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    });
    grid.addEventListener('pointermove', function (e) {
      if (!tileDrag || e.pointerId !== tileDrag.pointerId) return;
      var dx = e.clientX - tileDrag.x0, dy = e.clientY - tileDrag.y0;
      if (!tileDrag.active) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        tileDrag.active = true;
        tileDrag.tile.classList.add('dragging');
        tileDrag.tile.style.pointerEvents = 'none';
      }
      tileDrag.tile.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(1.04)';
      var el = document.elementFromPoint(e.clientX, e.clientY);
      var over = el && el.closest ? el.closest('.photo-tile') : null;
      grid.querySelectorAll('.photo-tile').forEach(function (t) { t.classList.remove('drop-target'); });
      if (over && over !== tileDrag.tile) over.classList.add('drop-target');
    });
    function tileDragEnd(e) {
      if (!tileDrag || e.pointerId !== tileDrag.pointerId) return;
      var d = tileDrag; tileDrag = null;
      var tile = d.tile;
      tile.style.transform = '';
      tile.style.pointerEvents = '';
      tile.classList.remove('dragging');
      grid.querySelectorAll('.photo-tile').forEach(function (t) { t.classList.remove('drop-target'); });
      if (!d.active) return;
      suppressClickUntil = Date.now() + 350;
      var el = document.elementFromPoint(e.clientX, e.clientY);
      var over = el && el.closest ? el.closest('.photo-tile') : null;
      if (over && over !== tile) {
        var rect = over.getBoundingClientRect();
        var after = (e.clientX - rect.left) > rect.width / 2;
        if (after) grid.insertBefore(tile, over.nextSibling);
        else grid.insertBefore(tile, over);
        savePhotoOrder();
      }
    }
    grid.addEventListener('pointerup', tileDragEnd);
    grid.addEventListener('pointercancel', function (e) {
      if (!tileDrag || e.pointerId !== tileDrag.pointerId) return;
      var t = tileDrag.tile; tileDrag = null;
      t.style.transform = ''; t.style.pointerEvents = ''; t.classList.remove('dragging');
    });
    grid.addEventListener('click', function (e) {
      if (Date.now() < suppressClickUntil) return;
      var x = e.target.closest ? e.target.closest('.photo-x') : null;
      if (x) {
        e.stopPropagation();
        var slot = Number(x.dataset.remove);
        fetch('/profile/photos/remove', {
          method: 'POST',
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ slot: String(slot) }),
          credentials: 'same-origin',
        }).then(function (r) {
          if (!r.ok) throw new Error('http ' + r.status);
          window.location.reload();
        }).catch(function () { toast('Could not remove that photo — try again.'); });
        return;
      }
      var tile = e.target.closest ? e.target.closest('.photo-tile') : null;
      if (!tile) return;
      pendingSlot = Number(tile.dataset.slot);
      replaceInput.click();
    });
    replaceInput.addEventListener('change', function () {
      var f = replaceInput.files[0];
      if (!f || !pendingSlot) { replaceInput.value = ''; return; }
      var fd = new FormData();
      fd.append('slot', String(pendingSlot));
      fd.append('photo', f);
      fetch('/profile/photos/replace', {
        method: 'POST',
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
        body: fd,
        credentials: 'same-origin',
      }).then(function (r) {
        if (!r.ok) throw new Error('http ' + r.status);
        return r.json();
      }).then(function () { window.location.reload(); })
        .catch(function () { toast('Could not save that photo — try a smaller one.'); });
      replaceInput.value = '';
    });
    function savePhotoOrder() {
      var order = [];
      grid.querySelectorAll('.photo-tile').forEach(function (t) {
        order.push(Number(t.dataset.slot));
      });
      postJson('/profile/photos/reorder', { order: order })
        .then(function () { window.location.reload(); })
        .catch(function () { window.location.reload(); });
    }
  }

  initPhotoViewers();
  maybeRecycledToast();
})();
