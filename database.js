const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const DB_PATH = process.env.DB_PATH || './database/abom.db';
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id             TEXT PRIMARY KEY,
    username       TEXT UNIQUE NOT NULL,
    name           TEXT NOT NULL,
    phone          TEXT NOT NULL,
    password       TEXT NOT NULL,
    plain_password TEXT DEFAULT '',
    class          TEXT DEFAULT '',
    section        TEXT DEFAULT '',
    role           TEXT DEFAULT 'student',
    parent_code    TEXT DEFAULT '',
    is_disabled    INTEGER DEFAULT 0,
    created_at     TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS parents (
    id           TEXT PRIMARY KEY,
    username     TEXT UNIQUE NOT NULL,
    name         TEXT NOT NULL,
    phone        TEXT NOT NULL,
    password     TEXT NOT NULL,
    child_codes  TEXT DEFAULT '[]',
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS exams (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    description  TEXT DEFAULT '',
    category     TEXT NOT NULL,
    subject      TEXT NOT NULL,
    class        TEXT NOT NULL,
    duration     INTEGER NOT NULL DEFAULT 60,
    price        REAL NOT NULL DEFAULT 0,
    is_active    INTEGER DEFAULT 1,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS questions (
    id           TEXT PRIMARY KEY,
    exam_id      TEXT NOT NULL,
    text         TEXT NOT NULL,
    type         TEXT NOT NULL DEFAULT 'multiple_choice',
    option_a     TEXT DEFAULT '',
    option_b     TEXT DEFAULT '',
    option_c     TEXT DEFAULT '',
    option_d     TEXT DEFAULT '',
    correct      TEXT NOT NULL,
    order_num    INTEGER DEFAULT 0,
    created_at   TEXT NOT NULL,
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS videos (
    id           TEXT PRIMARY KEY,
    title        TEXT NOT NULL,
    youtube_id   TEXT NOT NULL,
    subject      TEXT NOT NULL,
    class        TEXT NOT NULL,
    type         TEXT NOT NULL DEFAULT 'free',
    duration     TEXT DEFAULT '00:00',
    is_active    INTEGER DEFAULT 1,
    created_at   TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS registrations (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    exam_id      TEXT NOT NULL,
    name         TEXT NOT NULL,
    phone        TEXT NOT NULL,
    whatsapp     TEXT NOT NULL,
    class        TEXT NOT NULL,
    section      TEXT NOT NULL,
    status       TEXT DEFAULT 'pending',
    tg_notified  INTEGER DEFAULT 0,
    created_at   TEXT NOT NULL,
    activated_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (exam_id) REFERENCES exams(id)
  );

  CREATE TABLE IF NOT EXISTS results (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL,
    exam_id      TEXT NOT NULL,
    score        INTEGER NOT NULL,
    correct      INTEGER NOT NULL,
    total        INTEGER NOT NULL,
    answers      TEXT NOT NULL DEFAULT '{}',
    time_spent   INTEGER DEFAULT 0,
    created_at   TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (exam_id) REFERENCES exams(id)
  );

  CREATE TABLE IF NOT EXISTS cert_configs (
    id           TEXT PRIMARY KEY,
    exam_id      TEXT NOT NULL,
    level_name   TEXT NOT NULL,
    min_score    INTEGER NOT NULL,
    max_score    INTEGER NOT NULL,
    color        TEXT DEFAULT '#1355a0',
    FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS categories (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL,
    name       TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS revenues (
    id              TEXT PRIMARY KEY,
    registration_id TEXT NOT NULL UNIQUE,
    exam_id         TEXT NOT NULL,
    user_id         TEXT NOT NULL,
    student_name    TEXT NOT NULL,
    exam_title      TEXT NOT NULL,
    amount          REAL NOT NULL DEFAULT 0,
    status          TEXT DEFAULT 'confirmed',
    created_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS wa_templates (
    key       TEXT PRIMARY KEY,
    template  TEXT NOT NULL,
    label     TEXT NOT NULL
  );
`);

// ── Seed default WhatsApp templates ──────────────────────────
const seedTemplate = (key, label, template) => {
  const exists = db.prepare('SELECT key FROM wa_templates WHERE key=?').get(key);
  if (!exists) db.prepare('INSERT INTO wa_templates (key,label,template) VALUES (?,?,?)').run(key, label, template);
};
const _platformUrl = process.env.PLATFORM_URL || 'https://abom.up.railway.app';
const _cardNum     = process.env.WA_CARD_NUMBER || '0000 0000 0000 0000';

seedTemplate('register',
  'Qeydiyyat mesajı',
`😊 *ABOM - Azərbaycan Beynəlxalq Olimpiadalar Mərkəzi* - Aramıza xoş gəldiniz!.

{{name}} haqqında məlumatlara aşağıdakı link vasitəsi ilə baxa bilərsiniz.
 
👉 *İstifadəçi adı:* {{username}}
👉 *Şifrə:* {{password}}

İdarə panelinə giriş linki: ${_platformUrl}/login?u={{username_enc}}&p={{password_enc}}`);

seedTemplate('ticket',
  'Bilet alındı mesajı',
`Salam! 👋
Hörmətli {{name}},
 
"{{exam_title}}" online imtahanına qeydiyyatınız uğurla qeydə alındı ✅.

Qeydiyyatınızı tamamlamaq üçün ödəniş mərhələsini tamamlayın. 

Ödəniş gözlənilir: {{price}} ₼

Zəhmət olmasa, ödənişi aşağıda qeyd olunan kart nömrəsinə göndərdikdən sonra ödəniş çekinin şəklini bura göndərəsiniz.

Kart məlumatları:
${_cardNum}

Ödəniş çekini bizə göndərdikdən sonra övladınız üçün imtahan aktivləşdiriləcək.
İmtahanı yazıb bitirdikdən sonra Sertifikatınızı dərhal yükləyə bilərsiniz.`);

seedTemplate('activate',
  'İmtahan aktivləşdi mesajı',
`Ödənişiniz təsdiqləndi və övladınız üçün imtahan aktivləşdirildi. ✅

{{name}} siz {{exam_title}} imtahanından uğurla qeydiyyatınız tamamlandı. 

👉 İstifadəçi adı: {{username}}
👉 Şifrə: {{password}}

İmtahana giriş linki: ${_platformUrl}/login?u={{username_enc}}&p={{password_enc}}

📘 İmtahana başlamaq üçün:
1. Linkə daxil olun
2. Şagird hesabına daxil olun
3. "Aktiv İmtahanlar" düyməsinə klikləyin
4. İmtahanı seçib başlayın
{{date_line}}
Uğurlar! 🍀`);

seedTemplate('forgot_password',
  'Şifrə xatırlatma mesajı',
`🔑 ABOM — Şifrə Xatırlatması

Salam, {{name}}!

Hesab məlumatlarınız:
👉 İstifadəçi adı: {{username}}
👉 Şifrə: {{password}}

🔗 ${_platformUrl}/login?u={{username_enc}}&p={{password_enc}}

ABOM — Azərbaycan Beynəlxalq Olimpiadalar Mərkəzi`);

seedTemplate('resend_password',
  'Şifrəni yenidən göndər mesajı',
`🔑 ABOM — Şifrə Xatırlatması

Salam, {{name}}!

Hesab məlumatlarınız:
👉 İstifadəçi adı: {{username}}
👉 Şifrə: {{password}}

🔗 ${_platformUrl}/login?u={{username_enc}}&p={{password_enc}}

ABOM — Azərbaycan Beynəlxalq Olimpiadalar Mərkəzi`);

seedTemplate('password_changed',
  'Şifrə dəyişdirildi mesajı',
`🔑 ABOM — Şifrəniz Yeniləndi

Salam, {{name}}!

Hesab məlumatlarınız:
👉 İstifadəçi adı: {{username}}
👉 Yeni şifrə: {{password}}

🔗 ${_platformUrl}/login?u={{username_enc}}&p={{password_enc}}

ABOM — Azərbaycan Beynəlxalq Olimpiadalar Mərkəzi`);

// ── Migration: add missing columns to existing DBs ──────────
const tryAddCol = (tbl, col, def) => {
  try { db.exec(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${def}`); } catch(e) {}
};
tryAddCol('users', 'username', 'TEXT DEFAULT ""');
tryAddCol('users', 'parent_code', 'TEXT DEFAULT ""');
tryAddCol('questions', 'type', "TEXT NOT NULL DEFAULT 'multiple_choice'");
tryAddCol('questions', 'option_a', "TEXT DEFAULT ''");
tryAddCol('questions', 'option_b', "TEXT DEFAULT ''");
tryAddCol('questions', 'option_c', "TEXT DEFAULT ''");
tryAddCol('questions', 'option_d', "TEXT DEFAULT ''");
tryAddCol('cert_configs', 'template_url', "TEXT DEFAULT ''");
tryAddCol('cert_configs', 'template_fields', "TEXT DEFAULT '{}'");
tryAddCol('registrations', 'activated_at', "TEXT DEFAULT ''");
tryAddCol('results', 'note', "TEXT DEFAULT ''");
tryAddCol('exams', 'start_date',    "TEXT DEFAULT ''");
tryAddCol('exams', 'end_date',      "TEXT DEFAULT ''");
tryAddCol('exams', 'is_unlimited',  "INTEGER DEFAULT 1");
tryAddCol('exams', 'parent_exam_id',"TEXT DEFAULT ''");
tryAddCol('exams', 'section',       "TEXT DEFAULT ''");;
tryAddCol('exams', 'total_questions', "INTEGER DEFAULT 0");
tryAddCol('users', 'plain_password', "TEXT DEFAULT ''");
tryAddCol('users', 'is_disabled',   "INTEGER DEFAULT 0");
// Seed default categories if empty
if (!db.prepare("SELECT COUNT(*) as c FROM categories").get().c) {
  const insC = db.prepare("INSERT OR IGNORE INTO categories (id,type,name,created_at) VALUES (?,?,?,?)");
  const now = new Date().toISOString();
  ['1','2','3','4','5','6','7','8','9','10','11'].forEach((g,i) => insC.run('cls_'+i, 'class', g+'. sinif', now));
  ['Riyaziyyat','Azərbaycan dili','İngilis dili','Fizika','Kimya','Biologiya','Tarix','Coğrafiya','İnformatika'].forEach((s,i) => insC.run('sub_'+i, 'subject', s, now));
  ['AZ','RU','EN'].forEach((sec,i) => insC.run('sec_'+i, 'section', sec, now));
};;

// ── Username generator ───────────────────────────────────────
function generateUsername(name) {
  const map = {'ə':'e','ü':'u','ö':'o','ı':'i','ş':'sh','ç':'ch','ğ':'g',
               'Ə':'e','Ü':'u','Ö':'o','İ':'i','Ş':'sh','Ç':'ch','Ğ':'g'};
  const parts = name.toLowerCase().trim().split(/\s+/);
  const convert = s => s.split('').map(c => map[c] || c).join('').replace(/[^a-z0-9]/g, '');
  let base;
  if (parts.length >= 2) {
    base = convert(parts[0]) + '.' + convert(parts.slice(1).join(''));
  } else {
    base = convert(parts[0]);
  }
  let username = base;
  let counter = 1;
  while (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    username = base + counter++;
  }
  return username;
}

// ── Generate parent code ─────────────────────────────────────
function generateParentCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// ── Seed ─────────────────────────────────────────────────────
function seed() {
  const now = new Date().toISOString();

  // Fix existing users without username
  db.prepare("SELECT id, name FROM users WHERE username = '' OR username IS NULL").all()
    .forEach(u => {
      const un = generateUsername(u.name);
      db.prepare("UPDATE users SET username = ? WHERE id = ?").run(un, u.id);
    });

  // Admin
  if (!db.prepare("SELECT id FROM users WHERE role='admin'").get()) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'abom2025', 10);
    db.prepare('INSERT OR IGNORE INTO users (id,username,name,phone,password,role,created_at) VALUES (?,?,?,?,?,?,?)')
      .run('admin_001','admin_abom','Admin ABOM','0000000000',hash,'admin',now);
  }

  // Demo student
  if (!db.prepare("SELECT id FROM users WHERE id='demo_user'").get()) {
    const hash = bcrypt.hashSync('demo123', 10);
    const pc = generateParentCode();
    db.prepare('INSERT OR IGNORE INTO users (id,username,name,phone,password,class,section,role,parent_code,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('demo_user','ayten_hasanova','Aytən Həsənova','0551234567',hash,'8','az','student',pc,now);
  }

  // Exams
  if (!db.prepare('SELECT COUNT(*) as c FROM exams').get().c) {
    const ins = db.prepare('INSERT INTO exams (id,title,description,category,subject,class,duration,price,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    const exams = [
      ['ex1','Lisey Qəbul — Riyaziyyat (5-ci sinif)','5-ci sinif üçün lisey qəbul sınaq imtahanı.','lisey','riyaziyyat','5',60,8],
      ['ex2','Lisey Qəbul — Azərbaycan dili (5-ci sinif)','5-ci sinif Azərbaycan dili.','lisey','azerbaycan','5',45,8],
      ['ex3','IMO Hazırlıq — Riyaziyyat (8-ci sinif)','Beynəlxalq Olimpiada hazırlığı.','olimpiada','riyaziyyat','8',90,12],
      ['ex4','İngilis Dili Olimpiadası (6-cı sinif)','6-cı sinif ingilis dili.','olimpiada','ingilis','6',60,8],
      ['ex5','Lisey Qəbul — Kompleks (4-cü sinif)','Riyaziyyat + Azərbaycan dili.','lisey','mix','4',60,8],
      ['ex6','Azərbaycan Dili Olimpiadası (7-ci sinif)','7-ci sinif olimpiada sınağı.','olimpiada','azerbaycan','7',75,10],
    ];
    exams.forEach(e => {
      ins.run(...e, now);
      const icc = db.prepare('INSERT INTO cert_configs (id,exam_id,level_name,min_score,max_score,color) VALUES (?,?,?,?,?,?)');
      icc.run(`cc_${e[0]}_1`,e[0],'İştirak', 0, 40,'#94a3b8');
      icc.run(`cc_${e[0]}_2`,e[0],'Bürünc', 41, 70,'#b45309');
      icc.run(`cc_${e[0]}_3`,e[0],'Gümüş',  71, 85,'#64748b');
      icc.run(`cc_${e[0]}_4`,e[0],'Qızıl',  86,100,'#d97706');
    });
  }

  // Questions
  if (!db.prepare('SELECT COUNT(*) as c FROM questions').get().c) {
    const ins = db.prepare('INSERT INTO questions (id,exam_id,text,type,option_a,option_b,option_c,option_d,correct,order_num,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    const qs = [
      ['q1','ex1','2 + 2 × 3 = ?','multiple_choice','8','10','7','12','A',1],
      ['q2','ex1','√81 = ?','multiple_choice','7','9','8','6','B',2],
      ['q3','ex1','Üçbucağın daxili bucaqlarının cəmi neçədir?','multiple_choice','180°','360°','270°','90°','A',3],
      ['q4','ex1','5³ = ?','multiple_choice','15','25','125','625','C',4],
      ['q5','ex1','Hansı ədəd 7-yə bölünür?','multiple_choice','45','49','53','62','B',5],
      ['q6','ex1','15 ədədinin 40%-i neçədir?','multiple_choice','4','5','6','7','C',6],
      ['q7','ex1','72 ÷ 8 = ?','multiple_choice','7','8','9','10','C',7],
      ['q8','ex1','Hər tərəfi 6 sm olan kvadratın sahəsi?','multiple_choice','24','36','32','42','B',8],
      ['q9','ex1','3/4 + 1/4 = ?','multiple_choice','1/2','3/8','1','4/8','C',9],
      ['q10','ex1','0.5 × 12 = ?','multiple_choice','5','6','7','8','B',10],
      ['q11','ex1','Bakının paytaxt olduğu ölkənin adını yazın.','open_ended','','','','','Azərbaycan',11],
      ['q12','ex1','12 ÷ ___ = 3 (boşluğu doldurun)','fill_blank','','','','','4',12],
      ['q13','ex2','"Kitabi-Dədə Qorqud" hansı janrdadır?','multiple_choice','Roman','Dastanlar toplusu','Şeir','Hekayə','B',1],
      ['q14','ex2','"Gözəl" sözü hansı nitq hissəsidir?','multiple_choice','İsim','Feil','Sifət','Zərf','C',2],
      ['q15','ex2','"Bahar" sözündə neçə hərf var?','multiple_choice','4','5','6','7','B',3],
      ['q16','ex2','Mübtəda hansı suala cavab verir?','multiple_choice','Nə edir?','Kim? Nə?','Necə?','Harada?','B',4],
      ['q17','ex2','Azərbaycanın paytaxtının adını yazın.','open_ended','','','','','Bakı',5],
      ['q18','ex3','log₂(8) = ?','multiple_choice','2','3','4','8','B',1],
      ['q19','ex3','Əgər a+b=10, ab=21 isə a²+b² = ?','multiple_choice','58','100','79','42','A',2],
      ['q20','ex3','sin²x + cos²x = ?','multiple_choice','0','1','2','x','B',3],
      ['q21','ex3','(a+b)² = ?','multiple_choice','a²+b²','a²+2ab+b²','a²-2ab+b²','2ab','B',4],
      ['q22','ex3','x² - 5x + 6 = 0 kökləri?','multiple_choice','2 və 3','1 və 6','-2 və -3','2 və -3','A',5],
      ['q23','ex4','Plural of "child"?','multiple_choice','Childs','Children','Childrens','Child','B',1],
      ['q24','ex4','She ___ to school every day.','multiple_choice','go','going','goes','gone','C',2],
      ['q25','ex4','The opposite of "happy" is ___','fill_blank','','','','','sad',3],
    ];
    qs.forEach(q => ins.run(...q, now));
  }

  // Videos
  if (!db.prepare('SELECT COUNT(*) as c FROM videos').get().c) {
    const ins = db.prepare('INSERT INTO videos (id,title,youtube_id,subject,class,type,duration,created_at) VALUES (?,?,?,?,?,?,?,?)');
    [
      ['v1','Riyaziyyat — Kəsrlər (5-ci sinif)','dQw4w9WgXcQ','riyaziyyat','5','free','18:24'],
      ['v2','Azərbaycan dili — Morfoloji təhlil','dQw4w9WgXcQ','azerbaycan','7','free','22:10'],
      ['v3','İngilis dili — Past Simple','dQw4w9WgXcQ','ingilis','6','paid','31:05'],
      ['v4','Riyaziyyat — Cəbr əsasları','dQw4w9WgXcQ','riyaziyyat','8','paid','45:20'],
      ['v5','Lisey Qəbul — Ümumi Hazırlıq','dQw4w9WgXcQ','lisey','5','free','55:00'],
      ['v6','İngilis dili — Vocabulary','dQw4w9WgXcQ','ingilis','8','paid','28:15'],
    ].forEach(v => ins.run(...v, now));
  }

  // Demo registration + results
  if (!db.prepare("SELECT id FROM registrations WHERE id='reg_demo'").get()) {
    db.prepare('INSERT OR IGNORE INTO registrations (id,user_id,exam_id,name,phone,whatsapp,class,section,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run('reg_demo','demo_user','ex1','Aytən Həsənova','+994551234567','+994551234567','8','az','active',now);
  }
  if (!db.prepare("SELECT id FROM results WHERE id='r_demo1'").get()) {
    db.prepare('INSERT OR IGNORE INTO results (id,user_id,exam_id,score,correct,total,answers,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('r_demo1','demo_user','ex1',88,9,10,'{}',now);
    db.prepare('INSERT OR IGNORE INTO results (id,user_id,exam_id,score,correct,total,answers,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run('r_demo2','demo_user','ex3',72,4,5,'{}',now);
  }

  console.log('✓ Database ready');
}

seed();
module.exports = db;
module.exports.generateUsername = generateUsername;
module.exports.generateParentCode = generateParentCode;
