"""Isolate the photo-drag wipe: log every /profile/photos/* request."""
import os, time, sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
IMG = os.path.expanduser("~/workspace/lovelink/public/img")

def fp(src):
    if not src:
        return None
    # data URLs: distinguish by length + a slice from the middle
    return f"len={len(src)} mid={src[500:520]}"

with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    reqs = []
    def on_req(r):
        if "/profile/photos/" in r.url:
            body = ""
            try:
                body = (r.post_data or "")[:200]
            except Exception:
                pass
            reqs.append(f"{r.method} {r.url.split('/')[-1]} body={body}")
    page.on("request", on_req)
    page.on("response", lambda r: reqs.append(f"  <- {r.status} {r.url.split('/')[-1]}") if "/profile/photos/" in r.url else None)

    page.goto(BASE + "/signin")
    page.fill('input[name=login]', "0933000111")
    page.fill('input[name=password]', "test1234")
    page.click('button[type=submit]')
    page.wait_for_url("**/discover", timeout=10000)

    # re-add 3 photos via replace (curl already did this, but redo via UI-independent check)
    page.goto(BASE + "/profile")
    page.wait_for_selector(".photo-grid", timeout=10000)
    def tile_srcs():
        return page.evaluate(
            """() => [...document.querySelectorAll('.photo-tile')].map(t => {
                const img = t.querySelector('img'); return img ? img.getAttribute('src') : null; })""")
    before = tile_srcs()
    print("before drag:", [fp(s) for s in before])

    t1 = page.query_selector('.photo-tile[data-slot="1"]')
    t2 = page.query_selector('.photo-tile[data-slot="2"]')
    b1, b2 = t1.bounding_box(), t2.bounding_box()
    page.mouse.move(b1["x"] + b1["width"] / 2, b1["y"] + b1["height"] / 2)
    page.mouse.down()
    page.mouse.move(b2["x"] + b2["width"] / 2, b2["y"] + b2["height"] / 2, steps=12)
    page.mouse.up()
    time.sleep(2)
    print("requests during drag:")
    for r in reqs:
        print(" ", r)
    after = tile_srcs()
    print("after drag:", [fp(s) for s in after])
    print("dragging class still present:", page.evaluate("!!document.querySelector('.photo-tile.dragging')"))
    b.close()
