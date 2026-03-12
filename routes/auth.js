const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { generateUsername, generateParentCode } = require('../database');
const { authMiddleware } = require('../middleware/auth');

function genToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}
function uid() { return 'u_' + Date.now() + Math.random().toString(36).slice(2,7); }

function normalizeWaPhone(phone) {
  let p = (phone || '').replace(/\D/g, '');
  if (p.startsWith('0')) p = '994' + p.slice(1);
  if (!p.startsWith('994') && p.length === 9) p = '994' + p;
  return p;
}
async function sendWhatsApp(toPhone, message) {
  const token    = process.env.ULTRAMSG_TOKEN;
  const instance = process.env.ULTRAMSG_INSTANCE;
  if (!token || !instance) return;
  const to = normalizeWaPhone(toPhone);
  if (!to) return;
  try {
    await fetch(`https://api.ultramsg.com/${instance}/messages/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, to, body: message, priority: 10 })
    });
  } catch(e) { console.error('WhatsApp send error:', e.message); }
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { name, phone, password, confirmPassword, class: cls, section } = req.body;
  if (!name || !phone || !password || !confirmPassword)
    return res.status(400).json({ success: false, message: 'Bütün sahələr tələb olunur.' });
  if (password !== confirmPassword)
    return res.status(400).json({ success: false, message: 'Şifrələr uyğun gəlmir.' });
  if (password.length < 6)
    return res.status(400).json({ success: false, message: 'Şifrə min 6 simvol olmalıdır.' });
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length < 6)
    return res.status(400).json({ success: false, message: 'Düzgün telefon nömrəsi daxil edin.' });

  // Same phone can have multiple students — check name+phone combo
  const existing = db.prepare('SELECT id FROM users WHERE phone = ? AND name = ? AND role = ?').get(cleanPhone, name.trim(), 'student');
  if (existing)
    return res.status(409).json({ success: false, message: 'Bu ad və nömrə ilə artıq qeydiyyat var.' });

  const username = generateUsername(name.trim());
  const parentCode = generateParentCode();
  const hash = bcrypt.hashSync(password, 10);
  const id = uid();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO users (id,username,name,phone,password,class,section,role,parent_code,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, username, name.trim(), cleanPhone, hash, cls||'', section||'', 'student', parentCode, now);
  const user = db.prepare('SELECT id,username,name,phone,class,section,role,parent_code FROM users WHERE id=?').get(id);
  res.status(201).json({ success: true, token: genToken(id), user });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { phone, password, username } = req.body;
  let user;
  if (username) {
    user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  } else {
    const cleanPhone = (phone||'').replace(/\D/g, '');
    // If multiple users with same phone, return first active one or ask for username
    // Match by last 9 digits to support both old (9-digit) and new (full intl) stored numbers
    const last9 = cleanPhone.slice(-9);
    const users = db.prepare("SELECT * FROM users WHERE (phone = ? OR phone LIKE ?) AND role = 'student'").all(cleanPhone, '%'+last9);
    if (users.length > 1) {
      return res.status(300).json({ success: false, multipleAccounts: true,
        accounts: users.map(u => ({ username: u.username, name: u.name })),
        message: 'Bu nömrə ilə bir neçə hesab var. Username seçin.' });
    }
    user = users[0];
  }
  if (!user) return res.status(404).json({ success: false, message: 'İstifadəçi tapılmadı.' });
  if (!bcrypt.compareSync(password, user.password))
    return res.status(401).json({ success: false, message: 'Şifrə yanlışdır.' });
  const { password: _, ...safe } = user;
  res.json({ success: true, token: genToken(user.id), user: safe });
});

// POST /api/auth/admin-login
router.post('/admin-login', (req, res) => {
  const { username, password } = req.body;
  if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD)
    return res.status(401).json({ success: false, message: 'Yanlış admin məlumatları.' });
  const admin = db.prepare("SELECT id,username,name,phone,role FROM users WHERE role='admin'").get();
  if (!admin) return res.status(500).json({ success: false, message: 'Admin tapılmadı.' });
  res.json({ success: true, token: genToken(admin.id), user: admin });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  res.json({ success: true, user: req.user });
});

// PUT /api/auth/profile
router.put('/profile', authMiddleware, (req, res) => {
  const { name, class: cls, section } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Ad tələb olunur.' });
  db.prepare('UPDATE users SET name=?,class=?,section=? WHERE id=?').run(name.trim(), cls||'', section||'', req.user.id);
  const u = db.prepare('SELECT id,username,name,phone,class,section,role,parent_code FROM users WHERE id=?').get(req.user.id);
  res.json({ success: true, user: u });
});

// PUT /api/auth/change-password
router.put('/change-password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword, confirmPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 6)
    return res.status(400).json({ success: false, message: 'Şifrə məlumatları natamamdır.' });
  if (newPassword !== confirmPassword)
    return res.status(400).json({ success: false, message: 'Yeni şifrələr uyğun gəlmir.' });
  const user = db.prepare('SELECT password FROM users WHERE id=?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password))
    return res.status(401).json({ success: false, message: 'Köhnə şifrə yanlışdır.' });
  db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), req.user.id);
  res.json({ success: true, message: 'Şifrə dəyişdirildi.' });
});

// Parent login
router.post('/parent-login', (req, res) => {
  const { phone, password } = req.body;
  const cleanPhone = (phone||'').replace(/\D/g,'').slice(-9);
  const parent = db.prepare('SELECT * FROM parents WHERE phone=?').get(cleanPhone);
  if (!parent) return res.status(404).json({ success: false, message: 'Valideyn hesabı tapılmadı.' });
  if (!bcrypt.compareSync(password, parent.password))
    return res.status(401).json({ success: false, message: 'Şifrə yanlışdır.' });
  const token = jwt.sign({ id: parent.id, role: 'parent' }, process.env.JWT_SECRET, { expiresIn: '7d' });
  const { password: _, ...safe } = parent;
  res.json({ success: true, token, user: { ...safe, role: 'parent' } });
});

// Parent register
router.post('/parent-register', (req, res) => {
  const { name, phone, password, childCode } = req.body;
  if (!name || !phone || !password || !childCode)
    return res.status(400).json({ success: false, message: 'Bütün sahələr tələb olunur.' });
  const cleanPhone = phone.replace(/\D/g,'').slice(-9);
  const child = db.prepare("SELECT id,name,username FROM users WHERE parent_code=? AND role='student'").get(childCode.trim().toUpperCase());
  if (!child) return res.status(404).json({ success: false, message: 'Bu kod ilə şagird tapılmadı.' });
  const existing = db.prepare('SELECT id FROM parents WHERE phone=?').get(cleanPhone);
  if (existing) {
    // Add child to existing parent
    const p = db.prepare('SELECT * FROM parents WHERE phone=?').get(cleanPhone);
    if (!bcrypt.compareSync(password, p.password))
      return res.status(401).json({ success: false, message: 'Şifrə yanlışdır.' });
    const codes = JSON.parse(p.child_codes || '[]');
    if (!codes.includes(child.id)) {
      codes.push(child.id);
      db.prepare('UPDATE parents SET child_codes=? WHERE id=?').run(JSON.stringify(codes), p.id);
    }
    const token = jwt.sign({ id: p.id, role: 'parent' }, process.env.JWT_SECRET, { expiresIn: '7d' });
    return res.json({ success: true, token, message: `${child.name} hesabınıza əlavə edildi.` });
  }
  const hash = bcrypt.hashSync(password, 10);
  const id = 'par_' + Date.now();
  let un = name.toLowerCase().replace(/\s+/g,'_') + '_valideyn';
  db.prepare('INSERT INTO parents (id,username,name,phone,password,child_codes,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, un, name.trim(), cleanPhone, hash, JSON.stringify([child.id]), new Date().toISOString());
  const token = jwt.sign({ id, role: 'parent' }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.status(201).json({ success: true, token, message: `Qeydiyyat uğurlu. ${child.name} uşağınız əlavə edildi.` });
});

// POST /api/auth/forgot-password — generate new password, send via WhatsApp
router.post('/forgot-password', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, message: 'Telefon nömrəsi tələb olunur.' });
  const cleanPhone = phone.replace(/\D/g, '');
  const last9 = cleanPhone.slice(-9);
  const user = db.prepare("SELECT * FROM users WHERE (phone=? OR phone LIKE ?) AND role='student' LIMIT 1")
    .get(cleanPhone, '%' + last9);
  if (!user) return res.status(404).json({ success: false, message: 'Bu nömrə ilə istifadəçi tapılmadı.' });

  // Generate 8-char random password (letters + digits)
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const newPassword = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  db.prepare('UPDATE users SET password=? WHERE id=?').run(bcrypt.hashSync(newPassword, 10), user.id);

  // Send via WhatsApp
  const waPhone = user.whatsapp || user.phone;
  const link = process.env.PLATFORM_URL || 'https://abom-backend-production.up.railway.app';
  await sendWhatsApp(waPhone,
`🔑 ABOM — Şifrə Yeniləndi

Salam, ${user.name}!

Yeni şifrəniz aşağıdadır:

👤 İstifadəçi adı: ${user.username || user.phone}
🔑 Yeni şifrə: ${newPassword}

🔗 ${link}

Daxil olduqdan sonra şifrənizi dəyişdirməyinizi tövsiyə edirik.

ABOM — Azərbaycan Beynəlxalq Olimpiadalar Mərkəzi`);

  res.json({ success: true, message: 'Yeni şifrə WhatsApp nömrənizə göndərildi.' });
});

module.exports = router;
