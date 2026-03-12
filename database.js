const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') || process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false } : false,
});

// SQLite-compat wrapper — converts ? → $1,$2 automatically
function toPos(sql) { let i=0; return sql.replace(/\?/g, ()=>`$${++i}`); }

const db = {
  async get(sql, params=[]) {
    const {rows} = await pool.query(toPos(sql), params);
    return rows[0] || null;
  },
  async all(sql, params=[]) {
    const {rows} = await pool.query(toPos(sql), params);
    return rows;
  },
  async run(sql, params=[]) {
    const res = await pool.query(toPos(sql), params);
    return { changes: res.rowCount, lastID: res.rows?.[0]?.id };
  },
  async exec(sql) { await pool.query(sql); },
  pool,
};

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      phone TEXT NOT NULL, password TEXT NOT NULL, plain_password TEXT DEFAULT '',
      class TEXT DEFAULT '', section TEXT DEFAULT '', role TEXT DEFAULT 'student',
      parent_code TEXT DEFAULT '', is_disabled INTEGER DEFAULT 0, whatsapp TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS parents (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      phone TEXT NOT NULL, password TEXT NOT NULL, child_codes TEXT DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS exams (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT DEFAULT '',
      category TEXT NOT NULL, subject TEXT NOT NULL, class TEXT NOT NULL,
      duration INTEGER NOT NULL DEFAULT 60, price REAL NOT NULL DEFAULT 0,
      is_active INTEGER DEFAULT 1, start_date TEXT DEFAULT '', end_date TEXT DEFAULT '',
      is_unlimited INTEGER DEFAULT 1, parent_exam_id TEXT DEFAULT '',
      section TEXT DEFAULT '', total_questions INTEGER DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, text TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'multiple_choice',
      option_a TEXT DEFAULT '', option_b TEXT DEFAULT '',
      option_c TEXT DEFAULT '', option_d TEXT DEFAULT '',
      correct TEXT NOT NULL, order_num INTEGER DEFAULT 0, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, youtube_id TEXT NOT NULL,
      subject TEXT NOT NULL, class TEXT NOT NULL, type TEXT NOT NULL DEFAULT 'free',
      duration TEXT DEFAULT '00:00', is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registrations (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, exam_id TEXT NOT NULL,
      name TEXT NOT NULL, phone TEXT NOT NULL, whatsapp TEXT NOT NULL,
      class TEXT NOT NULL, section TEXT NOT NULL, status TEXT DEFAULT 'pending',
      tg_notified INTEGER DEFAULT 0, created_at TEXT NOT NULL, activated_at TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS results (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, exam_id TEXT NOT NULL,
      score INTEGER NOT NULL, correct INTEGER NOT NULL, total INTEGER NOT NULL,
      answers TEXT NOT NULL DEFAULT '{}', time_spent INTEGER DEFAULT 0,
      note TEXT DEFAULT '', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cert_configs (
      id TEXT PRIMARY KEY, exam_id TEXT NOT NULL, level_name TEXT NOT NULL,
      min_score INTEGER NOT NULL, max_score INTEGER NOT NULL,
      color TEXT DEFAULT '#1355a0', template_url TEXT DEFAULT '',
      template_fields TEXT DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS revenues (
      id TEXT PRIMARY KEY, registration_id TEXT NOT NULL UNIQUE,
      exam_id TEXT NOT NULL, user_id TEXT NOT NULL, student_name TEXT NOT NULL,
      exam_title TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'confirmed', created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS wa_templates (
      key TEXT PRIMARY KEY, template TEXT NOT NULL, label TEXT NOT NULL
    );
  `);
}

// Username generator (async for pg)
const _map = {'ə':'e','ü':'u','ö':'o','ı':'i','ş':'sh','ç':'ch','ğ':'g','Ə':'e','Ü':'u','Ö':'o','İ':'i','Ş':'sh','Ç':'ch','Ğ':'g'};
function latinize(s){ return s.split('').map(c=>_map[c]||c).join('').replace(/[^a-z0-9]/g,''); }
async function generateUsername(name) {
  const parts = name.toLowerCase().trim().split(/\s+/);
  let base = parts.length >= 2 ? latinize(parts[0])+'.'+latinize(parts.slice(1).join('')) : latinize(parts[0]);
  let username = base, counter = 1;
  while (await db.get('SELECT id FROM users WHERE username=?',[username])) username = base + counter++;
  return username;
}
function generateParentCode() {
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code=''; for(let i=0;i<6;i++) code+=chars[Math.floor(Math.random()*chars.length)];
  return code;
}

async function seed() {
  const now = new Date().toISOString();
  const _url = process.env.PLATFORM_URL || 'https://abom.up.railway.app';
  const _card = process.env.WA_CARD_NUMBER || '0000 0000 0000 0000';

  const tpls = [
    ['register','Qeydiyyat mesajı',`😊 *ABOM - Azərbaycan Beynəlxalq Olimpiadalar Mərkəzi* - Aramıza xoş gəldiniz!.\n\n{{name}} haqqında məlumatlara aşağıdakı link vasitəsi ilə baxa bilərsiniz.\n \n👉 *İstifadəçi adı:* {{username}}\n👉 *Şifrə:* {{password}}\n\nİdarə panelinə giriş linki: ${_url}/login?u={{username_enc}}&p={{password_enc}}`],
    ['ticket','Bilet alındı mesajı',`Salam! 👋\nHörmətli {{name}},\n \n"{{exam_title}}" online imtahanına qeydiyyatınız uğurla qeydə alındı ✅.\n\nQeydiyyatınızı tamamlamaq üçün ödəniş mərhələsini tamamlayın. \n\nÖdəniş gözlənilir: {{price}} ₼\n\nZəhmət olmasa, ödənişi aşağıda qeyd olunan kart nömrəsinə göndərdikdən sonra ödəniş çekinin şəklini bura göndərəsiniz.\n\nKart məlumatları:\n${_card}\n\nÖdəniş çekini bizə göndərdikdən sonra övladınız üçün imtahan aktivləşdiriləcək.\nİmtahanı yazıb bitirdikdən sonra Sertifikatınızı dərhal yükləyə bilərsiniz.`],
    ['activate','İmtahan aktivləşdi mesajı',`Ödənişiniz təsdiqləndi və övladınız üçün imtahan aktivləşdirildi. ✅\n\n{{name}} siz {{exam_title}} imtahanından uğurla qeydiyyatınız tamamlandı. \n\n👉 İstifadəçi adı: {{username}}\n👉 Şifrə: {{password}}\n\nİmtahana giriş linki: ${_url}/login?u={{username_enc}}&p={{password_enc}}\n\n📘 İmtahana başlamaq üçün:\n1. Linkə daxil olun\n2. Şagird hesabına daxil olun\n3. "Aktiv İmtahanlar" düyməsinə klikləyin\n4. İmtahanı seçib başlayın\n{{date_line}}\nUğurlar! 🍀`],
    ['forgot_password','Şifrə xatırlatma mesajı',`🔑 ABOM — Şifrə Xatırlatması\n\nSalam, {{name}}!\n\nHesab məlumatlarınız:\n👉 İstifadəçi adı: {{username}}\n👉 Şifrə: {{password}}\n\n🔗 ${_url}/login?u={{username_enc}}&p={{password_enc}}\n\nABOM — Azərbaycan Beynəlxalq Olimpiadalar Mərkəzi`],
    ['resend_password','Şifrəni yenidən göndər mesajı',`🔑 ABOM — Şifrə Xatırlatması\n\nSalam, {{name}}!\n\nHesab məlumatlarınız:\n👉 İstifadəçi adı: {{username}}\n👉 Şifrə: {{password}}\n\n🔗 ${_url}/login?u={{username_enc}}&p={{password_enc}}\n\nABOM — Azərbaycan Beynəlxalq Olimpiadalar Mərkəzi`],
    ['password_changed','Şifrə dəyişdirildi mesajı',`🔑 ABOM — Şifrəniz Yeniləndi\n\nSalam, {{name}}!\n\nHesab məlumatlarınız:\n👉 İstifadəçi adı: {{username}}\n👉 Yeni şifrə: {{password}}\n\n🔗 ${_url}/login?u={{username_enc}}&p={{password_enc}}\n\nABOM — Azərbaycan Beynəlxalq Olimpiadalar Mərkəzi`],
  ];
  for (const [key,label,template] of tpls)
    await db.run('INSERT INTO wa_templates(key,label,template) VALUES(?,?,?) ON CONFLICT(key) DO NOTHING',[key,label,template]);

  const catC = await db.get('SELECT COUNT(*) as c FROM categories',[]);
  if (!catC || catC.c == 0) {
    for (const [i,g] of ['1','2','3','4','5','6','7','8','9','10','11'].entries())
      await db.run('INSERT INTO categories(id,type,name,created_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING',['cls_'+i,'class',g+'. sinif',now]);
    for (const [i,s] of ['Riyaziyyat','Azərbaycan dili','İngilis dili','Fizika','Kimya','Biologiya','Tarix','Coğrafiya','İnformatika'].entries())
      await db.run('INSERT INTO categories(id,type,name,created_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING',['sub_'+i,'subject',s,now]);
    for (const [i,sec] of ['AZ','RU','EN'].entries())
      await db.run('INSERT INTO categories(id,type,name,created_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING',['sec_'+i,'section',sec,now]);
  }

  const adminEx = await db.get("SELECT id FROM users WHERE role='admin'",[]);
  if (!adminEx) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD||'abom2025',10);
    await db.run('INSERT INTO users(id,username,name,phone,password,role,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT DO NOTHING',
      ['admin_001','admin_abom','Admin ABOM','0000000000',hash,'admin',now]);
  }

  console.log('✓ PostgreSQL ready');
}

async function init() {
  try { await initSchema(); await seed(); }
  catch(e) { console.error('DB init error:', e.message); }
}
init();

module.exports = db;
module.exports.generateUsername = generateUsername;
module.exports.generateParentCode = generateParentCode;
