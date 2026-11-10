"""Explore fix test v2: no Filters/count, smooth tab switching, back button, hearts."""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3102"
fails = []

def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + (" | " + str(extra) if extra else ""))
    if not cond:
        fails.append(name)

def no_reload(page):
    # A real reload resets window.__stay and replaces `document`.
    return page.evaluate("window.__stay === 1 && window.__doc === document")

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

    # --- Explore initial state ---
    page.goto(BASE + "/explore")
    page.wait_for_selector("#explore-grid-root .explore-card", timeout=10000)
    body_text = page.inner_text("body")
    check("Explore heading present", "Explore" in body_text)
    check("NO Filters button", "Filters" not in body_text)
    check("NO 'people found' line", "people found" not in body_text and "person found" not in body_text)
    tabs = page.query_selector_all(".tabs a")
    check("3 text tabs", len(tabs) == 3, len(tabs))
    check("Nearby active initially", "on" in (page.query_selector('.tabs a[href*="tab=nearby"]').get_attribute("class") or ""))
    nearby_names = page.eval_on_selector_all("#explore-grid-root .explore-card b", "els => els.map(e => e.textContent)")
    check("Nearby grid has cards", len(nearby_names) > 0, nearby_names)
    page.screenshot(path="preview/explore-new.png")

    page.evaluate("window.__stay = 1; window.__doc = document")

    # --- Click Online: must NOT reload the document ---
    page.click('.tabs a[href*="tab=online"]')
    page.wait_for_timeout(1200)
    check("no reload on Online click", no_reload(page))
    check("URL updated to tab=online", "tab=online" in page.url, page.url)
    check("Online tab active instantly", "on" in (page.query_selector('.tabs a[href*="tab=online"]').get_attribute("class") or ""))
    online_names = page.eval_on_selector_all("#explore-grid-root .explore-card b", "els => els.map(e => e.textContent)")
    check("Online grid loaded (cards present)", len(online_names) > 0, online_names)
    page.screenshot(path="preview/explore-online.png")

    # --- Heart on a TRUE non-pre-liker (Ruth — Selam/Helina/Tigist/Hanna/Meron
    # pre-liked Abel in the seed, so liking them = instant match + redirect,
    # which is correct behaviour, not a bug) fills in place, no reload ---
    ruth_form = page.evaluate("""() => {
      const cards = [...document.querySelectorAll('#explore-grid-root .explore-card')];
      const c = cards.find(x => x.querySelector('b')?.textContent.includes('Ruth'));
      const f = c?.querySelector('.js-grid-like-form');
      if (!f) return null;
      f.querySelector('button').click();
      return 'clicked';
    }""")
    if ruth_form:
        page.wait_for_timeout(1500)
        check("Ruth heart clicked", ruth_form == "clicked")
        check("heart fills in place, no reload", no_reload(page) and "tab=online" in page.url)
        liked = page.evaluate("""() => {
          const cards = [...document.querySelectorAll('#explore-grid-root .explore-card')];
          const c = cards.find(x => x.querySelector('b')?.textContent.includes('Ruth'));
          const b = c?.querySelector('.explore-like');
          return b ? (b.classList.contains('liked') || b.disabled) : false;
        }""")
        check("Ruth heart shows liked state", liked)
    else:
        check("Ruth heart form present on Online grid", False, "already liked/matched?")

    # --- Click New, then back -> Online ---
    page.click('.tabs a[href*="tab=new"]')
    page.wait_for_timeout(1200)
    check("no reload on New click", no_reload(page))
    check("URL updated to tab=new", "tab=new" in page.url, page.url)
    new_names = page.eval_on_selector_all("#explore-grid-root .explore-card b", "els => els.map(e => e.textContent)")
    check("New grid loaded", len(new_names) > 0, new_names)
    check("New order differs from Nearby order (newest first)", new_names != nearby_names,
          f"nearby={nearby_names} new={new_names}")
    page.go_back()
    page.wait_for_timeout(1200)
    check("back: URL back to tab=online", "tab=online" in page.url, page.url)
    check("back: Online tab active again", "on" in (page.query_selector('.tabs a[href*="tab=online"]').get_attribute("class") or ""))
    back_names = page.eval_on_selector_all("#explore-grid-root .explore-card b", "els => els.map(e => e.textContent)")
    check("back: grid back to Online set", set(back_names) == set(online_names), f"back={back_names} online={online_names}")
    check("no reload on back", no_reload(page))

    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check("no horizontal overflow", overflow == 0, overflow)
    check("no console/page errors", len(errors) == 0, errors[:3])
    b.close()

print("\n%d FAILURES" % len(fails))
for f in fails:
    print(" -", f)
sys.exit(1 if fails else 0)
