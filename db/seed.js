// LoveLink seed demo data. Usage: USE_PGMEM=1 node db/seed.js
// Demo logins are documented in README.md (NOT in chat/memory).
//
// 2026-11-10 (user order): ALL old demo people are GONE from this seed —
// the original 16 (v1+v3) and the 15 cultural/traditional profiles added
// 2026-11-10 were deleted, seed + live. The ONLY demos here are the 15
// modern profiles below, so "Add missing demo users" can never bring the
// old ones back. The Abel test account (0922000111) and the admin are kept
// LIVE only — they are NOT in this seed.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./index');

const DEMO_PASS = 'password123';
const ADMIN_PHONE = '0911000000';
const ADMIN_PASS = 'admin123';

  // v6 modern demos (2026-11-10): stylish young adults, modern clothes,
  // city / café / nightlife / street style — NOT traditional dress, NOT
  // habesha kemis, NOT coffee ceremony, NOT cultural scenes. Photos from
  // Pexels, Ethiopian photographers only, every photo looked at.
  const modernDemos = [
    ['Ayana Bekele', '0922003232', 'female', 23, 'Addis Ababa', 9.0120, 38.7680,
     'Rainy streets, loud playlists and a beanie that never leaves my head.', 'serious', 'male', 18, 35,
     165, 'Orthodox', 'University', 'Fashion Blogger', 'never', 'never', 'want', 'travel,music,fitness,photography', 'demo3-girl1.jpg', 'demo3-girl1-2.jpg', 'demo3-girl1-3.jpg'],
    ['Helen Teshome', '0922003333', 'female', 25, 'Addis Ababa', 9.0080, 38.7550,
     'Umbrella in one hand, pearls on, city at my feet.', 'serious', 'male', 18, 35,
     167, 'Protestant', 'University', 'Stylist', 'never', 'sometimes', 'want', 'travel,photography,music,fitness', 'demo3-girl2.jpg', 'demo3-girl2-2.jpg', null],
    ['Feven Girma', '0922003434', 'female', 22, 'Hawassa', 7.0620, 38.4720,
     'Curly hair, cosy sweaters and a laugh that fills the room.', 'serious', 'male', 18, 35,
     163, 'Orthodox', 'College', 'Barista', 'never', 'never', 'want', 'music,travel,cooking,movies', 'demo3-girl3.jpg', null, null],
    ['Kidist Alemu', '0922003535', 'female', 24, 'Bahir Dar', 11.5760, 37.3920,
     'Denim jacket, golden hour, no plans — just good energy.', 'serious', 'male', 18, 35,
     166, 'Orthodox', 'University', 'Nurse', 'never', 'never', 'want', 'music,travel,fitness,movies', 'demo3-girl4.jpg', null, null],
    ['Mihret Haile', '0922003636', 'female', 21, 'Gondar', 12.6000, 37.4700,
     'Café window seats and long talks over coffee.', 'serious', 'male', 18, 35,
     164, 'Orthodox', 'High School', 'Student', 'never', 'never', 'want', 'travel,music,reading,fitness', 'demo3-girl5.jpg', null, null],
    ['Yodit Fikre', '0922003737', 'female', 26, 'Addis Ababa', 9.0200, 38.7500,
     'City girl with a hoodie and a playlist for every mood.', 'casual', 'male', 18, 35,
     168, 'Orthodox', 'University', 'Content Creator', 'never', 'sometimes', 'none', 'music,movies,travel,fitness', 'demo3-girl6.jpg', null, null],
    ['Netsanet Worku', '0922003838', 'female', 24, 'Mekelle', 13.4980, 39.4710,
     'Red lipstick, sharp eyes, soft heart.', 'serious', 'male', 18, 35,
     165, 'Orthodox', 'University', 'Makeup Artist', 'never', 'never', 'want', 'travel,reading,music,photography', 'demo3-girl7.jpg', null, null],
    ['Genet Tadesse', '0922003939', 'female', 27, 'Dire Dawa', 9.6000, 41.8500,
     'Big red afro, bigger smile. Come say hi.', 'marriage', 'male', 18, 35,
     166, 'Orthodox', 'College', 'Shop Owner', 'never', 'sometimes', 'want', 'travel,music,movies,cooking', 'demo3-girl8.jpg', null, null],
    ['Almaz Kassa', '0922004040', 'female', 20, 'Jimma', 7.6700, 36.8300,
     'Fashion, colour and a little drama — in the best way.', 'serious', 'male', 18, 35,
     162, 'Protestant', 'College', 'Student', 'never', 'never', 'want', 'music,travel,fitness,reading', 'demo3-girl9.jpg', null, null],
    ['Eyerusalem Gebru', '0922004141', 'female', 19, 'Adama', 8.5420, 39.2720,
     'Streetwear, city lights and sneakers that match my mood.', 'serious', 'male', 18, 35,
     164, 'Orthodox', 'High School', 'Student', 'never', 'never', 'want', 'travel,music,movies,fitness', 'demo3-girl10.jpg', null, null],
    ['Yared Tesfaye', '0922004242', 'male', 26, 'Addis Ababa', 9.0054, 38.7636,
     'Big afro, denim jacket, red doors and night lights.', 'serious', 'female', 18, 35,
     180, 'Orthodox', 'University', 'Photographer', 'never', 'sometimes', 'none', 'travel,music,football,fitness', 'demo3-boy1.jpg', 'demo3-boy1-2.jpg', 'demo3-boy1-3.jpg'],
    ['Fikre Alemayehu', '0922004343', 'male', 24, 'Hawassa', 7.0550, 38.4650,
     'Blazer on, smile on. Night city is my runway.', 'serious', 'female', 18, 35,
     178, 'Protestant', 'University', 'Accountant', 'never', 'never', 'want', 'music,travel,fitness,movies', 'demo3-boy2.jpg', null, null],
    ['Samson Haile', '0922004444', 'male', 27, 'Bahir Dar', 11.5700, 37.3850,
     'Sunglasses, scarf and a laugh you can hear from far.', 'marriage', 'female', 18, 35,
     182, 'Orthodox', 'University', 'Banker', 'never', 'sometimes', 'want', 'travel,music,cooking,fitness', 'demo3-boy3.jpg', null, null],
    ['Getnet Berhe', '0922004545', 'male', 23, 'Mekelle', 13.4900, 39.4650,
     'Sharp suit, phone in hand, always on the move.', 'serious', 'female', 18, 35,
     179, 'Orthodox', 'University', 'Software Developer', 'never', 'never', 'none', 'music,travel,reading,fitness', 'demo3-boy4.jpg', null, null],
    ['Mikiyas Worku', '0922004646', 'male', 25, 'Dessie', 11.1300, 39.6300,
     'Quiet by the window, loud in my head. Talk to me.', 'casual', 'female', 18, 35,
     177, 'Orthodox', 'College', 'Graphic Designer', 'sometimes', 'sometimes', 'none', 'travel,photography,music,fitness', 'demo3-boy5.jpg', null, null],
  ];

async function main(opts = {}) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await db.query(schema);
  const existing = await db.query('SELECT COUNT(*) AS c FROM users');
  if (Number(existing.rows[0].c) > 0) {
    console.log('already seeded — skipping');
    if (!opts.keepAlive && typeof db.pool.end === 'function') await db.pool.end();
    return;
  }
  const hash = bcrypt.hashSync(DEMO_PASS, 10);

  // Admin
  await db.query("INSERT INTO users(role,name,phone,password_hash,is_demo) VALUES('admin','LoveLink Admin',$1,$2,TRUE)",
    [ADMIN_PHONE, bcrypt.hashSync(ADMIN_PASS, 10)]);

  // Demo profiles: [name, phone, gender, age, city, lat, lng, bio, goal, lookingFor, ageMin, ageMax,
  //                  height, religion, education, job, smoking, drinking, kids, interests, photo]
  for (const d of [...modernDemos]) {
    const [name, phone, gender, age, city, lat, lng, bio, goal, looking, aMin, aMax,
      height, religion, edu, job, smoking, drinking, kids, interests, photo, photo2, photo3] = d;
    const u = await db.query(
      "INSERT INTO users(role,name,phone,password_hash,gender,age,is_demo) VALUES('user',$1,$2,$3,$4,$5,TRUE) RETURNING id",
      [name, phone, hash, gender, age]);
    const uid = u.rows[0].id;
    await db.query(
      `INSERT INTO profiles(user_id,bio,city,country,latitude,longitude,height_cm,religion,education,job,
        smoking,drinking,kids,looking_for_gender,age_min,age_max,relationship_goal,interests,languages,photo1,photo2,photo3,online)
       VALUES($1,$2,$3,'Ethiopia',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'Amharic, English',$18,$19,$20,TRUE)`,
      [uid, bio, city, lat, lng, height, religion, edu, job, smoking, drinking, kids,
       looking, aMin, aMax, goal, interests, '/img/' + photo,
       photo2 ? '/img/' + photo2 : null, photo3 ? '/img/' + photo3 : null]);
  }

  console.log('seeded OK');
  console.log('admin login: phone=' + ADMIN_PHONE + ' password=' + ADMIN_PASS);
  console.log('demo password for all demo users: ' + DEMO_PASS);
  if (!opts.keepAlive && typeof db.pool.end === 'function') await db.pool.end();
}

// Add the 15 modern demos to a database that already has users.
// Idempotent: every insert is guarded, so running it twice changes nothing.
async function seedExtraDemos() {
  const hash = bcrypt.hashSync(DEMO_PASS, 10);
  const ids = {};
  const all = await db.query('SELECT id, name, phone FROM users');
  for (const u of all.rows) ids[u.name] = u.id;
  let added = 0;
  for (const d of [...modernDemos]) {
    const [name, phone, gender, age, city, lat, lng, bio, goal, looking, aMin, aMax,
      height, religion, edu, job, smoking, drinking, kids, interests, photo, photo2, photo3] = d;
    let uid = ids[name];
    if (!uid) {
      const ex = await db.query('SELECT id FROM users WHERE phone=$1', [phone]);
      if (ex.rows.length) { ids[name] = ex.rows[0].id; uid = ex.rows[0].id; }
      else {
        const u = await db.query(
          "INSERT INTO users(role,name,phone,password_hash,gender,age,is_demo) VALUES('user',$1,$2,$3,$4,$5,TRUE) RETURNING id",
          [name, phone, hash, gender, age]);
        uid = u.rows[0].id; ids[name] = uid; added++;
      }
    }
    const pex = await db.query('SELECT user_id FROM profiles WHERE user_id=$1', [uid]);
    if (!pex.rows.length) {
      await db.query(
        `INSERT INTO profiles(user_id,bio,city,country,latitude,longitude,height_cm,religion,education,job,
          smoking,drinking,kids,looking_for_gender,age_min,age_max,relationship_goal,interests,languages,photo1,photo2,photo3,online)
         VALUES($1,$2,$3,'Ethiopia',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'Amharic, English',$18,$19,$20,TRUE)`,
        [uid, bio, city, lat, lng, height, religion, edu, job, smoking, drinking, kids,
         looking, aMin, aMax, goal, interests, '/img/' + photo,
         photo2 ? '/img/' + photo2 : null, photo3 ? '/img/' + photo3 : null]);
    }
  }
  // v4: widen EVERY demo profile's age range to 18-35. A 19-year-old tester
  // got an empty Discover because every demo woman wanted 21+ — the age
  // filter in getCandidates drops anyone outside their range. Idempotent.
  const widened = await db.query(
    `UPDATE profiles SET age_min=18, age_max=35
     WHERE user_id IN (SELECT id FROM users WHERE is_demo=TRUE AND role='user')`);
  return { added, widened: widened.rowCount };
}

// Reset demo swipes only: delete every swipe FROM a demo account.
// Matches, messages, reports and real users' swipes are never touched.
// (No pre-seeded likes exist any more — the old demo people are gone.)
async function resetDemoSwipes() {
  const all = await db.query('SELECT id FROM users WHERE is_demo=TRUE');
  const demoIds = all.rows.map((u) => u.id);
  let cleared = 0;
  if (demoIds.length) {
    const ph = demoIds.map((_, i) => '$' + (i + 1)).join(',');
    const r = await db.query(`DELETE FROM swipes WHERE from_user_id IN (${ph})`, demoIds);
    cleared = r.rowCount;
  }
  return cleared;
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { main, seedExtraDemos, resetDemoSwipes };
