"""LoveLink ref6 test: loading screen, selfie verification, recently-online,
15 new modern demos (390x844, USE_PGMEM=1)."""
import os, re, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = "/home/hatch/workspace/lovelink/preview"
ROOT = "/home/hatch/workspace/lovelink"
SELFIE = ROOT + "/public/img/demo-abel.jpg"
# Filled in once the photo manifest lands (item 3).
NEW_GIRLS = ["Ayana Bekele", "Helen Teshome", "Feven Girma", "Kidist Alemu", "Mihret Haile",
             "Yodit Fikre", "Netsanet Worku", "Genet Tadesse", "Almaz Kassa", "Eyerusalem Gebru"]
NEW_BOYS = ["Yared Tesfaye", "Fikre Alemayehu", "Samson Haile", "Getnet Berhe", "Mikiyas Worku"]
errors, failed = [], []

def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(extra)) if extra and not cond else ""))
    if not cond:
        failed.append(name)

def overflow(page):
    return page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")

def signin(page, phone):
    page.goto(BASE + "/signin")
    page.fill('input[name=login]', phone)
    page.fill('input[name=password]', "password123")
    page.click('button[type=submit]')
    page.wait_for_url("**/discover", timeout=10000)
    page.wait_for_selector(".fs-card", timeout=10000)
    time.sleep(0.5)

def make_user_page(b, phone, password="password123"):
    # Separate browser context per user: /signin redirects an already
    # signed-in session to /discover, so one shared page cannot re-sign-in.
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    p = ctx.new_page()
    p.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    p.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))
    p.goto(BASE + "/signin")
    p.fill('input[name=login]', phone)
    p.fill('input[name=password]', password)
    p.click('button[type=submit]')
    p.wait_for_url("**/admin" if password == "admin123" else "**/discover", timeout=10000)
    time.sleep(0.5)
    return p

def card_name(page):
    return page.evaluate("() => { const el = document.querySelector('.fs-card:not(.peek) .swipe-name .nm'); return el ? el.textContent.trim() : null; }")

def pass_card(page):
    page.click(".fs-actions .swipe-btn.pass")
    time.sleep(0.9)

boot_t = time.time()
env = dict(os.environ, USE_PGMEM="1", PORT="3000")
srv = subprocess.Popen(["node", "server.js"], cwd=ROOT, env=env,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(30):
        try:
            urllib.request.urlopen(BASE + "/health", timeout=2)
            break
        except Exception:
            time.sleep(1)

    with sync_playwright() as pw:
        b = pw.chromium.launch()
        page = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

        signin_admin = make_user_page(b, "0911000000", "admin123")
        selam = make_user_page(b, "0922000222")
        adminPage, selamPage = signin_admin, selam

        # fresh seed count: 46 demo users (role='user'; admin is not counted)
        adminPage.goto(BASE + "/admin")
        adminPage.wait_for_selector(".box", timeout=10000)
        boxes = adminPage.query_selector_all(".box")
        first_box = boxes[0].inner_text().strip() if boxes else ""
        check("seed: 46 demo users (31 old + 15 new)", first_box.startswith("46"), first_box)

        # ---------- 1. Loading screen ----------
        page.goto(BASE + "/signin")
        page.fill('input[name=login]', "0922000111")
        page.fill('input[name=password]', "password123")
        page.click('button[type=submit]')
        page.wait_for_url("**/discover", timeout=10000)
        # catch it mid-load (fade starts at ~900ms)
        time.sleep(0.35)
        lo = page.query_selector("#discoverLoading")
        check("loading overlay present on Discover open", lo is not None)
        if lo:
            vis = page.evaluate("""() => { const el = document.getElementById('discoverLoading');
              const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
              return {visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 100,
                      title: (el.querySelector('.dl-title')||{}).textContent,
                      sub: (el.querySelector('.dl-sub')||{}).textContent}; }""")
            check("loading overlay visible with title", bool(vis and vis["visible"] and "Finding Your Matches" in (vis["title"] or "")), vis)
            check("loading subtitle 'near you'", bool(vis and "Finding people near you" in (vis["sub"] or "")), vis)
            nav = page.evaluate("""() => { const n = document.querySelector('.bottomnav'); if (!n) return null;
              const r = n.getBoundingClientRect(); return {z: getComputedStyle(n).zIndex, bottom: r.bottom, h: r.height}; }""")
            check("bottom nav visible above overlay", bool(nav and nav["h"] > 40 and nav["bottom"] > 800), nav)
            page.screenshot(path=f"{OUT}/ref6-loading.png")
        page.wait_for_selector(".fs-card", timeout=10000)
        time.sleep(1.2)
        check("loading overlay gone after card ready", page.query_selector("#discoverLoading") is None)
        check("discover no overflow", overflow(page) == 0, overflow(page))

        # ---------- 2a. /verify page renders like the reference ----------
        page.goto(BASE + "/verify")
        page.wait_for_selector(".verify-page", timeout=10000)
        check("verify: title Get Verified", "Get Verified" in page.inner_text(".verify-title"))
        check("verify: info card present", "Take a selfie matching the pose" in page.inner_text(".verify-info"))
        check("verify: pose image or SVG guide", page.query_selector(".verify-pose img") is not None or page.query_selector(".verify-pose-svg") is not None)
        check("verify: camera input present", page.query_selector('input[name=selfie][capture="user"]') is not None)
        check("verify: Take Selfie button", page.query_selector("#verifyTakeLabel") is not None)
        check("verify: privacy note", "only used for verification" in page.inner_text(".verify-privacy"))
        check("verify: 24h note", "Usually verified within 24 hours" in page.inner_text(".verify-24h"))
        page.screenshot(path=f"{OUT}/ref6-verify.png")
        check("verify no overflow", overflow(page) == 0, overflow(page))
        # help "?" toggles the explanation
        page.click("#verifyHelpBtn")
        check("verify: help explains the flow", page.query_selector("#verifyHelp") is not None and "real person" in page.inner_text("#verifyHelp"))

        # ---------- 2b. Abel submits a selfie -> admin queue -> approve -> badge ----------
        page.set_input_files("#verifySelfieInput", SELFIE)
        page.wait_for_selector("#verifyPreview:not([hidden])", timeout=5000)
        check("verify: preview shown after capture", page.query_selector("#verifyPreviewImg") is not None)
        page.click("#verifySend")
        page.wait_for_url("**/verify", timeout=10000)
        time.sleep(0.6)
        check("verify: pending state after send", "waiting for review" in page.inner_text("body").lower() or "Pending review" in page.inner_text("body"))

        adminPage.goto(BASE + "/admin/verifications")
        adminPage.wait_for_selector("h1", timeout=10000)
        body = adminPage.inner_text("body")
        check("admin queue: Abel pending row", "Abel Tesfaye" in body, body[:400])
        check("admin queue: selfie + profile photo shown", len(adminPage.query_selector_all(".verify-admin-photos img")) >= 2)
        adminPage.screenshot(path=f"{OUT}/ref6-verify-admin.png")
        check("admin queue no overflow", overflow(adminPage) == 0, overflow(adminPage))
        adminPage.click(".verify-admin-actions form[action$='/approve'] button")
        adminPage.wait_for_url("**/admin/verifications", timeout=10000)
        time.sleep(0.5)
        # Approved rows move to the "Recently reviewed" table below, so the
        # pending count (not the name) is the signal.
        check("admin queue: Abel no longer pending", "Pending Verifications (0)" in adminPage.inner_text("body"))

        # badge on Abel's public profile (seen as Selam)
        # Abel's id: from the admin users page
        adminPage.goto(BASE + "/admin/users")
        users_html = adminPage.content()
        m = re.search(r'/admin/users/(\d+)"[^>]*>\s*Abel Tesfaye', users_html)
        abel_id = m.group(1) if m else None
        check("admin users: Abel id found", abel_id is not None)
        selamPage.goto(BASE + "/u/" + abel_id)
        selamPage.wait_for_selector(".pub-hero, .pub-name-row", timeout=10000)
        check("badge: verified badge on Abel public profile", selamPage.query_selector(".verified-badge") is not None)
        check("public profile no overflow", overflow(selamPage) == 0, overflow(selamPage))

        # ---------- 2c. Reject path: Selam submits, admin rejects, retake works ----------
        selamPage.goto(BASE + "/verify")
        selamPage.wait_for_selector(".verify-page", timeout=10000)
        selamPage.set_input_files("#verifySelfieInput", SELFIE)
        selamPage.wait_for_selector("#verifyPreview:not([hidden])", timeout=5000)
        selamPage.click("#verifySend")
        selamPage.wait_for_url("**/verify", timeout=10000)
        time.sleep(0.5)
        adminPage.goto(BASE + "/admin/verifications")
        body = adminPage.inner_text("body")
        check("admin queue: Selam pending row", "Selam Tesfaye" in body)
        adminPage.click(".verify-admin-actions form[action$='/reject'] button")
        adminPage.wait_for_url("**/admin/verifications", timeout=10000)
        time.sleep(0.5)
        selamPage.goto(BASE + "/verify")
        selamPage.wait_for_selector(".verify-page", timeout=10000)
        check("verify: rejected state shown", "couldn't verify your selfie" in selamPage.inner_text("body").lower())
        check("verify: retake button present after reject", selamPage.query_selector("#verifyTakeLabel") is not None)

        # ---------- 4. Recently Online (amber) ----------
        # Demos were seeded at boot; after 5 min their last_active is stale
        # enough for 'recent' (<24h) but no longer 'online' (<5 min).
        # Seed runs ~15s after boot_t, so wait 345s to clear the window.
        # The FIRST card can still be green (Selam signed in during this
        # test, refreshing her own last_active) — so look at up to 5 cards
        # and require ANY of them to show the amber label.
        wait = 345 - (time.time() - boot_t)
        if wait > 0:
            print(f"waiting {wait:.0f}s for the 5-min online window to pass...")
            time.sleep(wait)
        page.goto(BASE + "/discover")
        page.wait_for_selector(".fs-card", timeout=10000)
        time.sleep(1.2)
        amber_found = False
        amber_label = None
        for _ in range(5):
            label = page.evaluate("""() => { const t = document.querySelector('.online-txt');
              if (!t) return null; return {text: t.textContent.trim(), cls: t.className,
              dot: (document.querySelector('.fs-online-dot')||{}).className}; }""")
            if label and "Recently Online" in label["text"] and "recent" in label["cls"]:
                amber_found = True
                amber_label = label
                break
            if not label:
                break
            pass_card(page)
        check("recently online: amber label on a card", amber_found, amber_label)
        page.screenshot(path=f"{OUT}/ref6-recently-online.png")
        check("discover (recent) no overflow", overflow(page) == 0, overflow(page))

        # ---------- 3. New demos (only when manifest names are set) ----------
        if NEW_GIRLS or NEW_BOYS:
            page.goto(BASE + "/discover")
            page.wait_for_selector(".fs-card", timeout=10000)
            time.sleep(0.5)
            seen = set()
            for _ in range(60):
                n = card_name(page)
                if not n:
                    break
                if n in seen:
                    break
                seen.add(n)
                pass_card(page)
            print("girls seen as Abel:", sorted(seen))
            for g in NEW_GIRLS:
                check(f"new girl in deck: {g}", any(n.startswith(g + ",") for n in seen))
            page.screenshot(path=f"{OUT}/ref6-new-demos.png")
            selamPage.goto(BASE + "/discover")
            selamPage.wait_for_selector(".fs-card", timeout=10000)
            time.sleep(0.5)
            seen_b = set()
            for _ in range(40):
                n = card_name(selamPage)
                if not n:
                    break
                if n in seen_b:
                    break
                seen_b.add(n)
                pass_card(selamPage)
            print("boys seen as Selam:", sorted(seen_b))
            for bname in NEW_BOYS:
                check(f"new boy in deck: {bname}", any(n.startswith(bname + ",") for n in seen_b))

    # ---------- presence unit checks (no browser) ----------
    r = subprocess.run(["node", "-e",
        "const {presenceOf}=require('./lib/presence');"
        "const n=Date.now();"
        "console.log(JSON.stringify(["
        "presenceOf(new Date(n-3*60000)),"
        "presenceOf(new Date(n-2*3600000)),"
        "presenceOf(new Date(n-2*86400000)),"
        "presenceOf(null),"
        "presenceOf(new Date(n-4*60000)),"
        "presenceOf(new Date(n-23*3600000))]));"],
        cwd=ROOT, capture_output=True, text=True)
    vals = r.stdout.strip().splitlines()[-1] if r.stdout.strip() else ""
    import json as _json
    vals = _json.loads(vals) if vals else []
    check("presence unit: 3min=online, 2h=recent, 2d=none, null=none, 4min=online, 23h=recent",
          vals == ["online", "recent", "none", "none", "online", "recent"], vals)

    # badge rule: no email_verified left in the verified-badge render path
    disc = open(ROOT + "/routes/discover.js").read()
    check("badge rule: discover.js verified uses selfie_verified",
          "selfie_verified || c.is_demo" in disc and "email_verified || c.is_demo" not in disc)
    msgs = open(ROOT + "/routes/messages.js").read()
    check("badge rule: messages.js verified uses selfie_verified",
          "other_selfie_verified || c.other_is_demo" in msgs)

    print("\nconsole errors:", errors)
    check("zero console errors", not errors, errors[:5])
    print("\nFAILED:", failed if failed else "none")
    sys.exit(1 if failed else 0)
finally:
    srv.terminate()
    try:
        srv.wait(timeout=5)
    except Exception:
        srv.kill()
