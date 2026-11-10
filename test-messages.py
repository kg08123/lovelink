"""LoveLink Messages inbox rebuild test (390x844, Abel demo user + fresh user + admin)."""
import re, time, random
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

def visible_rows(page):
    return page.evaluate("() => Array.from(document.querySelectorAll('#msg-list .msg-row')).filter(r => r.style.display !== 'none').map(r => r.getAttribute('data-name'))")

with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    # --- login as Abel, then like 2 cards so the inbox has real rows ---
    # (pre-likers match instantly with no message -> "New match!" row;
    #  others match via the 60s demo like-back sweep, which also sends a
    #  greeting message and a LoveLink match notification.)
    page.goto(BASE + "/signin")
    page.fill('input[name=login]', "0922000111")
    page.fill('input[name=password]', "password123")
    page.click('button[type=submit]')
    page.wait_for_url("**/discover", timeout=10000)
    page.wait_for_selector(".fs-card", timeout=10000)
    time.sleep(0.6)
    for i in range(2):
        page.click(".fs-actions .swipe-btn.like")
        time.sleep(1.0)
        page.goto(BASE + "/discover")
        page.wait_for_selector(".fs-card", timeout=10000)
        time.sleep(0.5)
    print("liked 2 cards; waiting 62s for the demo like-back sweep...")
    time.sleep(62)
    page.goto(BASE + "/messages")
    page.wait_for_selector(".msg-title", timeout=10000)
    time.sleep(0.5)

    # --- 1. title centered ---
    ta = page.evaluate("() => getComputedStyle(document.querySelector('.msg-title')).textAlign")
    check("title centered", ta == "center", ta)
    check("title text = Messages", page.inner_text(".msg-title").strip() == "Messages")
    check("no old section-head", page.query_selector(".section-head") is None)
    check("no old chat-item", page.query_selector(".chat-item") is None)

    # --- 2. rows ---
    rows = page.query_selector_all("#msg-list .msg-row")
    print("inbox rows:", len(rows))
    check("at least 1 row", len(rows) >= 1)
    names = [page.evaluate("(el) => el.getAttribute('data-name')", r) for r in rows]
    print("names:", names)
    check("LoveLink platform row present", "lovelink" in names, names)
    print("has New match! row:", page.query_selector(".msg-prev-new") is not None)
    # time label format: "6:21 AM" or "11/08/26"
    times = page.evaluate("() => Array.from(document.querySelectorAll('.msg-time')).map(e => e.textContent.trim())")
    print("times:", times)
    check("time labels in reference format",
          all(re.match(r"^(\d{1,2}:\d{2} [AP]M|\d{2}/\d{2}/\d{2})$", t) for t in times), times)
    # verified badge on LoveLink row
    check("LoveLink row has verified badge",
          page.evaluate("() => { const r = Array.from(document.querySelectorAll('.msg-row')).find(x => x.getAttribute('data-name') === 'lovelink'); return !!r && !!r.querySelector('.verified-badge'); }"))
    # avatar + online dot structure
    check("avatars are circles", page.evaluate("() => { const a = document.querySelector('.msg-av img, .msg-av-ph'); return a && getComputedStyle(a).borderRadius === '50%'; }"))
    check("no horizontal overflow", overflow(page) == 0, overflow(page))
    page.screenshot(path=f"{OUT}/ref3-messages.png")

    # --- 3. search: by name ---
    first_name = names[0]
    page.fill("#msg-search-input", first_name)
    time.sleep(0.3)
    vis = visible_rows(page)
    check(f"search by name '{first_name}' shows only that row", vis == [first_name], vis)
    check("clear button appears while typing", page.is_visible("#msg-search-clear"))
    page.screenshot(path=f"{OUT}/ref3-messages-search.png")

    # --- 4. search: by preview word ---
    page.fill("#msg-search-input", "")
    time.sleep(0.2)
    # find a preview word from a chat row (skip LoveLink row if possible)
    preview_word = page.evaluate("""() => {
      const rows = Array.from(document.querySelectorAll('#msg-list .msg-row'));
      for (const r of rows) {
        const p = r.querySelector('.msg-prev');
        if (p && r.getAttribute('data-name') !== 'lovelink') {
          const w = (p.textContent.trim().split(/\\s+/).find(x => x.length > 3) || '').replace(/[^a-zA-Z]/g, '');
          if (w) return w.toLowerCase();
        }
      }
      return null; }""")
    if preview_word:
        page.fill("#msg-search-input", preview_word)
        time.sleep(0.3)
        vis = visible_rows(page)
        check(f"search by preview word '{preview_word}' finds rows", len(vis) >= 1, vis)
    else:
        print("SKIP preview-word search: no usable word found")

    # --- 5. search: gibberish -> no results ---
    page.fill("#msg-search-input", "zzzqqqx")
    time.sleep(0.3)
    check("gibberish hides all rows", visible_rows(page) == [])
    check("no-results state shows", page.is_visible("#msg-noresults"))
    check("no-results text", "No chats found" in page.inner_text("#msg-noresults"))

    # --- 6. clear restores full list ---
    page.click("#msg-search-clear")
    time.sleep(0.3)
    check("clear restores all rows", len(visible_rows(page)) == len(rows), visible_rows(page))
    check("no-results hidden after clear", not page.is_visible("#msg-noresults"))

    # --- 7. fresh user (no profile yet): the onboarding gate redirects
    # /messages -> /onboarding, so the welcome row only appears after the
    # questionnaire is done. Assert the gate, then use demo Meron
    # (profiled, zero chats, zero notifications) for the true empty state.
    page.goto(BASE + "/signout")
    page.goto(BASE + "/signup")
    page.fill('input[name=name]', "Test Fresh")
    page.fill('input[name=phone]', "09119" + str(random.randint(10000, 99999)))
    page.fill('input[name=password]', "password123")
    page.select_option('select[name=gender]', "female")
    page.fill('input[name=age]', "22")
    page.click('button[type=submit]')
    page.wait_for_url("**/onboarding", timeout=10000)
    page.goto(BASE + "/messages")
    time.sleep(0.5)
    check("fresh user without profile is gated to onboarding", "/onboarding" in page.url, page.url)

    page.goto(BASE + "/signout")
    page.goto(BASE + "/signin")
    page.fill('input[name=login]', "0922001112")
    page.fill('input[name=password]', "password123")
    page.click('button[type=submit]')
    page.wait_for_url("**/discover", timeout=10000)
    page.goto(BASE + "/messages")
    page.wait_for_selector(".empty", timeout=10000)
    time.sleep(0.4)
    check("Meron (zero chats) empty state shows", "No chats yet" in page.inner_text("body"))
    check("empty state has Discover button", page.query_selector(".empty a[href='/discover']") is not None)
    check("empty state has no search bar", page.query_selector("#msg-search-input") is None)
    check("empty state: no overflow", overflow(page) == 0, overflow(page))
    page.screenshot(path=f"{OUT}/ref3-messages-empty.png")

    # --- 8. admin (no convs, no notifications) -> true empty state ---
    page.goto(BASE + "/signout")
    page.goto(BASE + "/signin")
    page.fill('input[name=login]', "0911000000")
    page.fill('input[name=password]', "admin123")
    page.click('button[type=submit]')
    page.wait_for_url("**/admin", timeout=10000)
    page.goto(BASE + "/messages")
    time.sleep(0.5)
    check("admin empty state shows", page.query_selector(".empty") is not None and "No chats yet" in page.inner_text("body"))
    check("admin empty state has Discover button", page.query_selector(".empty a[href='/discover']") is not None)
    page.screenshot(path=f"{OUT}/ref3-messages-empty.png")

    print("console errors:", errors if errors else "none")
    check("zero console errors", len(errors) == 0, errors)
    print(("FAILED: " + ", ".join(failed)) if failed else "ALL PASS")
    b.close()
    raise SystemExit(1 if failed else 0)
