"""Debug: like cards one by one as Abel, print card id + URL after each like."""
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3102"
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 390, "height": 844})
    page.goto(BASE + "/signin")
    page.fill('input[name="login"]', "0922000111")
    page.fill('input[name="password"]', "password123")
    page.click('button[type="submit"]')
    page.wait_for_url("**/discover**", timeout=10000)
    # reset passes first so all 9 are available
    page.evaluate("fetch('/discover/reset-passes', {method:'POST', headers:{'X-Requested-With':'XMLHttpRequest','Content-Type':'application/x-www-form-urlencoded'}, body:'', credentials:'same-origin'})")
    page.goto(BASE + "/discover")
    page.wait_for_timeout(800)
    for i in range(9):
        card = page.query_selector(".swipe-card:not(.peek)")
        if not card:
            print(f"iter {i}: END STATE:", page.inner_text("body")[:120].replace("\n", " | "))
            break
        cid = card.get_attribute("data-card-id")
        name = page.inner_text(".swipe-name")
        page.click(".swipe-btn.like")
        page.wait_for_timeout(1200)
        print(f"iter {i}: liked card {cid} ({name}) -> url {page.url}")
        if "/match/" in page.url:
            print("MATCH!")
            break
    b.close()
