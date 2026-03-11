const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('../config/uuid');
const db = require('../database');
const { authMiddleware } = require('../middleware/auth');

function genToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
}

// POST /api/auth/register
router.post('/register', (req, res) => {
  const { name, phone, password } = req.body;
  if (!name || !phone || !password) {
    return res.status(400).json({ success: false, message: 'Ad, telefon və şifrə tələb olunur.' });
  }
  const cleanPhone = phone.replace(/\D/g, '');
  if (cleanPhone.length < 9) {
    return res.status(400).json({ success: false, message: 'Düzgün telefon nömrəsi daxil edin.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ success: false, message: 'Şifrə min 6 simvol olmalıdır.' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE phone = ?').get(cleanPhone);
  if (existing) {
    return res.status(409).json({ success: false, message: 'Bu nömrə artıq qeydiyyatdadır.' });
  }
  const hashedPass = bcrypt.hashSync(password, 10);
  const id = 'u_' + uuidv4();
  const now = new Date().toISOString();
  db.prepare('INSERT INTO users (id,name,phone,password,role,created_at) VALUES (?,?,?,?,?,?)')
    .run(id, name.trim(), cleanPhone, hashedPass, 'student', now);
  const token = genToken(id);
  const user = db.prepare('SELECT id,name,phone,class,section,role FROM users WHERE id = ?').get(id);
  res.status(201).json({ success: true, token, user });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) {
    return res.status(400).json({ success: false, message: 'Telefon və şifrə tələb olunur.' });
  }
  const cleanPhone = phone.replace(/\D/g, '');
  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(cleanPhone);
  if (!user) {
    return res.status(404).json({ success: false, message: 'Bu nömrə tapılmadı.' });
  }
  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ success: false, message: 'Şifrə yanlışdır.' });
  }
  const token = genToken(user.id);
  const { password: _, ...safeUser } = user;
  res.json({ success: true, token, user: safeUser });
});

// POST /api/auth/admin-login
router.post('/admin-login', (req, res) => {
  const { username, password } = req.body;
  if (username !== process.env.ADMIN_USERNAME || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ success: false, message: 'Yanlış admin məlumatları.' });
  }
  const admin = db.prepare('SELECT id,name,phone,role FROM users WHERE role = ?').get('admin');
  if (!admin) return res.status(500).json({ success: false, message: 'Admin tapılmadı.' });
  const token = genToken(admin.id);
  res.json({ success: true, token, user: admin });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  res.json({ success: true, user: req.user });
});

// PUT /api/auth/profile
router.put('/profile', authMiddleware, (req, res) => {
  const { name, class: cls, section } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'Ad tələb olunur.' });
  db.prepare('UPDATE users SET name = ?, class = ?, section = ? WHERE id = ?')
    .run(name.trim(), cls || '', section || '', req.user.id);
  const updated = db.prepare('SELECT id,name,phone,class,section,role FROM users WHERE id = ?').get(req.user.id);
  res.json({ success: true, user: updated });
});

// PUT /api/auth/change-password
router.put('/change-password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ success: false, message: 'Köhnə şifrə və min 6 simvollu yeni şifrə tələb olunur.' });
  }
  const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(currentPassword, user.password)) {
    return res.status(401).json({ success: false, message: 'Köhnə şifrə yanlışdır.' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hash, req.user.id);
  res.json({ success: true, message: 'Şifrə dəyişdirildi.' });
});

module.exports = router;
