const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database');
const { adminMiddleware } = require('../middleware/auth');
const tg = require('../config/telegram');
const { sendTemplate } = require('../config/whatsapp');

async function waPasswordChanged(user, newPassword) {
  const waPhone = user.whatsapp || user.phone;
  if (!waPhone) return;
  await sendTemplate(waPhone, 'password_changed', {
    name:         user.name,
    username:     user.username || user.phone,
    password:     newPassword,
    username_enc: encodeURIComponent(user.username || user.phone),
    password_enc: encodeURIComponent(newPassword),
  });
}

// GET /api/admin/stats — dashboard stats
router.get('/stats', adminMiddleware, async (req, res) => {
  const stats = {
    users:         await db.get("SELECT COUNT(*) as c FROM users WHERE role = 'student'", []).c,
    registrations: await db.get('SELECT COUNT(*) as c FROM registrations', []).c,
    pending:       await db.get("SELECT COUNT(*) as c FROM registrations WHERE status = 'pending'", []).c,
    active:        await db.get("SELECT COUNT(*) as c FROM registrations WHERE status = 'active'", []).c,
    exams:         await db.get('SELECT COUNT(*) as c FROM exams WHERE is_active = 1', []).c,
    questions:     await db.get('SELECT COUNT(*) as c FROM questions', []).c,
    videos:        await db.get('SELECT COUNT(*) as c FROM videos WHERE is_active = 1', []).c,
    results:       await db.get('SELECT COUNT(*) as c FROM results', []).c,
    avg_score:     await db.get('SELECT ROUND(AVG(score),1) as avg FROM results', []).avg || 0,
    certs_issued:  0 // calculated below
  };
  // Count certs issued
  const results = await db.all('SELECT r.score, r.exam_id FROM results r', []);
  let certsIssued = 0;
  for (const r of results) {
    const cfg = await db.get('SELECT id FROM cert_configs WHERE exam_id = ? AND min_score <= ? AND max_score >= ?', [r.exam_id, r.score, r.score]);
    if (cfg) certsIssued++;
  }
  stats.certs_issued = certsIssued;
  // Revenue (registrations * exam price, estimate)
  const revenue = await db.get(`SELECT SUM(e.price) as total FROM registrations r JOIN exams e ON r.exam_id = e.id WHERE r.status = 'active'`, []);
  stats.revenue_azn = revenue.total || 0;
  res.json({ success: true, data: stats });
});

// GET /api/admin/users — all users
router.get('/users', adminMiddleware, async (req, res) => {
  const { search, page = 1, limit = 30 } = req.query;
  const offset = (page - 1) * limit;
  let sql = `SELECT u.id, u.name, u.phone, u.class, u.section, u.role, u.created_at,
               (SELECT COUNT(*) FROM registrations r WHERE r.user_id = u.id) as reg_count,
               (SELECT COUNT(*) FROM results res WHERE res.user_id = u.id) as result_count
             FROM users u WHERE u.role = 'student'`;
  const params = [];
  if (search) { sql += ' AND (u.name LIKE ? OR u.phone LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  const users = await db.all(sql, params);
  res.json({ success: true, data: users });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', adminMiddleware, async (req, res) => {
  if (req.params.id === 'admin_001') return res.status(403).json({ success: false, message: 'Admin silinə bilməz.' });
  await db.run('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'İstifadəçi silindi.' });
});

// POST /api/admin/telegram/test — test telegram connection
router.post('/telegram/test', adminMiddleware, async (req, res) => {
  const ok = await tg.sendMessage(`🔔 <b>ABOM Test Mesajı</b>\n\nBot işləyir! ✅\n${new Date().toLocaleString('az-AZ')}`);
  res.json({ success: ok, message: ok ? 'Telegram mesajı göndərildi!' : 'Telegram xətası.' });
});

// GET /api/admin/activity — recent activity log
router.get('/activity', adminMiddleware, async (req, res) => {
  const recentRegs = await db.all(`SELECT 'registration' as type, r.created_at, r.name, e.title as detail, r.status
                                  FROM registrations r JOIN exams e ON r.exam_id = e.id
                                  ORDER BY r.created_at DESC LIMIT 10`, []);
  const recentResults = await db.all(`SELECT 'result' as type, r.created_at, u.name, e.title as detail, CAST(r.score as TEXT) as status
                                     FROM results r JOIN users u ON r.user_id = u.id JOIN exams e ON r.exam_id = e.id
                                     ORDER BY r.created_at DESC LIMIT 10`, []);
  const activity = [...recentRegs, ...recentResults]
    .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0,20);
  res.json({ success: true, data: activity });
});

// PUT /api/admin/users/:id — edit user
router.put('/users/:id', adminMiddleware, async (req, res) => {
  const { name, phone, class: cls, section, username, password } = req.body;
  const user = await db.get('SELECT * FROM users WHERE id=?', [req.params.id]);
  if (!user) return res.status(404).json({ success: false, message: 'İstifadəçi tapılmadı.' });
  const updates = [], params = [];
  if (name     !== undefined) { updates.push('name=?');     params.push(name.trim()); }
  if (phone    !== undefined) { updates.push('phone=?');    params.push(phone); }
  if (cls      !== undefined) { updates.push('class=?');    params.push(cls); }
  if (section  !== undefined) { updates.push('section=?');  params.push(section); }
  if (username !== undefined) { updates.push('username=?'); params.push(username.trim()); }
  const newPassword = (password || '').trim();
  const changingPassword = newPassword.length >= 4;
  if (changingPassword) {
    updates.push('password=?');
    params.push(bcrypt.hashSync(newPassword, 10));
    updates.push('plain_password=?');
    params.push(newPassword);
  }
  if (!updates.length) return res.json({ success: true });
  params.push(req.params.id);
  try {
    await db.run(`UPDATE users SET ${updates.join(',')} WHERE id=?`, [...params]);
    // Send WhatsApp if password was changed
    if (changingPassword) {
      const updatedUser = { ...user, name: name||user.name, username: username||user.username, phone: phone||user.phone };
      waPasswordChanged(updatedUser, newPassword).catch(()=>{});
    }
    res.json({ success: true });
  } catch(e) {
    res.status(400).json({ success: false, message: 'Username artıq mövcuddur.' });
  }
});

// POST /api/admin/users/:id/resend-password — send current plain_password via WhatsApp
router.post('/users/:id/resend-password', adminMiddleware, async (req, res) => {
  const user = await db.get('SELECT * FROM users WHERE id=?', [req.params.id]);
  if (!user) return res.status(404).json({ success: false, message: 'İstifadəçi tapılmadı.' });
  if (!user.plain_password) return res.status(400).json({ success: false, message: 'Bu istifadəçi üçün şifrə məlumatı yoxdur.' });
  await sendTemplate(user.whatsapp || user.phone, 'resend_password', {
    name:         user.name,
    username:     user.username,
    password:     user.plain_password,
    username_enc: encodeURIComponent(user.username),
    password_enc: encodeURIComponent(user.plain_password),
  });
  res.json({ success: true, message: 'Şifrə WhatsApp-a göndərildi.' });
});

// PUT /api/admin/users/:id/toggle-disable — disable or enable user
router.put('/users/:id/toggle-disable', adminMiddleware, async (req, res) => {
  const user = await db.get('SELECT id, is_disabled FROM users WHERE id=?', [req.params.id]);
  if (!user) return res.status(404).json({ success: false, message: 'İstifadəçi tapılmadı.' });
  const newState = user.is_disabled ? 0 : 1;
  await db.run('UPDATE users SET is_disabled=? WHERE id=?', [newState, req.params.id]);
  res.json({ success: true, is_disabled: newState });
});

// GET /api/admin/wa-templates
router.get('/wa-templates', adminMiddleware, async (req, res) => {
  const rows = await db.all('SELECT key, label, template FROM wa_templates ORDER BY key', []);
  res.json({ success: true, data: rows });
});

// PUT /api/admin/wa-templates/:key
router.put('/wa-templates/:key', adminMiddleware, async (req, res) => {
  const { template } = req.body;
  if (!template) return res.status(400).json({ success: false, message: 'Şablon boş ola bilməz.' });
  const row = await db.get('SELECT key FROM wa_templates WHERE key=?', [req.params.key]);
  if (!row) return res.status(404).json({ success: false, message: 'Şablon tapılmadı.' });
  await db.run('UPDATE wa_templates SET template=? WHERE key=?', [template, req.params.key]);
  res.json({ success: true });
});

module.exports = router;
