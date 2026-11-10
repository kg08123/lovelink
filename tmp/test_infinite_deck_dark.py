"""Infinite deck + top-bar dark-mode icon test.
- Pass the whole deck -> recycled profiles appear, NO 'caught up' card.
- Like Ruth (non-pre-liker) -> pass through -> like her again (re-like):
  no error, no duplicate match, free-match count unchanged.
- Pass Sara -> recycle -> like her (pass->like upgrade): normal like flow.
- Top-bar moon/sun icon flips theme, stays in sync with Settings switch,
  choice survives reload. No console errors, no horizontal overflow.
"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3103"
fails = []

def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" | " + str(extra) if extra else ""))
    if not cond:
        fails.append(name)

def card_id(page):
    el = page.query_selector(".swipe-card:not(.peek)")
    return el.get_attribute("data-card-id") if el else None

def card_name(page):
    el = page.query_selector(".swipe-card:not(.peek) .swipe-name")
    return el.inner_text().strip() if el else None

def free_left(page):
    pill = page.query_selector(".discover-top .pill.ok")
    return pill.inner_text().strip() if pill else "?"

def wait_card_change(page, old, timeout=5000):
    try:
        page.wait_for_function(
            "(old) => { const el = document.querySelector('.swipe-card:not(.peek)'); return el && el.getAttribute('data-card-id') !== old; }",
            arg=old, timeout=timeout)
        return True
    except Exception:
        return False

def swipe_btn(page, cls):
    page.click(".swipe-btn." + cls)
    page.wait_for_timeout(350)

def drag_card(page, dx):
    box = page.query_selector(".swipe-card:not(.peek)").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(cx, cy)
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(cx + dx * i / 10, cy, steps=2)
        page.wait_for_timeout(12)
    page.mouse.up()

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 390, "height": 844})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(BASE + "/signin")
    page.fill('input[name="login"]', "0922000111")
    page.fill('input[name="password"]', "password123")
    page.click('button[type="submit"]')
    page.wait_for_url("**/discover**", timeout=10000)
    page.evaluate("window.__stay = 1; window.__doc = document")
    check("signin reaches Discover", "/discover" in page.url, page.url)
    check("top-bar theme icon present", page.query_selector("#themeBtn") is not None)
    check("free matches start at 3", free_left(page).startswith("3 / 3"), free_left(page))
    first = card_id(page)
    check("Discover card present", first is not None, first)

    # --- Deck 1: pass everyone except like Ruth when she appears ---
    liked_ruth = False
    seen = []
    for _ in range(15):
        if page.query_selector(".empty"):
            break
        name = card_name(page) or ""
        cid = card_id(page)
        if "Ruth" in name and not liked_ruth:
            swipe_btn(page, "like")
            liked_ruth = True
            if "/match/" in page.url:  # unexpected: Ruth should not pre-like
                page.goto(BASE + "/discover")
                page.wait_for_selector(".swipe-card:not(.peek)", timeout=10000)
            else:
                wait_card_change(page, cid)
        else:
            swipe_btn(page, "pass")
            wait_card_change(page, cid)
        if card_id(page):
            seen.append(card_id(page))
        if "Showing profiles again" in page.inner_text("body"):
            break
    check("liked Ruth in deck 1", liked_ruth)
    check("recycled note appears, NO caught-up card",
          "Showing profiles again" in page.inner_text("body") and page.query_selector(".empty") is None)
    check("free matches still 3 after liking Ruth (no match yet)", free_left(page).startswith("3 / 3"), free_left(page))
    check("no reload during deck 1", page.evaluate("window.__stay === 1 && window.__doc === document"))

    # --- Re-like Ruth on the recycled deck (must be a no-op, not a 2nd match) ---
    found_ruth = False
    for _ in range(15):
        name = card_name(page) or ""
        cid = card_id(page)
        if "Ruth" in name:
            before = free_left(page)
            swipe_btn(page, "like")
            found_ruth = True
            if "/match/" in page.url:
                check("re-like Ruth does NOT navigate to match screen", False, page.url)
                page.goto(BASE + "/discover")
                page.wait_for_selector(".swipe-card:not(.peek)", timeout=10000)
            else:
                wait_card_change(page, cid)
            check("re-like Ruth: no match screen", "/match/" not in page.url)
            check("re-like Ruth: free matches unchanged", free_left(page) == before, free_left(page))
            check("re-like Ruth: next card appears, no reload",
                  card_id(page) not in (None, cid) and page.evaluate("window.__stay === 1 && window.__doc === document"))
            break
        swipe_btn(page, "pass")
        wait_card_change(page, cid)
    check("Ruth found again on recycled deck", found_ruth)
    page.screenshot(path="preview/recycled-deck.png")

    # --- Pass->like upgrade: pass Sara in deck 1 already happened; like her now ---
    found_sara = False
    for _ in range(15):
        name = card_name(page) or ""
        cid = card_id(page)
        if "Sara" in name:
            swipe_btn(page, "like")
            found_sara = True
            if "/match/" in page.url:  # Sara should not pre-like either
                check("like recycled Sara: unexpected match screen", False, page.url)
                page.goto(BASE + "/discover")
                page.wait_for_selector(".swipe-card:not(.peek)", timeout=10000)
            else:
                wait_card_change(page, cid)
            check("like recycled Sara (pass->like): normal flow, next card",
                  card_id(page) not in (None, cid))
            break
        swipe_btn(page, "pass")
        wait_card_change(page, cid)
    check("Sara found again on recycled deck", found_sara)

    # --- Drag still works on a recycled card; loop keeps going, never empty ---
    cur = card_id(page)
    drag_card(page, -220)
    page.wait_for_timeout(700)
    check("drag left on recycled card passes, no reload",
          card_id(page) not in (None, cur) and page.evaluate("window.__stay === 1 && window.__doc === document"))
    for _ in range(12):
        if page.query_selector(".empty"):
            break
        cid = card_id(page)
        if not cid:
            break
        swipe_btn(page, "pass")
        wait_card_change(page, cid)
    check("deck never empties after full second loop", page.query_selector(".empty") is None
          and card_id(page) is not None)

    # --- Dark mode top-bar icon <-> Settings switch sync + persistence ---
    check("theme icon shows moon in light mode",
          page.query_selector("#themeBtn .theme-ico-moon") is not None)
    page.click("#themeBtn")
    page.wait_for_timeout(300)
    check("top-bar icon flips to dark instantly",
          page.evaluate("document.documentElement.classList.contains('dark')"))
    check("top-bar icon aria-pressed true",
          page.get_attribute("#themeBtn", "aria-pressed") == "true")
    page.goto(BASE + "/settings")
    page.wait_for_selector("#themeToggle", timeout=10000)
    check("Settings switch shows dark (in sync)", page.is_checked("#themeToggle"))
    page.screenshot(path="preview/dark-settings.png")
    page.click("#themeToggle", force=True)  # label's track sits above the hidden input; force bypasses hit-test
    page.wait_for_timeout(300)
    check("Settings switch flips back to light",
          not page.evaluate("document.documentElement.classList.contains('dark')"))
    page.goto(BASE + "/discover")
    page.wait_for_selector("#themeBtn", timeout=10000)
    check("top-bar icon in sync after Settings change (light)",
          page.get_attribute("#themeBtn", "aria-pressed") == "false")
    page.click("#themeBtn")  # dark again via top bar
    page.wait_for_timeout(300)
    page.reload()
    page.wait_for_selector("#themeBtn", timeout=10000)
    check("dark choice survives reload (no white flash path)",
          page.evaluate("document.documentElement.classList.contains('dark')"))
    page.wait_for_selector(".swipe-card:not(.peek)", timeout=10000)
    page.screenshot(path="preview/dark-discover.png")

    # --- No console errors, no horizontal overflow ---
    check("no console/page errors", len(errors) == 0, errors[:3])
    overflow = page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
    check("no horizontal overflow", not overflow)

    b.close()

print("\n%d FAILURES" % len(fails) if fails else "\nALL PASS")
sys.exit(1 if fails else 0)
