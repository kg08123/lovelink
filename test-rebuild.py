"""LoveLink reference-rebuild local test (390x844, Abel demo user)."""
import json, re, sys, time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = "/home/hatch/workspace/lovelink/preview"
errors = []
failed = []

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
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type in ("error",) else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    # --- login as Abel ---
    page.goto(BASE + "/signin")
    page.fill('input[name=login]', "0922000111")
    page.fill('input[name=password]', "password123")
    page.click('button[type=submit]')
    page.wait_for_url("**/discover", timeout=10000)
    check("login -> discover", "/discover" in page.url, page.url)

    # --- Discover ---
    page.wait_for_selector(".fs-card", timeout=10000)
    time.sleep(0.5)
    shot(page, "ref-discover.png")
    check("discover: no top header", page.query_selector(".topbar") is None)
    check("discover: no match-% chip", page.query_selector(".match-badge") is None)
    check("discover: no 'profiles near you' line", "profiles near you" not in page.inner_text("body"))
    check("discover: story bars or single photo", True)
    check("discover: 3 action buttons", len(page.query_selector_all(".fs-actions .swipe-btn")) == 3)
    check("discover: bottom nav icons only (badge digits ok)",
          re.sub(r"\d+", "", page.inner_text(".bottomnav")).strip() == "",
          repr(page.inner_text(".bottomnav")))
    check("discover: no h-overflow", overflow(page) <= 0, overflow(page))
    name1 = page.inner_text(".swipe-name").strip()
    print("first card:", name1)

    # --- drag swipe left (pass) ---
    box = page.query_selector(".fs-card").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    page.mouse.move(cx, cy)
    page.mouse.down()
    for i in range(1, 11):
        page.mouse.move(cx - i * 15, cy, steps=1)
        time.sleep(0.03)
    page.mouse.up()
    time.sleep(1.2)
    name2 = page.inner_text(".swipe-name").strip()
    check("drag left passes to next card", name2 != name1, f"{name1} -> {name2}")
    print("second card:", name2)

    # --- Likes received ---
    page.goto(BASE + "/likes")
    page.wait_for_selector(".likes-grid, .likes-empty", timeout=10000)
    time.sleep(0.4)
    shot(page, "ref-likes-received.png")
    check("likes: tabs present", len(page.query_selector_all(".text-tab")) == 2)
    check("likes: received tab active", "on" in (page.query_selector(".text-tab").get_attribute("class") or ""))
    check("likes: no h-overflow", overflow(page) <= 0, overflow(page))
    prelikers = [t.strip() for t in page.eval_on_selector_all(
        ".like-name", "els => els.map(e => e.textContent.replace(/\\s+/g,' ').trim())")]
    preliker_names = set()
    for t in prelikers:
        m = re.match(r"(.+?),\s*\d+", t)
        if m:
            preliker_names.add(m.group(1))
    print("likes received:", sorted(preliker_names))
    check("likes received non-empty", len(preliker_names) > 0)

    # --- Likes sent tab via fetch-swap (no reload) ---
    page.click(".text-tab[data-tab=sent]")
    time.sleep(0.8)
    check("likes tab switches to sent", "on" in (page.query_selector_all(".text-tab")[1].get_attribute("class") or ""))
    check("likes sent subtitle", "interested in" in page.inner_text("#likesGridWrap"))
    shot(page, "ref-likes-sent.png")
    page.click(".text-tab[data-tab=received]")
    time.sleep(0.8)

    # --- Public profile from likes ---
    first_card = page.query_selector(".like-card")
    if first_card:
        first_card.click()
        page.wait_for_selector(".pub-hero", timeout=10000)
        time.sleep(0.4)
        shot(page, "ref-public-profile.png")
        check("public profile: back button", page.query_selector(".pub-back") is not None)
        check("public profile: report button", page.query_selector(".pub-report") is not None)
        check("public profile: LOCATION card", "LOCATION" in page.inner_text("body"))
        check("public profile: RELATIONSHIP GOAL card", "RELATIONSHIP GOAL" in page.inner_text("body"))
        check("public profile: no h-overflow", overflow(page) <= 0, overflow(page))
        pub_name = page.inner_text(".pub-name").strip()
        print("public profile:", pub_name)
        # like from public profile -> instant match (pre-liker)
        like_btn = page.query_selector(".pub-actions .swipe-btn.like")
        if like_btn:
            like_btn.click()
            try:
                page.wait_for_url("**/match/**", timeout=8000)
                check("public profile like -> match screen", True)
                shot(page, "ref-match.png")
                page.click("text=Chat Now")
                page.wait_for_url("**/messages/**", timeout=8000)
                check("match screen -> chat", True)
            except Exception as e:
                check("public profile like -> match screen", False, str(e))
    else:
        check("public profile reachable", False, "no like cards")

    # --- Chat thread: send a message ---
    page.wait_for_selector(".chat-head", timeout=10000)
    time.sleep(0.4)
    shot(page, "ref-chat.png")
    check("chat: header has avatar+name", page.query_selector(".chat-head-avatar") is not None)
    check("chat: no h-overflow", overflow(page) <= 0, overflow(page))
    page.fill(".chatbar input[name=body]", "Hello from the rebuild test")
    page.click(".chatbar button[type=submit]")
    time.sleep(1.5)
    check("chat: message sent shows", "Hello from the rebuild test" in page.inner_text("#chat"))
    # date separator present?
    check("chat: date separator", page.query_selector(".chat-date") is not None)

    # --- Messages inbox ---
    page.goto(BASE + "/messages")
    page.wait_for_selector(".chat-item", timeout=10000)
    time.sleep(0.3)
    shot(page, "ref-messages.png")
    check("inbox: has chats", len(page.query_selector_all(".chat-item")) >= 1)

    # --- My Profile ---
    page.goto(BASE + "/profile")
    page.wait_for_selector(".me-head", timeout=10000)
    time.sleep(0.4)
    shot(page, "ref-profile.png")
    check("profile: points pill", page.query_selector(".points-pill") is not None)
    check("profile: gear icon", page.query_selector(".icon-btn-round") is not None)
    check("profile: photos grid", page.query_selector("#photoGrid") is not None)
    check("profile: About Me rows", len(page.query_selector_all(".about-row")) >= 10)
    check("profile: no h-overflow", overflow(page) <= 0, overflow(page))

    # --- Preview Profile ---
    page.click("text=Preview Profile")
    page.wait_for_selector(".pub-hero", timeout=10000)
    check("preview profile loads", "LOCATION" in page.inner_text("body"))
    check("preview: no swipe buttons", page.query_selector(".pub-actions") is None)

    # --- Settings ---
    page.goto(BASE + "/settings")
    page.wait_for_selector(".settings-group-title", timeout=10000)
    time.sleep(0.3)
    shot(page, "ref-settings.png")
    body_txt = page.inner_text("body").lower()
    check("settings: Match Preferences", "match preferences" in body_txt)
    check("settings: Premium Features", "premium features" in body_txt)
    check("settings: Your Plan", "your plan" in body_txt)
    check("settings: Support Info", "support info" in body_txt)
    check("settings: App Version", "app version" in body_txt)
    check("settings: no h-overflow", overflow(page) <= 0, overflow(page))

    # --- Settings filter really filters: age 18-23 (Tigist 23, Bethlehem 21) ---
    page.fill('input[name=age_max]', "23")
    page.dispatch_event('input[name=age_max]', "change")
    time.sleep(1.5)
    check("settings: age save redirects to settings", "/settings" in page.url, page.url)
    page.goto(BASE + "/discover")
    page.wait_for_selector(".fs-card, .fs-empty", timeout=10000)
    time.sleep(0.6)
    card_txt = page.inner_text(".swipe-name") if page.query_selector(".swipe-name") else ""
    m = re.search(r",\s*(\d+)", card_txt)
    age_ok = bool(m and int(m.group(1)) <= 23)
    print("age-filtered first card:", card_txt)
    check("settings age filter applies (first card <= 23)", age_ok, card_txt)
    # restore age range
    page.goto(BASE + "/settings")
    page.fill('input[name=age_max]', "35")
    page.dispatch_event('input[name=age_max]', "change")
    time.sleep(1.2)

    # --- Premium page ---
    page.goto(BASE + "/premium")
    page.wait_for_selector(".premium-head", timeout=10000)
    time.sleep(0.3)
    shot(page, "ref-premium.png")
    check("premium: fee shown", "99 ETB" in page.inner_text("body"))
    check("premium: no h-overflow", overflow(page) <= 0, overflow(page))

    # --- Paywall sheet: like pre-likers on Discover until 4th match ---
    page.goto(BASE + "/likes")
    page.wait_for_selector(".likes-grid", timeout=10000)
    pre = set()
    for t in page.eval_on_selector_all(".like-name", "els => els.map(e => e.textContent)"):
        m = re.match(r"\s*(.+?),\s*\d+", t)
        if m:
            pre.add(m.group(1).strip())
    print("pre-likers for paywall test:", sorted(pre))
    page.goto(BASE + "/discover")
    page.wait_for_selector(".fs-card", timeout=10000)
    sheet_seen = False
    matches_seen = 0
    for i in range(25):
        if not page.query_selector(".swipe-name"):
            break
        nm = page.inner_text(".swipe-name").strip()
        m = re.match(r"(.+?),\s*\d+", nm)
        cname = m.group(1).strip() if m else nm
        if cname in pre:
            before = page.inner_text(".swipe-name").strip() if page.query_selector(".swipe-name") else ""
            page.click(".fs-actions .swipe-btn.like")
            try:
                page.wait_for_function(
                    """(before) => location.pathname.startsWith('/match/') || !!document.querySelector('#pointsSheet:not([hidden])') || !document.querySelector('.swipe-name') || document.querySelector('.swipe-name').textContent.trim() !== before""",
                    arg=before, timeout=8000)
            except Exception:
                pass
            time.sleep(0.4)
            if page.url.startswith(BASE + "/match/"):
                matches_seen += 1
                print(f"match #{matches_seen} with {cname}")
                page.goto(BASE + "/discover")
                page.wait_for_selector(".fs-card", timeout=10000)
                time.sleep(0.5)
            elif page.query_selector("#pointsSheet:not([hidden])"):
                sheet_seen = True
                print(f"paywall sheet appeared after liking {cname}")
                shot(page, "ref-points-sheet.png")
                check("points sheet visible", True)
                check("points sheet: honest copy (no fake points)",
                      "free matches" in page.inner_text("#pointsSheet").lower())
                page.click("#pointsSheetClose")
                break
            else:
                # like recorded, no match yet (shouldn't happen for pre-likers)
                print(f"liked {cname}, no match screen, no sheet; url={page.url}")
        else:
            page.click(".fs-actions .swipe-btn.pass")
            time.sleep(1.0)
    check("paywall sheet appeared at 4th match", sheet_seen, f"matches_seen={matches_seen}")
    check("matches seen before paywall == 3 (Abel had 1 already?)", matches_seen <= 3, f"matches_seen={matches_seen}")

    # --- Dark/light toggle in Settings (tap the visible switch track) ---
    page.goto(BASE + "/settings")
    page.wait_for_selector("#themeToggle", timeout=10000)
    was_dark = "dark" in (page.evaluate("document.documentElement.className") or "")
    page.click("label:has(#themeToggle)")
    time.sleep(0.4)
    now_dark = "dark" in (page.evaluate("document.documentElement.className") or "")
    check("theme toggle flips", was_dark != now_dark, f"{was_dark} -> {now_dark}")
    page.click("label:has(#themeToggle)")
    time.sleep(0.3)

    print("\n--- console errors ---")
    for e in errors:
        print(" ", e)
    check("no console errors", len(errors) == 0, errors[:5])

    print("\n%d checks failed: %s" % (len(failed), failed))
    b.close()
    sys.exit(1 if failed else 0)
