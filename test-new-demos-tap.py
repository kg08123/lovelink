"""Focused: story tap cycles photos on a multi-photo new profile."""
import os, subprocess, sys, time, signal
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = "/home/hatch/workspace/lovelink/preview"
MULTI = ["Mekdes Tadesse", "Frehiwot Alemu", "Mahlet Girma", "Eden Bekele", "Rahel Haile", "Liya Tesfaye", "Hiwot Daniel", "Yohannes Girma"]
errors, failed = [], []

def check(name, cond, extra=""):
    print(("PASS " if cond else "FAIL ") + name + ((" :: " + str(extra)) if extra and not cond else ""))
    if not cond:
        failed.append(name)

env = dict(os.environ, USE_PGMEM="1", PORT="3000")
srv = subprocess.Popen(["node", "server.js"], cwd="/home/hatch/workspace/lovelink",
                       env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(30):
        try:
            import urllib.request
            urllib.request.urlopen(BASE + "/health", timeout=2)
            break
        except Exception:
            time.sleep(1)
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
        time.sleep(0.6)

        def name():
            return page.evaluate("() => document.querySelector('.fs-card:not(.peek) .swipe-name .nm')?.textContent.trim()")
        def photo_state():
            return page.evaluate("""() => {
              const card = document.querySelector('.fs-card:not(.peek)');
              const img = card?.querySelector('.fs-photo');
              const bars = [...(card?.querySelectorAll('.story-bar') || [])].map(b => b.classList.contains('on'));
              return {src: img ? img.src : null, n: JSON.parse(card?.dataset.photos || '[]').length, bars};
            }""")
        def do_pass():
            page.evaluate("() => document.querySelector('.swipe-btn.pass')?.click()")
            time.sleep(0.9)

        found = None
        for _ in range(45):
            nm = name()
            if nm and any(g in nm for g in MULTI):
                found = nm
                break
            do_pass()
        check("found a multi-photo new profile", bool(found), found)
        if found:
            st1 = photo_state()
            print("before:", st1["src"].split("/")[-1], "photos:", st1["n"], "bars:", st1["bars"])
            check("card has 3 photos", st1["n"] == 3, st1["n"])
            check("3 story bars shown", len(st1["bars"]) == 3, st1["bars"])
            page.mouse.click(330, 350)  # right tap zone -> next photo
            time.sleep(0.7)
            st2 = photo_state()
            print("after tap:", st2["src"].split("/")[-1], "bars:", st2["bars"])
            check(f"tap cycles to photo 2 on {found}", st1["src"] != st2["src"] and st2["bars"] == [False, True, False], st2)
            page.mouse.click(330, 350)
            time.sleep(0.7)
            st3 = photo_state()
            check("second tap cycles to photo 3", st3["bars"] == [False, False, True], st3)
            page.screenshot(path=OUT + "/ref5-new-demos-multi.png")
            # drag regression: a real left-drag must still swipe to the next card
            before_drag = name()
            page.mouse.move(195, 400)
            page.mouse.down()
            for x in range(195, 60, -15):
                page.mouse.move(x, 400)
                time.sleep(0.03)
            page.mouse.up()
            time.sleep(1.2)
            after_drag = name()
            check(f"drag-left still swipes ({before_drag} -> {after_drag})", before_drag != after_drag, after_drag)
        check("no console errors", not errors, errors[:3])
        b.close()
finally:
    srv.send_signal(signal.SIGTERM)
    try:
        srv.wait(timeout=10)
    except Exception:
        srv.kill()
print("FAILED:", failed if failed else "none")
sys.exit(1 if failed else 0)
