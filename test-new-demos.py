"""LoveLink new demos test: 15 new profiles appear in Discover with photos (390x844)."""
import os, subprocess, sys, time, signal
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = "/home/hatch/workspace/lovelink/preview"
NEW_GIRLS = ["Mekdes Tadesse", "Frehiwot Alemu", "Mahlet Girma", "Eden Bekele", "Rahel Haile",
             "Liya Tesfaye", "Hiwot Daniel", "Selamawit Kassa", "Tsion Worku", "Yordanos Gebru"]
NEW_BOYS = ["Samuel Fikre", "Natnael Teshome", "Henok Alemayehu", "Bereket Tadesse", "Yohannes Girma"]
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

        def signin(phone):
            page.goto(BASE + "/signin")
            page.fill('input[name=login]', phone)
            page.fill('input[name=password]', "password123")
            page.click('button[type=submit]')
            page.wait_for_url("**/discover", timeout=10000)
            page.wait_for_selector(".fs-card", timeout=10000)
            time.sleep(0.6)

        def card_name():
            return page.evaluate("() => { const el = document.querySelector('.fs-card:not(.peek) .swipe-name .nm'); return el ? el.textContent.trim() : null; }")

        def pass_card():
            page.evaluate("() => document.querySelector('.swipe-btn.pass')?.click()")
            time.sleep(0.9)

        def collect(n, want_shots):
            seen, shots = [], {}
            for _ in range(n):
                nm = card_name()
                if nm and nm not in seen:
                    seen.append(nm)
                    if nm in want_shots and nm not in shots:
                        page.wait_for_timeout(400)
                        shots[nm] = page.screenshot()
                pass_card()
            return seen, shots

        # --- Abel (male): should see the 10 new girls ---
        signin("0922000111")
        seen_g, shots = collect(45, NEW_GIRLS[:4])
        found_g = [n for n in NEW_GIRLS if any(n in s for s in seen_g)]
        print("Abel saw:", seen_g)
        check("Abel sees >=8 of 10 new girls", len(found_g) >= 8, found_g)
        check("no console errors (Abel)", not errors, errors[:3])
        check("no horizontal overflow", page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth") == 0)
        # photo actually renders on a new-girl card: go back to a fresh card and check img naturalWidth
        # (re-collect until a new girl shows, then check)
        for _ in range(45):
            nm = card_name()
            if any(g in (nm or "") for g in NEW_GIRLS):
                break
            pass_card()
        img_ok = page.evaluate("() => { const im = document.querySelector('.fs-card img'); return im ? (im.complete && im.naturalWidth > 100) : false; }")
        check("new-girl card photo renders (naturalWidth>100)", img_ok)
        # story bars: multi-photo profile cycles photos on tap
        multi = None
        for _ in range(45):
            nm = card_name()
            if any(g in (nm or "") for g in ["Mekdes Tadesse", "Frehiwot Alemu", "Mahlet Girma", "Eden Bekele", "Rahel Haile", "Liya Tesfaye", "Hiwot Daniel"]):
                multi = nm
                break
            pass_card()
        if multi:
            src1 = page.evaluate("() => document.querySelector('.fs-card img')?.currentSrc || document.querySelector('.fs-card img')?.src")
            page.mouse.click(330, 400)  # tap right side of photo -> next photo
            time.sleep(0.7)
            src2 = page.evaluate("() => document.querySelector('.fs-card img')?.currentSrc || document.querySelector('.fs-card img')?.src")
            check(f"story tap cycles photo on {multi}", src1 != src2, (src1 or "")[-40:] + " vs " + (src2 or "")[-40:])
            page.screenshot(path=OUT + "/ref5-new-demos-multi.png")
        else:
            check("found a multi-photo new girl to tap-test", False)
        # save the new-girl card shots for the contact sheet
        for i, (nm, png) in enumerate(shots.items()):
            open(f"{OUT}/ref5-shot-{i}-{nm.split()[0].lower()}.png", "wb").write(png)

        # --- Selam (female): should see the 5 new boys ---
        page.goto(BASE + "/signout")
        signin("0922000222")
        seen_b, shots_b = collect(45, NEW_BOYS[:2])
        found_b = [n for n in NEW_BOYS if any(n in s for s in seen_b)]
        print("Selam saw:", seen_b)
        check("Selam sees >=4 of 5 new boys", len(found_b) >= 4, found_b)
        check("no console errors (Selam)", not errors, errors[:3])
        for i, (nm, png) in enumerate(shots_b.items()):
            open(f"{OUT}/ref5-shot-boy-{i}-{nm.split()[0].lower()}.png", "wb").write(png)
        b.close()
finally:
    srv.send_signal(signal.SIGTERM)
    try:
        srv.wait(timeout=10)
    except Exception:
        srv.kill()

print("FAILED:", failed if failed else "none")
sys.exit(1 if failed else 0)
