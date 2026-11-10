"""Debug: heart click on swapped Online grid."""
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3102"
with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 390, "height": 844})
    page.on("console", lambda m: print("CONSOLE", m.type, m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: print("PAGEERROR", e))
    page.on("request", lambda r: print("REQ", r.method, r.url) if "grid-like" in r.url or "fragment" in r.url else None)
    page.on("response", lambda r: print("RES", r.status, r.url) if "grid-like" in r.url or "fragment" in r.url else None)
    page.goto(BASE + "/signin")
    page.fill('input[name="login"]', "0922000111")
    page.fill('input[name="password"]', "password123")
    page.click('button[type="submit"]')
    page.wait_for_url("**/discover**", timeout=10000)
    page.goto(BASE + "/explore")
    page.wait_for_selector("#explore-grid-root .explore-card", timeout=10000)
    page.evaluate("window.__stay = 1; window.__doc = document")
    page.click('.tabs a[href*="tab=online"]')
    page.wait_for_timeout(1200)
    print("after Online: url=", page.url, "stay=", page.evaluate("window.__stay"),
          "sameDoc=", page.evaluate("window.__doc === document"))
    heart = page.query_selector("#explore-grid-root .js-grid-like-form button")
    print("heart found:", bool(heart), "card:", page.evaluate(
        "document.querySelector('#explore-grid-root .js-grid-like-form')?.closest('.explore-card')?.querySelector('b')?.textContent"))
    if heart:
        heart.click()
        page.wait_for_timeout(1500)
        print("after heart: url=", page.url, "stay=", page.evaluate("window.__stay"),
              "sameDoc=", page.evaluate("window.__doc === document"),
              "tabs present=", page.query_selector(".tabs") is not None,
              "heart liked=", page.evaluate(
                  "document.querySelector('#explore-grid-root .js-grid-like-form button')?.classList.contains('liked')"))
    b.close()
