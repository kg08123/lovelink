// LoveLink seed demo data. Usage: USE_PGMEM=1 node db/seed.js
// Demo logins are documented in README.md (NOT in chat/memory).
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./index');

const DEMO_PASS = 'password123';
const ADMIN_PHONE = '0911000000';
const ADMIN_PASS = 'admin123';

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
     'Video editor & motion graphics. Coffee first, then the world.', 'serious', 'female', 20, 30,
     178, 'Orthodox', 'University', 'Video Editor', 'never', 'sometimes', 'none', 'travel,music,fitness,movies', 'demo-abel.jpg'],
    ['Selam Tesfaye', '0922000222', 'female', 24, 'Addis Ababa', 9.0100, 38.7700,
     'Dream big, work hard, and enjoy life', 'serious', 'male', 22, 32,
     165, 'Orthodox', 'University', 'Nurse', 'never', 'never', 'want', 'travel,music,fitness,movies', 'demo-selam.jpg'],
    ['Sara Mekonnen', '0922000333', 'female', 25, 'Addis Ababa', 9.0200, 38.7500,
     'Love music, movies and good food. Looking for someone real.', 'serious', 'male', 22, 32,
     168, 'Orthodox', 'College', 'Teacher', 'never', 'sometimes', 'want', 'music,movies,cooking,travel', 'demo-sara.jpg'],
    ['Mimi Alemu', '0922000444', 'female', 27, 'Addis Ababa', 8.9950, 38.7800,
     'Photographer. Always chasing golden hour.', 'marriage', 'male', 24, 35,
     170, 'Orthodox', 'University', 'Photographer', 'never', 'never', 'want', 'travel,fitness,photography,music', 'demo-mimi.jpg'],
    ['Daniel Haile', '0922000555', 'male', 26, 'Addis Ababa', 9.0150, 38.7400,
     'Gym, football, and good conversation. Simple guy.', 'serious', 'female', 20, 30,
     180, 'Orthodox', 'University', 'Engineer', 'sometimes', 'sometimes', 'none', 'fitness,football,music,travel', 'demo-daniel.jpg'],
    ['Ruth Girma', '0922000666', 'female', 26, 'Addis Ababa', 9.0080, 38.7550,
     'Book lover, night walks, and deep talks over buna.', 'serious', 'male', 23, 33,
     164, 'Protestant', 'University', 'Accountant', 'never', 'never', 'want', 'movies,reading,travel,music', 'demo-ruth.jpg'],
  ];
  const ids = {};
  for (const d of demos) {
    const [name, phone, gender, age, city, lat, lng, bio, goal, looking, aMin, aMax,
      height, religion, edu, job, smoking, drinking, kids, interests, photo] = d;
    const u = await db.query(
      "INSERT INTO users(role,name,phone,password_hash,gender,age,is_demo) VALUES('user',$1,$2,$3,$4,$5,TRUE) RETURNING id",
      [name, phone, hash, gender, age]);
    const uid = u.rows[0].id;
    ids[name] = uid;
    await db.query(
      `INSERT INTO profiles(user_id,bio,city,country,latitude,longitude,height_cm,religion,education,job,
        smoking,drinking,kids,looking_for_gender,age_min,age_max,relationship_goal,interests,languages,photo1,online)
       VALUES($1,$2,$3,'Ethiopia',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'Amharic, English',$18,TRUE)`,
      [uid, bio, city, lat, lng, height, religion, edu, job, smoking, drinking, kids,
       looking, aMin, aMax, goal, interests, '/img/' + photo]);
  }

  // Selam already liked Abel -> when Abel likes her back, it is an instant match.
  await db.query("INSERT INTO swipes(from_user_id,to_user_id,kind) VALUES($1,$2,'like')",
    [ids['Selam Tesfaye'], ids['Abel Tesfaye']]);

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

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { main };
