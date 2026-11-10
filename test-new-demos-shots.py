"""Screenshot Discover cards of new profiles for the ref5 contact sheet."""
import os, subprocess, sys, time, signal
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = "/home/hatch/workspace/lovelink/preview"
TARGETS = ["Mekdes Tadesse", "Mahlet Girma", "Eden Bekele", "Selamawit Kassa",
           "Samuel Fikre", "Natnael Teshome", "Yohannes Girma", "Liya Tesfaye"]
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
        page.goto(BASE + "/signin")
        page.fill('input[name=login]', "0922000111")
        page.fill('input[name=password]', "password123")
        page.click('button[type=submit]')
        page.wait_for_url("**/discover", timeout=10000)
        page.wait_for_selector(".fs-card", timeout=10000)
        time.sleep(0.6)
        def name():
            return page.evaluate("() => document.querySelector('.fs-card:not(.peek) .swipe-name .nm')?.textContent.trim()")
        def do_pass():
            page.evaluate("() => document.querySelector('.swipe-btn.pass')?.click()")
            time.sleep(0.9)
        got = {}
        for _ in range(60):
            nm = name() or ""
            for t in TARGETS:
                if t in nm and t not in got:
                    time.sleep(0.5)
                    page.screenshot(path=f"{OUT}/ref5-shot-{t.split()[0].lower()}.png")
                    got[t] = True
                    print("shot:", t)
            if len(got) == len(TARGETS):
                break
            do_pass()
        # boys: sign in as Selam for the male cards not yet shot
        missing_boys = [t for t in ["Samuel Fikre", "Natnael Teshome", "Yohannes Girma"] if t not in got]
        if missing_boys:
            page.goto(BASE + "/signout")
            page.goto(BASE + "/signin")
            page.fill('input[name=login]', "0922000222")
            page.fill('input[name=password]', "password123")
            page.click('button[type=submit]')
            page.wait_for_url("**/discover", timeout=10000)
            page.wait_for_selector(".fs-card", timeout=10000)
            time.sleep(0.6)
            for _ in range(60):
                nm = name() or ""
                for t in missing_boys:
                    if t in nm and t not in got:
                        time.sleep(0.5)
                        page.screenshot(path=f"{OUT}/ref5-shot-{t.split()[0].lower()}.png")
                        got[t] = True
                        print("shot:", t)
                if len(got) == len(TARGETS):
                    break
                do_pass()
        print("got", len(got), "of", len(TARGETS), sorted(got))
        b.close()
finally:
    srv.send_signal(signal.SIGTERM)
    try:
        srv.wait(timeout=10)
    except Exception:
        srv.kill()
