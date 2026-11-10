// LoveLink seed demo data. Usage: USE_PGMEM=1 node db/seed.js
// Demo logins are documented in README.md (NOT in chat/memory).
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./index');

const DEMO_PASS = 'password123';
const ADMIN_PHONE = '0911000000';
const ADMIN_PASS = 'admin123';

  const extraDemos = [
    ['Helina Girma', '0922000777', 'female', 25, 'Addis Ababa', 9.0120, 38.7680,
     'Fashion lover, buna mornings, and dancing at weddings.', 'serious', 'male', 18, 35,
     166, 'Orthodox', 'University', 'Fashion Designer', 'never', 'sometimes', 'want', 'travel,music,fitness,movies', 'demo-helina.jpg'],
    ['Tigist Bekele', '0922000888', 'female', 23, 'Addis Ababa', 8.9980, 38.7520,
     'Night owl, denim jacket always on. Looking for real talk.', 'casual', 'male', 18, 35,
     162, 'Orthodox', 'College', 'Barista', 'never', 'sometimes', 'none', 'music,movies,travel,cooking', 'demo-tigist.jpg'],
    ['Bethlehem Tadesse', '0922000999', 'female', 21, 'Bahir Dar', 11.5760, 37.3920,
     'Lake Tana sunsets are my favourite. Hiking, music, good food.', 'serious', 'male', 18, 35,
     164, 'Orthodox', 'High School', 'Student', 'never', 'never', 'want', 'travel,music,fitness,reading', 'demo-bethlehem.jpg'],
    ['Hanna Solomon', '0922001010', 'female', 24, 'Hawassa', 7.0620, 38.4720,
     'Smiles a lot, laughs louder. Coffee, books, and long walks.', 'marriage', 'male', 18, 35,
     167, 'Protestant', 'University', 'Nurse', 'never', 'never', 'want', 'travel,fitness,music,reading', 'demo-hanna.jpg'],
    ['Meron Alemayehu', '0922001112', 'female', 26, 'Mekelle', 13.4980, 39.4710,
     'Teacher by day, movie lover by night. Honest and kind.', 'serious', 'male', 18, 35,
     165, 'Orthodox', 'University', 'Teacher', 'never', 'sometimes', 'want', 'movies,reading,travel,music', 'demo-meron.jpg'],
    ['Yonas Tesfaye', '0922001212', 'male', 28, 'Addis Ababa', 9.0180, 38.7450,
     'Red shirt, big smile. Football on Sundays, buna every day.', 'serious', 'female', 18, 35,
     180, 'Orthodox', 'University', 'Driver', 'sometimes', 'sometimes', 'none', 'fitness,football,music,travel', 'demo-yonas.jpg'],
    ['Dawit Haile', '0922001313', 'male', 27, 'Hawassa', 7.0550, 38.4650,
     'Laughs with his eyes closed. Engineer, foodie, good listener.', 'serious', 'female', 18, 35,
     178, 'Orthodox', 'University', 'Engineer', 'never', 'sometimes', 'want', 'music,movies,cooking,travel', 'demo-dawit.jpg'],
    ['Nahom Gebru', '0922001414', 'male', 29, 'Addis Ababa', 9.0020, 38.7800,
     'Quiet at first, funny once you know me. Into tech and music.', 'marriage', 'female', 18, 35,
     182, 'Orthodox', 'Masters', 'Software Developer', 'never', 'never', 'want', 'music,travel,reading,fitness', 'demo-nahom.jpg'],
    ['Fitsum Berhe', '0922001515', 'male', 24, 'Bahir Dar', 11.5700, 37.3850,
     'Leather jacket, city streets, golden hour. Let us explore.', 'casual', 'female', 18, 35,
     176, 'Orthodox', 'College', 'Photographer', 'sometimes', 'sometimes', 'none', 'travel,photography,music,fitness', 'demo-fitsum.jpg'],
    ['Kaleb Worku', '0922001616', 'male', 25, 'Adama', 8.5420, 39.2720,
     'Gym, movies, and weekend road trips. Simple and real.', 'serious', 'female', 18, 35,
     179, 'Protestant', 'University', 'Banker', 'never', 'sometimes', 'none', 'fitness,movies,travel,music', 'demo-kaleb.jpg'],
  ];

  // v5 (2026-11-10): 15 NEW real-Ethiopian demo profiles (10 girls, 5 boys).
  // Photos are real Ethiopian portraits from Pexels (Ethiopian photographers,
  // habesha kemis / traditional dress / Addis settings — NOT generic African
  // stock). Same-person series share one profile: photo2/photo3 are extra
  // shots of the SAME person. Sources documented in public/img/demo-photos.json.
  // No pre-likes for these profiles (existing pre-like setup untouched).
  const newDemos = [
    ['Mekdes Tadesse', '0922001717', 'female', 24, 'Addis Ababa', 9.0120, 38.7680,
     'White dress, green hills, and a heart that laughs easily.', 'serious', 'male', 18, 35,
     165, 'Orthodox', 'University', 'Boutique Owner', 'never', 'never', 'want', 'travel,music,fitness,photography', 'demo2-mekdes.jpg', 'demo2-mekdes-2.jpg', 'demo2-mekdes-3.jpg'],
    ['Frehiwot Alemu', '0922001818', 'female', 22, 'Hawassa', 7.0620, 38.4720,
     'Krar player, coffee lover, and proud Hawassa girl.', 'serious', 'male', 18, 35,
     163, 'Orthodox', 'College', 'Music Teacher', 'never', 'never', 'want', 'music,travel,cooking,movies', 'demo2-frehiwot.jpg', 'demo2-frehiwot-2.jpg', 'demo2-frehiwot-3.jpg'],
    ['Mahlet Girma', '0922001919', 'female', 25, 'Addis Ababa', 9.0080, 38.7550,
     'Rooftop sunsets and traditional dresses. Addis is home.', 'marriage', 'male', 18, 35,
     167, 'Orthodox', 'University', 'Graphic Designer', 'never', 'sometimes', 'want', 'travel,photography,music,fitness', 'demo2-mahlet.jpg', 'demo2-mahlet-2.jpg', 'demo2-mahlet-3.jpg'],
    ['Eden Bekele', '0922002020', 'female', 23, 'Bahir Dar', 11.5760, 37.3920,
     'Festival lights, big hair, bigger dreams.', 'serious', 'male', 18, 35,
     166, 'Orthodox', 'University', 'Nurse', 'never', 'never', 'want', 'music,travel,fitness,movies', 'demo2-eden.jpg', 'demo2-eden-2.jpg', 'demo2-eden-3.jpg'],
    ['Rahel Haile', '0922002121', 'female', 21, 'Gondar', 12.6000, 37.4700,
     'Wheat fields and slow Sundays. Looking for something real.', 'serious', 'male', 18, 35,
     164, 'Orthodox', 'High School', 'Student', 'never', 'never', 'want', 'travel,music,reading,fitness', 'demo2-rahel.jpg', 'demo2-rahel-2.jpg', 'demo2-rahel-3.jpg'],
    ['Liya Tesfaye', '0922002222', 'female', 26, 'Addis Ababa', 9.0200, 38.7500,
     'City lights and traditional nights. Dance with me?', 'casual', 'male', 18, 35,
     168, 'Protestant', 'University', 'Event Planner', 'never', 'sometimes', 'none', 'music,movies,travel,fitness', 'demo2-liya.jpg', 'demo2-liya-2.jpg', 'demo2-liya-3.jpg'],
    ['Hiwot Daniel', '0922002323', 'female', 24, 'Mekelle', 13.4980, 39.4710,
     'Desert dunes and quiet strength. Coffee first, always.', 'serious', 'male', 18, 35,
     165, 'Orthodox', 'University', 'Teacher', 'never', 'never', 'want', 'travel,reading,music,photography', 'demo2-hiwot.jpg', 'demo2-hiwot-2.jpg', 'demo2-hiwot-3.jpg'],
    ['Selamawit Kassa', '0922002424', 'female', 27, 'Dire Dawa', 9.6000, 41.8500,
     'Blue cars and bold smiles. Dire Dawa raised me right.', 'marriage', 'male', 18, 35,
     166, 'Orthodox', 'College', 'Shop Owner', 'never', 'sometimes', 'want', 'travel,music,movies,cooking', 'demo2-selamawit.jpg', null, null],
    ['Tsion Worku', '0922002525', 'female', 20, 'Jimma', 7.6700, 36.8300,
     'Curly hair, green hills, and a laugh you will remember.', 'serious', 'male', 18, 35,
     162, 'Protestant', 'College', 'Student', 'never', 'never', 'want', 'music,travel,fitness,reading', 'demo2-tsion.jpg', null, null],
    ['Yordanos Gebru', '0922002626', 'female', 19, 'Adama', 8.5420, 39.2720,
     'Young, curious, and full of dreams. Blue skies only.', 'serious', 'male', 18, 35,
     164, 'Orthodox', 'High School', 'Student', 'never', 'never', 'want', 'travel,music,movies,fitness', 'demo2-yordanos.jpg', null, null],
    ['Samuel Fikre', '0922002727', 'male', 26, 'Addis Ababa', 9.0054, 38.7636,
     'Traditional soul, modern mind. Let us talk over buna.', 'serious', 'female', 18, 35,
     180, 'Orthodox', 'University', 'Engineer', 'never', 'sometimes', 'none', 'travel,music,football,fitness', 'demo2-samuel.jpg', null, null],
    ['Natnael Teshome', '0922002828', 'male', 24, 'Hawassa', 7.0550, 38.4650,
     'Lake side walks and honest talk. Simple and real.', 'serious', 'female', 18, 35,
     178, 'Protestant', 'University', 'Accountant', 'never', 'never', 'want', 'music,travel,fitness,movies', 'demo2-natnael.jpg', null, null],
    ['Henok Alemayehu', '0922002929', 'male', 27, 'Bahir Dar', 11.5700, 37.3850,
     'White netela, warm heart. Bahir Dar evenings are the best.', 'marriage', 'female', 18, 35,
     182, 'Orthodox', 'University', 'Banker', 'never', 'sometimes', 'want', 'travel,music,cooking,fitness', 'demo2-henok.jpg', null, null],
    ['Bereket Tadesse', '0922003030', 'male', 23, 'Mekelle', 13.4900, 39.4650,
     'Fresh graduate, big plans. Looking for my person.', 'serious', 'female', 18, 35,
     179, 'Orthodox', 'University', 'Software Developer', 'never', 'never', 'none', 'music,travel,reading,fitness', 'demo2-bereket.jpg', null, null],
    ['Yohannes Girma', '0922003131', 'male', 25, 'Dessie', 11.1300, 39.6300,
     'Afro hair, easy smile. Dessie boy with Addis dreams.', 'casual', 'female', 18, 35,
     177, 'Orthodox', 'College', 'Photographer', 'sometimes', 'sometimes', 'none', 'travel,photography,music,fitness', 'demo2-yohannes.jpg', 'demo2-yohannes-2.jpg', null],
  ];

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
  // All in Addis Ababa, real-ish coordinates around Bole / Piassa / CMC.
  const demos = [
    ['Abel Tesfaye', '0922000111', 'male', 26, 'Addis Ababa', 9.0054, 38.7636,
     'Video editor & motion graphics. Coffee first, then the world.', 'serious', 'female', 18, 35,
     178, 'Orthodox', 'University', 'Video Editor', 'never', 'sometimes', 'none', 'travel,music,fitness,movies', 'demo-abel.jpg'],
    ['Selam Tesfaye', '0922000222', 'female', 24, 'Addis Ababa', 9.0100, 38.7700,
     'Dream big, work hard, and enjoy life', 'serious', 'male', 18, 35,
     165, 'Orthodox', 'University', 'Nurse', 'never', 'never', 'want', 'travel,music,fitness,movies', 'demo-selam.jpg'],
    ['Sara Mekonnen', '0922000333', 'female', 25, 'Addis Ababa', 9.0200, 38.7500,
     'Love music, movies and good food. Looking for someone real.', 'serious', 'male', 18, 35,
     168, 'Orthodox', 'College', 'Teacher', 'never', 'sometimes', 'want', 'music,movies,cooking,travel', 'demo-sara.jpg'],
    ['Mimi Alemu', '0922000444', 'female', 27, 'Addis Ababa', 8.9950, 38.7800,
     'Photographer. Always chasing golden hour.', 'marriage', 'male', 18, 35,
     170, 'Orthodox', 'University', 'Photographer', 'never', 'never', 'want', 'travel,fitness,photography,music', 'demo-mimi.jpg'],
    ['Daniel Haile', '0922000555', 'male', 26, 'Addis Ababa', 9.0150, 38.7400,
     'Gym, football, and good conversation. Simple guy.', 'serious', 'female', 18, 35,
     180, 'Orthodox', 'University', 'Engineer', 'sometimes', 'sometimes', 'none', 'fitness,football,music,travel', 'demo-daniel.jpg'],
    ['Ruth Girma', '0922000666', 'female', 26, 'Addis Ababa', 9.0080, 38.7550,
     'Book lover, night walks, and deep talks over buna.', 'serious', 'male', 18, 35,
     164, 'Protestant', 'University', 'Accountant', 'never', 'never', 'want', 'movies,reading,travel,music', 'demo-ruth.jpg'],
  ];
  const ids = {};
  for (const d of [...demos, ...extraDemos, ...newDemos, ...modernDemos]) {
    const [name, phone, gender, age, city, lat, lng, bio, goal, looking, aMin, aMax,
      height, religion, edu, job, smoking, drinking, kids, interests, photo, photo2, photo3] = d;
    const u = await db.query(
      "INSERT INTO users(role,name,phone,password_hash,gender,age,is_demo) VALUES('user',$1,$2,$3,$4,$5,TRUE) RETURNING id",
      [name, phone, hash, gender, age]);
    const uid = u.rows[0].id;
    ids[name] = uid;
    await db.query(
      `INSERT INTO profiles(user_id,bio,city,country,latitude,longitude,height_cm,religion,education,job,
        smoking,drinking,kids,looking_for_gender,age_min,age_max,relationship_goal,interests,languages,photo1,photo2,photo3,online)
       VALUES($1,$2,$3,'Ethiopia',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'Amharic, English',$18,$19,$20,TRUE)`,
      [uid, bio, city, lat, lng, height, religion, edu, job, smoking, drinking, kids,
       looking, aMin, aMax, goal, interests, '/img/' + photo,
       photo2 ? '/img/' + photo2 : null, photo3 ? '/img/' + photo3 : null]);
  }

  // Selam already liked Abel -> when Abel likes her back, it is an instant match.
  await db.query("INSERT INTO swipes(from_user_id,to_user_id,kind) VALUES($1,$2,'like')",
    [ids['Selam Tesfaye'], ids['Abel Tesfaye']]);

  // v3: Helina, Tigist, Hanna and Meron already liked Abel -> liking them back
  // is an instant match, so testing feels alive right away.
  for (const n of ['Helina Girma', 'Tigist Bekele', 'Hanna Solomon', 'Meron Alemayehu']) {
    await db.query("INSERT INTO swipes(from_user_id,to_user_id,kind) VALUES($1,$2,'like')",
      [ids[n], ids['Abel Tesfaye']]);
  }

  // v3: two more pre-seeded matched pairs with a short chat thread each.
  async function seedPair(aName, bName, msgs) {
    await db.query("INSERT INTO swipes(from_user_id,to_user_id,kind) VALUES($1,$2,'like'),($2,$1,'like')",
      [ids[aName], ids[bName]]);
    const lo = Math.min(ids[aName], ids[bName]), hi = Math.max(ids[aName], ids[bName]);
    const mm = await db.query('INSERT INTO matches(user_a_id,user_b_id) VALUES($1,$2) RETURNING id', [lo, hi]);
    const cc = await db.query('INSERT INTO conversations(match_id,user_a_id,user_b_id) VALUES($1,$2,$3) RETURNING id',
      [mm.rows[0].id, lo, hi]);
    for (const [who, body] of msgs) {
      await db.query('INSERT INTO messages(conversation_id,sender_user_id,body) VALUES($1,$2,$3)',
        [cc.rows[0].id, ids[who], body]);
    }
    await db.query('UPDATE users SET free_matches_used=1 WHERE id IN ($1,$2)', [lo, hi]);
  }
  await seedPair('Helina Girma', 'Yonas Tesfaye', [
    ['Helina Girma', 'Hey Yonas! Your smile is contagious.'],
    ['Yonas Tesfaye', 'Hi Helina! Thank you — coffee sometime?'],
  ]);
  await seedPair('Bethlehem Tadesse', 'Dawit Haile', [
    ['Bethlehem Tadesse', 'Hi Dawit! Hawassa is beautiful this time of year.'],
    ['Dawit Haile', 'Hi Bethlehem! It really is. Want to walk by the lake sometime?'],
  ]);

  // Sara <-> Daniel: mutual likes + match + conversation + 2 messages (real inbox data).
  await db.query("INSERT INTO swipes(from_user_id,to_user_id,kind) VALUES($1,$2,'like'),($2,$1,'like')",
    [ids['Sara Mekonnen'], ids['Daniel Haile']]);
  const a = Math.min(ids['Sara Mekonnen'], ids['Daniel Haile']);
  const b = Math.max(ids['Sara Mekonnen'], ids['Daniel Haile']);
  const m = await db.query('INSERT INTO matches(user_a_id,user_b_id) VALUES($1,$2) RETURNING id', [a, b]);
  const conv = await db.query(
    'INSERT INTO conversations(match_id,user_a_id,user_b_id) VALUES($1,$2,$3) RETURNING id',
    [m.rows[0].id, a, b]);
  await db.query('INSERT INTO messages(conversation_id,sender_user_id,body) VALUES($1,$2,$3)',
    [conv.rows[0].id, ids['Sara Mekonnen'], 'Hey! Nice to match with you!']);
  await db.query('INSERT INTO messages(conversation_id,sender_user_id,body) VALUES($1,$2,$3)',
    [conv.rows[0].id, ids['Daniel Haile'], 'Hi Sara! Likewise! Where are you from?']);
  await db.query('UPDATE users SET free_matches_used=1 WHERE id IN ($1,$2)', [a, b]);

  // Mimi: pending premium payment (receipt = her demo photo, base64) for the admin to approve.
  const receipt = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '..', 'public', 'img', 'demo-mimi.jpg')).toString('base64');
  await db.query("INSERT INTO payments(user_id,receipt_data,amount_etb,status,type) VALUES($1,$2,99,'pending','premium')",
    [ids['Mimi Alemu'], receipt]);

  // Sara reported Daniel (pending report for the admin queue).
  await db.query('INSERT INTO reports(reporter_user_id,reported_user_id,reason) VALUES($1,$2,$3)',
    [ids['Sara Mekonnen'], ids['Daniel Haile'], 'Fake photos — does not look like his pictures.']);

  console.log('seeded OK');
  console.log('admin login: phone=' + ADMIN_PHONE + ' password=' + ADMIN_PASS);
  console.log('demo password for all demo users: ' + DEMO_PASS);
  if (!opts.keepAlive && typeof db.pool.end === 'function') await db.pool.end();
}

// Add only the v3 extra demos + v5 new demos (and their pre-likes / matched
// pairs) to a database that already has users. Idempotent: every insert is
// guarded, so running it twice changes nothing.
async function seedExtraDemos() {
  const hash = bcrypt.hashSync(DEMO_PASS, 10);
  const ids = {};
  const all = await db.query('SELECT id, name, phone FROM users');
  for (const u of all.rows) ids[u.name] = u.id;
  let added = 0;
  for (const d of [...extraDemos, ...newDemos, ...modernDemos]) {
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
  const abel = ids['Abel Tesfaye'];
  if (abel) {
    for (const n of ['Helina Girma', 'Tigist Bekele', 'Hanna Solomon', 'Meron Alemayehu']) {
      if (ids[n]) await db.query("INSERT INTO swipes(from_user_id,to_user_id,kind) VALUES($1,$2,'like') ON CONFLICT DO NOTHING", [ids[n], abel]);
    }
  }
  async function pair(aName, bName, msgs) {
    if (!ids[aName] || !ids[bName]) return;
    const lo = Math.min(ids[aName], ids[bName]), hi = Math.max(ids[aName], ids[bName]);
    await db.query("INSERT INTO swipes(from_user_id,to_user_id,kind) VALUES($1,$2,'like'),($2,$1,'like') ON CONFLICT DO NOTHING", [ids[aName], ids[bName]]);
    const mm = await db.query('INSERT INTO matches(user_a_id,user_b_id) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id', [lo, hi]);
    let mid = mm.rows.length ? mm.rows[0].id : null;
    if (!mid) {
      const ex = await db.query('SELECT id FROM matches WHERE user_a_id=$1 AND user_b_id=$2', [lo, hi]);
      mid = ex.rows[0].id;
    }
    const cc = await db.query('INSERT INTO conversations(match_id,user_a_id,user_b_id) VALUES($1,$2,$3) ON CONFLICT (match_id) DO NOTHING RETURNING id', [mid, lo, hi]);
    let cid = cc.rows.length ? cc.rows[0].id : null;
    if (!cid) {
      const ex = await db.query('SELECT id FROM conversations WHERE match_id=$1', [mid]);
      cid = ex.rows[0].id;
    }
    const n = await db.query('SELECT COUNT(*)::int AS n FROM messages WHERE conversation_id=$1', [cid]);
    if (n.rows[0].n === 0) {
      for (const [who, body] of msgs) {
        await db.query('INSERT INTO messages(conversation_id,sender_user_id,body) VALUES($1,$2,$3)', [cid, ids[who], body]);
      }
      await db.query('UPDATE users SET free_matches_used=1 WHERE id IN ($1,$2)', [lo, hi]);
    }
  }
  await pair('Helina Girma', 'Yonas Tesfaye', [
    ['Helina Girma', 'Hey Yonas! Your smile is contagious.'],
    ['Yonas Tesfaye', 'Hi Helina! Thank you — coffee sometime?'],
  ]);
  await pair('Bethlehem Tadesse', 'Dawit Haile', [
    ['Bethlehem Tadesse', 'Hi Dawit! Hawassa is beautiful this time of year.'],
    ['Dawit Haile', 'Hi Bethlehem! It really is. Want to walk by the lake sometime?'],
  ]);
  // v4: widen EVERY demo profile's age range to 18-35. A 19-year-old tester
  // got an empty Discover because every demo woman wanted 21+ — the age
  // filter in getCandidates drops anyone outside their range. Idempotent.
  const widened = await db.query(
    `UPDATE profiles SET age_min=18, age_max=35
     WHERE user_id IN (SELECT id FROM users WHERE is_demo=TRUE AND role='user')`);
  return { added, widened: widened.rowCount };
}

// Reset demo swipes only: delete every swipe FROM a demo account, then
// restore the canonical pre-seeded likes (so instant matches still work).
// Matches, messages, reports and real users' swipes are never touched.
async function resetDemoSwipes() {
  const all = await db.query('SELECT id, name FROM users WHERE is_demo=TRUE');
  const ids = {};
  for (const u of all.rows) ids[u.name] = u.id;
  const demoIds = all.rows.map((u) => u.id);
  let cleared = 0;
  if (demoIds.length) {
    const ph = demoIds.map((_, i) => '$' + (i + 1)).join(',');
    const r = await db.query(`DELETE FROM swipes WHERE from_user_id IN (${ph})`, demoIds);
    cleared = r.rowCount;
  }
  const abel = ids['Abel Tesfaye'];
  const like = async (a, b) => {
    if (ids[a] && ids[b]) await db.query("INSERT INTO swipes(from_user_id,to_user_id,kind) VALUES($1,$2,'like') ON CONFLICT DO NOTHING", [ids[a], ids[b]]);
  };
  if (abel) {
    for (const n of ['Selam Tesfaye', 'Helina Girma', 'Tigist Bekele', 'Hanna Solomon', 'Meron Alemayehu']) await like(n, abel);
  }
  await like('Sara Mekonnen', 'Daniel Haile'); await like('Daniel Haile', 'Sara Mekonnen');
  await like('Helina Girma', 'Yonas Tesfaye'); await like('Yonas Tesfaye', 'Helina Girma');
  await like('Bethlehem Tadesse', 'Dawit Haile'); await like('Dawit Haile', 'Bethlehem Tadesse');
  return cleared;
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { main, seedExtraDemos, resetDemoSwipes };
