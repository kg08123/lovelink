"""LoveLink ref4 test: spread action buttons + recycled toast/note removed (390x844, Abel)."""
import re, time
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = "/home/hatch/workspace/lovelink/preview"
errors, failed = [], []

def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(extra)) if extra and not cond else ""))
    if not cond:
        failed.append(name)

def body_has_msg(page):
    return "Showing profiles again" in page.content() or "swiped before" in page.content()

def toast_visible(page):
    return page.evaluate("() => { const el = document.getElementById('instant-toast'); return !!(el && el.classList.contains('show') && el.offsetHeight > 0); }")

with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    page.on("console", lambda m: errors.append(f"{m.type}: {m.text}") if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(f"pageerror: {e}"))

    page.goto(BASE + "/signin")
    page.fill('input[name=login]', "0922000111")
    page.fill('input[name=password]', "password123")
    page.click('button[type=submit]')
    page.wait_for_url("**/discover", timeout=10000)
    page.wait_for_selector(".fs-card", timeout=10000)
    time.sleep(0.7)

    # --- FIX 1: buttons spread across full width ---
    pos = page.evaluate("""() => {
      const row = document.querySelector('.fs-actions');
      const r = row.getBoundingClientRect();
      const out = {rowW: r.width, rowL: r.left};
      for (const cls of ['pass', 'msg', 'like']) {
        const b = row.querySelector('.swipe-btn.' + cls);
        const br = b.getBoundingClientRect();
        out[cls] = {cx: (br.left + br.width / 2 - r.left) / r.width, l: br.left - r.left, r: br.right - r.left};
      }
      out.gap1 = out.msg.l - out.pass.r;
      out.gap2 = out.like.l - out.msg.r;
      return out;
    }""")
    print("button centres (% of row):", {k: round(v["cx"], 3) for k, v in pos.items() if isinstance(v, dict)}, "| gaps px:", round(pos["gap1"], 1), round(pos["gap2"], 1))
    check("X button ~20% across", 0.14 <= pos["pass"]["cx"] <= 0.26, pos["pass"]["cx"])
    check("message button ~50% across", 0.44 <= pos["msg"]["cx"] <= 0.56, pos["msg"]["cx"])
    check("heart button ~80% across", 0.74 <= pos["like"]["cx"] <= 0.86, pos["like"]["cx"])
    check("real gap between X and message (>=20px)", pos["gap1"] >= 20, pos["gap1"])
    check("real gap between message and heart (>=20px)", pos["gap2"] >= 20, pos["gap2"])
    check("no horizontal overflow", page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") == 0)

    # --- FIX 2: no recycled message anywhere on first load ---
    check("no 'Showing profiles again' text on load", not body_has_msg(page))
    check("no toast visible on load", not toast_visible(page))

    # --- pass through the whole deck until a profile repeats (recycled) ---
    seen, recycled_seen = [], False
    for i in range(16):
        name = page.inner_text(".swipe-name").strip()
        if name in seen:
            recycled_seen = True
            print(f"recycled card reached after {i} passes: {name}")
            break
        seen.append(name)
        page.click(".fs-actions .swipe-btn.pass")
        time.sleep(0.9)
        page.wait_for_selector(".fs-card", timeout=10000)
        time.sleep(0.4)
        if body_has_msg(page) or toast_visible(page):
            check(f"no recycled message after pass {i+1}", False, "message appeared")
            break
    check("deck recycled (a profile came back)", recycled_seen, seen)
    check("no recycled message/toast on recycled card", not body_has_msg(page) and not toast_visible(page))
    print("cards seen:", seen)

    # --- buttons still work: like the current card ---
    page.click(".fs-actions .swipe-btn.like")
    time.sleep(1.2)
    like_ok = bool(page.query_selector(".fs-card") or page.query_selector(".match-screen, #pointsSheet") or "/messages" in page.url or "match" in page.content().lower())
    check("heart button works (new card / match / premium sheet)", like_ok, page.url)

    page.screenshot(path=f"{OUT}/ref4-discover-spread.png")
    check("zero console errors", not errors, errors)
    b.close()

print("FAILED:", failed if failed else "none")
raise SystemExit(1 if failed else 0)
