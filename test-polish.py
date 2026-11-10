"""LoveLink polish pass test (390x844, Abel demo user)."""
import json, re, sys, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = "/home/hatch/workspace/lovelink/preview"
errors, failed = [], []

def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(extra)) if extra and not cond else ""))
    if not cond:
        failed.append(name)

def overflow(page):
    return page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")

def shot(page, name):
    page.screenshot(path=f"{OUT}/{name}")

with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    # --- manifest + SW files (plain HTTP, no browser needed) ---
    man = json.loads(urllib.request.urlopen(BASE + "/manifest.webmanifest").read())
    check("manifest: name LoveLink", man.get("name") == "LoveLink", man.get("name"))
    check("manifest: display standalone", man.get("display") == "standalone", man.get("display"))
    check("manifest: theme #121214", man.get("theme_color") == "#121214")
    check("manifest: 192+512 icons", any(i["sizes"] == "192x192" for i in man["icons"]) and any(i["sizes"] == "512x512" for i in man["icons"]))
    for u in ("/img/icon-192.png", "/img/icon-512.png", "/sw.js", "/offline.html"):
        check(f"static {u} 200", urllib.request.urlopen(BASE + u).status == 200)

    # --- login as Abel ---
    page.goto(BASE + "/signin")
    page.fill('input[name=login]', "0922000111")
    page.fill('input[name=password]', "password123")
    page.click('button[type=submit]')
    page.wait_for_url("**/discover", timeout=10000)
    check("login -> discover", "/discover" in page.url, page.url)
    page.wait_for_selector(".fs-card", timeout=10000)
    time.sleep(0.6)

    # --- 1. story bars ALWAYS visible ---
    bars = page.query_selector_all(".story-bars .story-bar")
    check("story bars present (even single photo)", len(bars) >= 1, len(bars))
    vis = page.evaluate("""() => { const el = document.querySelector('.story-bars'); if (!el) return null;
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      return {top: r.top, h: r.height, visible: cs.display !== 'none' && cs.visibility !== 'hidden' && r.height > 0}; }""")
    check("story bars visible at top of card", bool(vis and vis["visible"] and vis["top"] < 40), vis)
    print("first card:", page.inner_text(".swipe-name").strip(), "| bars:", len(bars))

    # --- 2. Online text ---
    check("Online text next to name", page.query_selector(".online-txt") is not None)

    # --- 3. one info box, no two pills ---
    check("one info box present", page.query_selector(".fs-infobox") is not None)
    check("old two pills gone", page.query_selector(".fs-pills") is None and page.query_selector(".fs-pill") is None)
    print("infobox:", page.inner_text(".fs-infobox").replace("\n", " | "))

    # --- 4. outline buttons (computed styles) ---
    cs = page.evaluate("""() => { const g = s => { const el = document.querySelector(s); if (!el) return null;
      const c = getComputedStyle(el); return {bg: c.backgroundColor, bgImg: c.backgroundImage, border: c.borderTopColor + ' ' + c.borderTopWidth, color: c.color, w: c.width}; };
      return {pass: g('.fs-actions .swipe-btn.pass'), msg: g('.fs-actions .swipe-btn.msg'), like: g('.fs-actions .swipe-btn.like')}; }""")
    print("buttons:", json.dumps(cs))
    check("pass btn transparent bg", cs["pass"] and cs["pass"]["bg"].startswith("rgba(0, 0, 0, 0"), cs["pass"])
    check("pass btn pink border", cs["pass"] and "255, 46, 99" in cs["pass"]["border"], cs["pass"])
    check("msg btn transparent bg", cs["msg"] and cs["msg"]["bg"].startswith("rgba(0, 0, 0, 0"), cs["msg"])
    check("like btn pink gradient + bigger", cs["like"] and "255, 46, 99" in cs["like"]["bgImg"] and float(cs["like"]["w"].replace("px", "")) > 70, cs["like"])

    # --- 5. expand chevron ---
    check("expand chevron present", page.query_selector(".fs-expand") is not None)
    check("chevron links to public profile", (page.query_selector(".fs-expand").get_attribute("href") or "").startswith("/u/"))

    # --- 6. bottom nav: no active pill ---
    nav = page.evaluate("""() => { const a = document.querySelector('.bottomnav a.on'); if (!a) return null;
      const c = getComputedStyle(a); return {bg: c.backgroundColor, color: c.color}; }""")
    print("nav active:", nav)
    check("nav active has NO pill background", nav and nav["bg"] in ("rgba(0, 0, 0, 0)", "transparent"), nav)
    check("nav active icon is pink", nav and "255, 46, 99" in nav["color"], nav)
    check("nav: 4 icons, no labels", re.sub(r"\d+", "", page.inner_text(".bottomnav")).strip() == "")

    # --- 7. full-bleed photo: card bottom reaches the nav, no black gap ---
    geo = page.evaluate("""() => { const card = document.querySelector('.swipe-card:not(.peek)'); const nav = document.querySelector('.bottomnav');
      const cr = card.getBoundingClientRect(); const nr = nav.getBoundingClientRect();
      return {cardTop: cr.top, cardBottom: cr.bottom, navTop: nr.top, vh: window.innerHeight}; }""")
    print("geometry:", geo)
    check("photo starts at viewport top", geo["cardTop"] <= 1, geo)
    check("photo reaches the nav (gap < 4px)", geo["navTop"] - geo["cardBottom"] < 4, geo)
    check("no h-overflow on Discover", overflow(page) <= 0, overflow(page))
    shot(page, "ref2-discover.png")

    # --- drag still works (left = pass) ---
    name1 = page.inner_text(".swipe-name").strip()
    box = page.query_selector(".swipe-card:not(.peek)").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(cx, cy); page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(cx - i * 15, cy, steps=1); time.sleep(0.03)
    page.mouse.up(); time.sleep(1.2)
    name2 = page.inner_text(".swipe-name").strip()
    check("drag left passes to next card", name2 != name1, f"{name1} -> {name2}")
    check("story bars still present on 2nd card", len(page.query_selector_all(".story-bars .story-bar")) >= 1)

    # --- chevron opens the public profile ---
    page.click(".fs-expand")
    page.wait_for_url("**/u/**", timeout=10000)
    check("chevron -> public profile", "/u/" in page.url, page.url)
    time.sleep(0.4)
    check("public profile: story bars present", len(page.query_selector_all(".story-bars .story-bar")) >= 1)
    check("public profile: no h-overflow", overflow(page) <= 0, overflow(page))
    shot(page, "ref2-public-profile.png")

    # --- Likes / Settings / Profile / Chat: no regressions ---
    page.goto(BASE + "/likes")
    page.wait_for_selector(".likes-grid, .likes-empty", timeout=10000); time.sleep(0.4)
    check("likes: no h-overflow", overflow(page) <= 0, overflow(page))
    shot(page, "ref2-likes.png")
    page.goto(BASE + "/settings")
    page.wait_for_selector("#themeToggle", timeout=10000); time.sleep(0.4)
    check("settings: no h-overflow", overflow(page) <= 0, overflow(page))
    shot(page, "ref2-settings.png")
    page.goto(BASE + "/profile")
    page.wait_for_selector(".me-photo, .photo-grid, .photo-tile", timeout=10000); time.sleep(0.4)
    check("profile: no h-overflow", overflow(page) <= 0, overflow(page))
    shot(page, "ref2-profile.png")
    page.goto(BASE + "/messages")
    page.wait_for_selector(".chat-item, .empty", timeout=10000); time.sleep(0.4)
    check("messages: no h-overflow", overflow(page) <= 0, overflow(page))
    shot(page, "ref2-messages.png")
    # open first chat thread if any
    first = page.query_selector(".chat-item[href^='/messages/']")
    if first:
        first.click()
        page.wait_for_selector(".chat-thread, .chat-input, .empty", timeout=10000); time.sleep(0.4)
        check("chat thread: no h-overflow", overflow(page) <= 0, overflow(page))
        shot(page, "ref2-chat.png")
    else:
        print("no chat threads yet — skipping thread shot")

    # --- service worker registers (http://localhost is a secure context) ---
    sw = page.evaluate("""() => navigator.serviceWorker ? navigator.serviceWorker.getRegistration().then(r => !!r).catch(() => false) : false""")
    # getRegistration returns a promise; evaluate above returns promise -> playwright resolves it
    check("service worker registered", sw is True, sw)

    print("\n--- console errors ---")
    for e in errors:
        print(" ", e)
    check("no console errors", len(errors) == 0, errors[:5])

    print("\n%d checks failed: %s" % (len(failed), failed))
    b.close()
    sys.exit(1 if failed else 0)
