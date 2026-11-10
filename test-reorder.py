"""Photo reorder / replace / remove test for the rebuilt My Profile grid.

Fresh pg-mem server, new user with 3 photos, then:
1. Drag tile 1 onto tile 2 -> first tile should change (Main photo swaps).
2. Tap-to-replace slot 3 with a different image -> slot 3 img changes.
3. Click x on slot 3 -> slot 3 becomes empty (photos compact up).
Screenshots to preview/.
"""
import os, time, sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
OUT = os.path.expanduser("~/workspace/lovelink/preview")
IMG = os.path.expanduser("~/workspace/lovelink/public/img")
fails, passes = [], []
def check(name, ok, extra=""):
    (passes if ok else fails).append(name)
    print(("PASS " if ok else "FAIL ") + name + (f" :: {extra}" if extra else ""))

with sync_playwright() as pw:
    b = pw.chromium.launch()
    page = b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
    errs = []
    page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errs.append(str(e)))

    # --- sign up a fresh user ---
    page.goto(BASE + "/signup")
    page.fill('input[name=name]', "Reorder Test")
    page.fill('input[name=phone]', "0933000111")
    page.fill('input[name=password]', "test1234")
    page.select_option('select[name=gender]', "Male")
    page.fill('input[name=age]', "24")
    page.click('button[type=submit]')
    page.wait_for_url("**/onboarding", timeout=10000)
    check("signup -> onboarding", True)

    # --- onboarding with 3 photos ---
    page.set_input_files('input[name=photo1]', os.path.join(IMG, "demo-abel.jpg"))
    page.set_input_files('input[name=photo2]', os.path.join(IMG, "demo-daniel.jpg"))
    page.set_input_files('input[name=photo3]', os.path.join(IMG, "demo-dawit.jpg"))
    page.fill('textarea[name=bio]', "Testing photo reorder.")
    page.fill('input[name=city]', "Addis Ababa")
    page.click('button[type=submit]')
    page.wait_for_url("**/discover", timeout=15000)
    check("onboarding with 3 photos -> discover", True)

    def tile_srcs():
        # Photos are data URLs: fingerprint by length + a mid slice.
        return page.evaluate(
            """() => [...document.querySelectorAll('.photo-tile')].map(t => {
                const img = t.querySelector('img');
                const s = img ? img.getAttribute('src') : null;
                return s ? (s.length + ':' + s.slice(500, 520)) : null; })""")

    # --- My Profile grid ---
    page.goto(BASE + "/profile")
    page.wait_for_selector(".photo-grid", timeout=10000)
    before = tile_srcs()
    print("before reorder:", before)
    check("3 photo tiles filled", len([s for s in before if s]) == 3, str(before))
    check("3 tiles are distinct photos", len(set(before)) == 3, str(before))
    page.screenshot(path=os.path.join(OUT, "ref-profile-3photos.png"))

    # --- drag tile 1 onto tile 2 ---
    t1 = page.query_selector('.photo-tile[data-slot="1"]')
    t2 = page.query_selector('.photo-tile[data-slot="2"]')
    b1, b2 = t1.bounding_box(), t2.bounding_box()
    page.mouse.move(b1["x"] + b1["width"] / 2, b1["y"] + b1["height"] / 2)
    page.mouse.down()
    # drop on the RIGHT side of tile 2 (past its centre) so it swaps in after it
    page.mouse.move(b2["x"] + b2["width"] * 0.75, b2["y"] + b2["height"] / 2, steps=12)
    page.mouse.up()
    try:
        page.wait_for_url("**/profile", timeout=8000)
    except Exception:
        pass
    time.sleep(1.2)
    page.wait_for_selector(".photo-grid", timeout=10000)
    after = tile_srcs()
    print("after reorder:", after)
    check("drag reorder swaps Main photo (tiles 1<->2)", after[0] == before[1] and after[1] == before[0] and after[2] == before[2],
          f"{before} -> {after}")
    page.screenshot(path=os.path.join(OUT, "ref-profile-reordered.png"))

    # --- tap-to-replace slot 3 ---
    with page.expect_file_chooser() as fc:
        page.click('.photo-tile[data-slot="3"]')
    fc.value.set_files(os.path.join(IMG, "demo-fitsum.jpg"))
    try:
        page.wait_for_url("**/profile", timeout=8000)
    except Exception:
        pass
    time.sleep(1.2)
    page.wait_for_selector(".photo-grid", timeout=10000)
    after_rep = tile_srcs()
    print("after replace:", after_rep)
    check("tap-to-replace slot 3 changes it (1,2 untouched)",
          after_rep[2] and after_rep[2] != after[2] and after_rep[0] == after[0] and after_rep[1] == after[1], str(after_rep))

    # --- remove slot 3 (x button) ---
    page.click('.photo-tile[data-slot="3"] .photo-x')
    time.sleep(1.2)
    page.wait_for_selector(".photo-grid", timeout=10000)
    after_rm = tile_srcs()
    print("after remove:", after_rm)
    check("remove slot 3 empties it (1,2 untouched)",
          after_rm[2] is None and after_rm[0] == after_rep[0] and after_rm[1] == after_rep[1], str(after_rm))

    print("\n--- console errors ---")
    check("no console errors", not errs, "; ".join(errs[:5]))
    b.close()

print(f"\n{len(fails)} checks failed: {fails}")
sys.exit(1 if fails else 0)
