"""Remove-Explore + dark-mode test: swipe-only deck, clean end state, no /explore links, dark everywhere."""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3102"
fails = []

def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" | " + str(extra) if extra else ""))
    if not cond:
        fails.append(name)

def no_reload(page):
    return page.evaluate("window.__stay === 1 && window.__doc === document")

def card_id(page):
    el = page.query_selector(".swipe-card:not(.peek)")
    return el.get_attribute("data-card-id") if el else None

def drag_card(page, dx):
    box = page.query_selector(".swipe-card:not(.peek)").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(cx, cy)
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(cx + dx * i / 10, cy, steps=2)
        page.wait_for_timeout(15)
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
    check("signin reaches Discover", "/discover" in page.url, page.url)
    page.evaluate("window.__stay = 1; window.__doc = document")
    check("Discover card present", card_id(page) is not None, card_id(page))

    # --- drag left = pass, no reload ---
    first = card_id(page)
    drag_card(page, -220)
    page.wait_for_timeout(700)
    check("drag left passes, next card, no reload", card_id(page) not in (None, first) and no_reload(page), card_id(page))

    # --- drag right = like (match screen OR next card), no reload ---
    cur = card_id(page)
    drag_card(page, 220)
    page.wait_for_timeout(900)
    on_match = "/match/" in page.url
    if on_match:
        check("drag right liked -> match screen", True)
        page.goto(BASE + "/discover")
        page.wait_for_selector(".swipe-card:not(.peek)", timeout=10000)
        page.evaluate("window.__stay = 1; window.__doc = document")  # goto() resets the marker
    else:
        check("drag right liked -> next card, no reload", card_id(page) not in (None, cur) and no_reload(page), card_id(page))

    # --- pass all remaining cards via the pass button until end state ---
    for _ in range(12):
        if page.query_selector(".empty"):
            break
        cid = card_id(page)
        if not cid:
            break
        page.click(".swipe-btn.pass")
        page.wait_for_timeout(600)
        if card_id(page) == cid:
            page.wait_for_timeout(600)
    check("end state shows caught-up card", page.query_selector(".empty") is not None)
    body = page.inner_text("body")
    check("end state says You're all caught up", "all caught up" in body)
    check("end state has Show profiles again", "Show profiles again" in body)
    check("end state has NO user grid", page.query_selector(".explore-grid") is None and page.query_selector(".explore-card") is None)
    check("end state has NO tabs", page.query_selector(".tabs") is None)
    check("end state still no reload", no_reload(page))

    # --- drawer has no Explore link ---
    page.click("#menuBtn")
    page.wait_for_selector(".drawer.open", timeout=5000)
    drawer_links = page.eval_on_selector_all(".drawer-nav a", "els => els.map(e => e.getAttribute('href'))")
    check("drawer has NO /explore link", "/explore" not in drawer_links, drawer_links)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)

    # --- /explore redirects to /discover; no /explore links anywhere ---
    page.goto(BASE + "/explore")
    page.wait_for_url("**/discover**", timeout=10000)
    check("/explore redirects to /discover", "/discover" in page.url, page.url)
    links = page.eval_on_selector_all("a", "els => els.map(e => e.getAttribute('href')).filter(h => h && h.startsWith('/explore'))")
    check("no user-facing /explore links on Discover", links == [], links)

    # --- reset brings cards back ---
    page.goto(BASE + "/discover")
    page.wait_for_selector(".empty", timeout=10000)
    page.click(".js-reset-form button")
    page.wait_for_selector(".swipe-card:not(.peek)", timeout=10000)
    check("reset brings cards back", card_id(page) is not None, card_id(page))

    # ================= DARK MODE =================
    page.goto(BASE + "/settings")
    page.wait_for_selector("#themeToggle", timeout=10000)
    check("Settings has Dark mode toggle", page.query_selector("#themeToggle") is not None)
    check("starts light", not page.evaluate("document.documentElement.classList.contains('dark')"))
    page.evaluate("window.__stay = 1; window.__doc = document")
    page.click(".theme-switch")
    page.wait_for_timeout(400)
    check("toggle flips to dark instantly, no reload", page.evaluate("document.documentElement.classList.contains('dark')") and no_reload(page))
    bg = page.evaluate("getComputedStyle(document.body).backgroundColor")
    check("dark body background near-black", bg in ("rgb(18, 18, 20)", "rgb(18,18,20)"), bg)
    ink = page.evaluate("getComputedStyle(document.body).color")
    check("dark body text light", ink not in ("rgb(26, 26, 26)", "rgb(0, 0, 0)"), ink)
    cookie = page.evaluate("document.cookie")
    check("theme cookie set", "theme=dark" in cookie, cookie)
    check("theme localStorage set", page.evaluate("localStorage.getItem('theme')") == "dark")
    page.screenshot(path="preview/dark-settings.png")

    # reload keeps dark (cookie -> server renders class)
    page.goto(BASE + "/discover")
    page.wait_for_selector(".swipe-card:not(.peek)", timeout=10000)
    check("dark survives reload", page.evaluate("document.documentElement.classList.contains('dark')"))
    sec_bg = page.evaluate("getComputedStyle(document.querySelector('.swipe-btn')).backgroundColor")
    check("dark swipe button dark", sec_bg in ("rgb(35, 35, 40)", "rgb(35,35,40)"), sec_bg)
    page.screenshot(path="preview/dark-discover.png")

    # matches / messages / profile / public profile / premium in dark
    page.goto(BASE + "/matches")
    page.wait_for_timeout(600)
    check("Matches dark", page.evaluate("document.documentElement.classList.contains('dark')"))
    page.goto(BASE + "/messages")
    page.wait_for_timeout(600)
    check("Messages dark", page.evaluate("document.documentElement.classList.contains('dark')"))
    page.goto(BASE + "/profile")
    page.wait_for_timeout(600)
    check("My Profile dark", page.evaluate("document.documentElement.classList.contains('dark')"))
    sec = page.evaluate("(()=>{const s=document.querySelector('.section'); return s?getComputedStyle(s).backgroundColor:'none'})()")
    check("dark section card dark", sec in ("rgb(29, 29, 33)", "rgb(29,29,33)"), sec)
    page.goto(BASE + "/premium")
    page.wait_for_timeout(600)
    check("Premium dark", page.evaluate("document.documentElement.classList.contains('dark')"))

    # chat thread in dark: like cards until a match, then open the thread
    # (passes were cleared above by the earlier pass-all, so reset first)
    page.goto(BASE + "/discover")
    page.wait_for_timeout(500)
    if page.query_selector(".empty"):
        page.click(".js-reset-form button")
        page.wait_for_selector(".swipe-card:not(.peek)", timeout=10000)
    matched = False
    for _ in range(7):
        page.goto(BASE + "/discover")
        try:
            page.wait_for_selector(".swipe-card:not(.peek)", timeout=8000)
        except Exception:
            break
        page.click(".swipe-btn.like")
        page.wait_for_timeout(900)
        if "/match/" in page.url:
            matched = True
            break
        if page.query_selector(".empty"):
            break
    check("got a match for chat test", matched)
    if matched:
        page.click("text=Chat now")
        page.wait_for_url("**/messages/**", timeout=10000)
        page.wait_for_timeout(500)
        check("chat thread dark", page.evaluate("document.documentElement.classList.contains('dark')"))
        page.fill(".chatbar input[name=\"body\"]", "dark mode test")
        page.click(".chatbar button[type=submit]")
        page.wait_for_timeout(800)
        bubble = page.evaluate("(()=>{const b=document.querySelector('.bubble.mine'); return b?getComputedStyle(b).backgroundImage.slice(0,30):'none'})()")
        check("mine bubble readable (pink gradient)", "linear-gradient" in bubble, bubble)
        page.screenshot(path="preview/dark-chat.png")

    # auth pages stay dark after sign out (cookie persists)
    page.goto(BASE + "/signout")
    page.wait_for_url("**/", timeout=10000)
    page.goto(BASE + "/signup")
    page.wait_for_timeout(600)
    check("signup dark after signout", page.evaluate("document.documentElement.classList.contains('dark')"))
    page.goto(BASE + "/signin")
    page.wait_for_timeout(600)
    check("signin dark", page.evaluate("document.documentElement.classList.contains('dark')"))

    # toggle back to light
    page.fill('input[name="login"]', "0922000111")
    page.fill('input[name="password"]', "password123")
    page.click('button[type="submit"]')
    page.wait_for_url("**/discover**", timeout=10000)
    page.goto(BASE + "/settings")
    page.wait_for_selector("#themeToggle", timeout=10000)
    page.click(".theme-switch")
    page.wait_for_timeout(400)
    check("toggle back to light", not page.evaluate("document.documentElement.classList.contains('dark')"))
    check("light body background restored", page.evaluate("getComputedStyle(document.body).backgroundColor") in ("rgb(250, 247, 248)", "rgb(250,247,248)"))

    # system-preference default: fresh context, dark scheme, no cookie
    ctx2 = b.new_context(viewport={"width": 390, "height": 844}, color_scheme="dark")
    p2 = ctx2.new_page()
    p2.goto(BASE + "/signin")
    p2.wait_for_timeout(800)
    check("system dark preference -> dark by default", p2.evaluate("document.documentElement.classList.contains('dark')"))
    ctx3 = b.new_context(viewport={"width": 390, "height": 844}, color_scheme="light")
    p3 = ctx3.new_page()
    p3.goto(BASE + "/signin")
    p3.wait_for_timeout(800)
    check("system light preference -> light by default", not p3.evaluate("document.documentElement.classList.contains('dark')"))

    # no horizontal overflow anywhere dark
    for url in ["/discover", "/matches", "/messages", "/profile", "/settings"]:
        page.goto(BASE + url)
        page.wait_for_timeout(400)
        ow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        check(f"no h-overflow on {url}", not ow)

    print("CONSOLE ERRORS:", errors if errors else "none")
    check("no console/page errors", not errors, errors[:3])
    b.close()

print("\n" + ("ALL PASS" if not fails else f"FAILURES: {fails}"))
sys.exit(1 if fails else 0)
