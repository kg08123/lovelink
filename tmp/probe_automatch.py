"""Probe: when exactly do Ruth/Sara auto-matches fire after Abel likes them?
Fresh server, sign in as Abel, like Ruth once, then poll Discover freeLeft
+ /matches every 5s for 100s and log changes with timestamps."""
import time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3103"

def free_left(page):
    page.goto(BASE + "/discover")
    page.wait_for_selector(".discover-top .pill.ok", timeout=10000)
    return page.query_selector(".discover-top .pill.ok").inner_text().strip()

def card_name(page):
    el = page.query_selector(".swipe-card:not(.peek) .swipe-name")
    return el.inner_text().strip() if el else None

def matches_count(page):
    page.goto(BASE + "/matches")
    page.wait_for_timeout(400)
    return page.content().count("/messages/")

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 390, "height": 844})
    page.goto(BASE + "/signin")
    page.fill('input[name="login"]', "0922000111")
    page.fill('input[name="password"]', "password123")
    page.click('button[type="submit"]')
    page.wait_for_url("**/discover**", timeout=10000)
    t0 = time.time()
    print("t=%.0fs freeLeft=%s matches=%d" % (0, free_left(page), matches_count(page)))
    page.goto(BASE + "/discover")
    page.wait_for_selector(".swipe-card:not(.peek)", timeout=10000)
    # find Ruth and like her
    for _ in range(12):
        name = card_name(page) or ""
        cid = page.query_selector(".swipe-card:not(.peek)").get_attribute("data-card-id")
        if "Ruth" in name:
            page.click(".swipe-btn.like")
            print("t=%.0fs LIKED Ruth" % (time.time() - t0))
            break
        page.click(".swipe-btn.pass")
        try:
            page.wait_for_function("(old) => { const el = document.querySelector('.swipe-card:not(.peek)'); return el && el.getAttribute('data-card-id') !== old; }", arg=cid, timeout=5000)
        except Exception:
            pass
    for i in range(20):
        time.sleep(5)
        print("t=%.0fs freeLeft=%s matches=%d" % (time.time() - t0, free_left(page), matches_count(page)))
    b.close()
