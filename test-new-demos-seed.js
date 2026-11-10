// Fresh-seed check: USE_PGMEM=1 node test-new-demos-seed.js
process.env.USE_PGMEM = '1';
const fs = require('fs');
const path = require('path');
const db = require('./db');
const seed = require('./db/seed');

(async () => {
  await seed.main({ keepAlive: true });
  const total = await db.query("SELECT COUNT(*)::int AS c FROM users WHERE is_demo=TRUE AND role='user'");
  const rows = await db.query(
    `SELECT u.name, u.gender, u.age, u.phone, p.city, p.age_min, p.age_max, p.photo1, p.photo2, p.photo3
     FROM users u JOIN profiles p ON p.user_id=u.id
     WHERE u.is_demo=TRUE AND u.role='user' ORDER BY u.id`);
  console.log('demo users:', total.rows[0].c);
  const fresh = ['Mekdes Tadesse','Frehiwot Alemu','Mahlet Girma','Eden Bekele','Rahel Haile',
    'Liya Tesfaye','Hiwot Daniel','Selamawit Kassa','Tsion Worku','Yordanos Gebru',
    'Samuel Fikre','Natnael Teshome','Henok Alemayehu','Bereket Tadesse','Yohannes Girma'];
  let ok = true;
  for (const r of rows.rows) {
    const isNew = fresh.includes(r.name);
    if (!isNew) continue;
    const n = [r.photo1, r.photo2, r.photo3].filter(Boolean).length;
    const filesOk = [r.photo1, r.photo2, r.photo3].filter(Boolean)
      .every(p => fs.existsSync(path.join(__dirname, 'public', 'img', p.replace('/img/', ''))));
    const rangeOk = r.age_min === 18 && r.age_max === 35;
    if (!filesOk || !rangeOk) ok = false;
    console.log(`${isNew ? 'NEW' : 'old'} ${r.name} | ${r.gender} ${r.age} | ${r.city} | ${r.phone} | photos=${n} files=${filesOk} range18-35=${rangeOk}`);
  }
  const newCount = rows.rows.filter(r => fresh.includes(r.name)).length;
  const girls = rows.rows.filter(r => fresh.includes(r.name) && r.gender === 'female').length;
  const boys = rows.rows.filter(r => fresh.includes(r.name) && r.gender === 'male').length;
  const noPhoto = rows.rows.filter(r => fresh.includes(r.name) && !r.photo1).length;
  console.log(`new=${newCount} girls=${girls} boys=${boys} missing-photo1=${noPhoto}`);
  console.log(newCount === 15 && girls === 10 && boys === 5 && noPhoto === 0 && total.rows[0].c === 31 && ok ? 'SEED CHECK PASS' : 'SEED CHECK FAIL');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
