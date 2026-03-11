const express = require('express');
const router = express.Router();
const db = require('../database');
const { adminMiddleware } = require('../middleware/auth');
const tg = require('../config/telegram');

// GET /api/admin/stats — dashboard stats
router.get('/stats', adminMiddleware, (req, res) => {
  const stats = {
    users:         db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'student'").get().c,
    registrations: db.prepare('SELECT COUNT(*) as c FROM registrations').get().c,
    pending:       db.prepare("SELECT COUNT(*) as c FROM registrations WHERE status = 'pending'").get().c,
    active:        db.prepare("SELECT COUNT(*) as c FROM registrations WHERE status = 'active'").get().c,
    exams:         db.prepare('SELECT COUNT(*) as c FROM exams WHERE is_active = 1').get().c,
    questions:     db.prepare('SELECT COUNT(*) as c FROM questions').get().c,
    videos:        db.prepare('SELECT COUNT(*) as c FROM videos WHERE is_active = 1').get().c,
    results:       db.prepare('SELECT COUNT(*) as c FROM results').get().c,
    avg_score:     db.prepare('SELECT ROUND(AVG(score),1) as avg FROM results').get().avg || 0,
    certs_issued:  0 // calculated below
  };
  // Count certs issued
  const results = db.prepare('SELECT r.score, r.exam_id FROM results r').all();
  let certsIssued = 0;
  results.forEach(r => {
    const cfg = db.prepare('SELECT id FROM cert_configs WHERE exam_id = ? AND min_score <= ? AND max_score >= ?').get(r.exam_id, r.score, r.score);
    if (cfg) certsIssued++;
  });
  stats.certs_issued = certsIssued;
  // Revenue (registrations * exam price, estimate)
  const revenue = db.prepare(`SELECT SUM(e.price) as total FROM registrations r JOIN exams e ON r.exam_id = e.id WHERE r.status = 'active'`).get();
  stats.revenue_azn = revenue.total || 0;
  res.json({ success: true, data: stats });
});

// GET /api/admin/users — all users
router.get('/users', adminMiddleware, (req, res) => {
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
  const users = db.prepare(sql).all(...params);
  res.json({ success: true, data: users });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', adminMiddleware, (req, res) => {
  if (req.params.id === 'admin_001') return res.status(403).json({ success: false, message: 'Admin silinə bilməz.' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'İstifadəçi silindi.' });
});

// POST /api/admin/telegram/test — test telegram connection
router.post('/telegram/test', adminMiddleware, async (req, res) => {
  const ok = await tg.sendMessage(`🔔 <b>ABOM Test Mesajı</b>\n\nBot işləyir! ✅\n${new Date().toLocaleString('az-AZ')}`);
  res.json({ success: ok, message: ok ? 'Telegram mesajı göndərildi!' : 'Telegram xətası.' });
});

// GET /api/admin/activity — recent activity log
router.get('/activity', adminMiddleware, (req, res) => {
  const recentRegs = db.prepare(`SELECT 'registration' as type, r.created_at, r.name, e.title as detail, r.status
                                  FROM registrations r JOIN exams e ON r.exam_id = e.id
                                  ORDER BY r.created_at DESC LIMIT 10`).all();
  const recentResults = db.prepare(`SELECT 'result' as type, r.created_at, u.name, e.title as detail, CAST(r.score as TEXT) as status
                                     FROM results r JOIN users u ON r.user_id = u.id JOIN exams e ON r.exam_id = e.id
                                     ORDER BY r.created_at DESC LIMIT 10`).all();
  const activity = [...recentRegs, ...recentResults]
    .sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0,20);
  res.json({ success: true, data: activity });
});

module.exports = router;

// PUT /api/admin/users/:id — edit user
router.put('/users/:id', adminMiddleware, (req, res) => {
  const { name, phone, class: cls, section, username } = req.body;
  const user = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ success: false, message: 'İstifadəçi tapılmadı.' });
  const updates = [], params = [];
  if (name     !== undefined) { updates.push('name=?');     params.push(name.trim()); }
  if (phone    !== undefined) { updates.push('phone=?');    params.push(phone); }
  if (cls      !== undefined) { updates.push('class=?');    params.push(cls); }
  if (section  !== undefined) { updates.push('section=?');  params.push(section); }
  if (username !== undefined) { updates.push('username=?'); params.push(username.trim()); }
  if (!updates.length) return res.json({ success: true });
  params.push(req.params.id);
  try {
    db.prepare(`UPDATE users SET ${updates.join(',')} WHERE id=?`).run(...params);
    res.json({ success: true });
  } catch(e) {
    res.status(400).json({ success: false, message: 'Username artıq mövcuddur.' });
  }
});
