const express = require('express');
const router = express.Router();
const db = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { notifyNewRegistration, notifyActivation } = require('../config/telegram');

function uid() { return 'reg_' + Date.now() + Math.random().toString(36).slice(2,5); }

// Student: my active registrations
router.get('/', authMiddleware, (req, res) => {
  const { status } = req.query;
  let sql = `SELECT reg.*, e.title as exam_title, e.subject, e.duration as exam_duration, e.price as exam_price, e.is_active as exam_is_active
    FROM registrations reg JOIN exams e ON reg.exam_id=e.id WHERE reg.user_id=?`;
  const params = [req.user.id];
  if (status) { sql += ' AND reg.status=?'; params.push(status); }
  sql += ' ORDER BY reg.created_at DESC';
  res.json({ success: true, data: db.prepare(sql).all(...params) });
});

// Check if student has ticket for exam
router.get('/check/:examId', authMiddleware, (req, res) => {
  const reg = db.prepare('SELECT * FROM registrations WHERE user_id=? AND exam_id=?').get(req.user.id, req.params.examId);
  res.json({ success: true, hasTicket: !!reg, status: reg?.status || null, id: reg?.id || null });
});

// Pending count
router.get('/pending-count', adminMiddleware, (req, res) => {
  const r = db.prepare("SELECT COUNT(*) as c FROM registrations WHERE status='pending'").get();
  res.json({ success: true, count: r.c });
});

// Admin: all registrations
router.get('/admin/all', adminMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT reg.*, e.title as exam_title, e.price as exam_price
    FROM registrations reg JOIN exams e ON reg.exam_id=e.id
    ORDER BY reg.created_at DESC LIMIT 500
  `).all();
  res.json({ success: true, data: rows });
});

// Student buys ticket
router.post('/', authMiddleware, (req, res) => {
  const { exam_id, name, phone, whatsapp, class: cls, section } = req.body;
  if (!exam_id || !name || !phone) return res.status(400).json({ success: false, message: 'Məlumatlar natamamdır.' });
  const exam = db.prepare('SELECT * FROM exams WHERE id=? AND is_active=1').get(exam_id);
  if (!exam) return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });
  const existing = db.prepare('SELECT id FROM registrations WHERE user_id=? AND exam_id=?').get(req.user.id, exam_id);
  if (existing) return res.status(409).json({ success: false, message: 'Bu imtahan üçün artıq müraciət etmisiniz.' });
  const id = uid();
  db.prepare(`INSERT INTO registrations (id,user_id,exam_id,name,phone,whatsapp,class,section,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, req.user.id, exam_id, name, phone, whatsapp||phone, cls||'', section||'', 'pending', new Date().toISOString());
  notifyNewRegistration({ id, name, phone, whatsapp: whatsapp||phone, class: cls||'', section: section||'' }, exam).catch(()=>{});
  res.status(201).json({ success: true, message: 'Bilet sorğunuz qəbul edildi.' });
});

// Admin: manually assign exam to a student
router.post('/admin/assign', adminMiddleware, (req, res) => {
  const { user_id, exam_id, activate } = req.body;
  if (!user_id || !exam_id) return res.status(400).json({ success: false, message: 'user_id və exam_id tələb olunur.' });
  const existing = db.prepare('SELECT id FROM registrations WHERE user_id=? AND exam_id=?').get(user_id, exam_id);
  if (existing) return res.status(409).json({ success: false, message: 'Bu şagird artıq bu imtahana qeydiyyatdadır.' });
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(user_id);
  const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(exam_id);
  if (!user || !exam) return res.status(404).json({ success: false, message: 'Şagird və ya imtahan tapılmadı.' });
  const id = uid();
  const now = new Date().toISOString();
  const status = activate ? 'active' : 'pending';
  db.prepare(`INSERT INTO registrations (id,user_id,exam_id,name,phone,whatsapp,class,section,status,created_at,activated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, user_id, exam_id, user.name, user.phone, user.phone, user.class||'', user.section||'', status, now, activate?now:null);
  if (activate) {
    // Add revenue entry
    try {
      db.prepare(`INSERT OR IGNORE INTO revenues (id,registration_id,exam_id,user_id,student_name,exam_title,amount,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).run('rev_'+Date.now(), id, exam_id, user_id, user.name, exam.title, exam.price||0, 'confirmed', now);
    } catch(e) {}
  }
  res.status(201).json({ success: true, message: 'Assign edildi.' });
});

// Admin: activate registration
router.put('/:id/activate', adminMiddleware, (req, res) => {
  const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(req.params.id);
  if (!reg) return res.status(404).json({ success: false, message: 'Qeydiyyat tapılmadı.' });
  const now = new Date().toISOString();
  db.prepare("UPDATE registrations SET status='active', activated_at=? WHERE id=?").run(now, req.params.id);
  const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(reg.exam_id);
  // Add revenue
  try {
    db.prepare(`INSERT OR IGNORE INTO revenues (id,registration_id,exam_id,user_id,student_name,exam_title,amount,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run('rev_'+Date.now(), reg.id, reg.exam_id, reg.user_id, reg.name, exam?.title||'', exam?.price||0, 'confirmed', now);
  } catch(e) {}
  notifyActivation(reg, exam).catch(()=>{});
  res.json({ success: true, message: 'Aktivləşdirildi.' });
});

// Admin: change status
router.put('/:id/status', adminMiddleware, (req, res) => {
  const { status } = req.body;
  if (!['pending','active','cancelled'].includes(status)) return res.status(400).json({ success: false, message: 'Yanlış status.' });
  db.prepare('UPDATE registrations SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ success: true });
});

// Admin: edit registration details
router.put('/:id/edit', adminMiddleware, (req, res) => {
  const { name, phone, class: cls, section, status } = req.body;
  const reg = db.prepare('SELECT id FROM registrations WHERE id=?').get(req.params.id);
  if (!reg) return res.status(404).json({ success: false, message: 'Tapılmadı.' });
  const updates = [], params = [];
  if (name    !== undefined) { updates.push('name=?');    params.push(name); }
  if (phone   !== undefined) { updates.push('phone=?');   params.push(phone); }
  if (cls     !== undefined) { updates.push('class=?');   params.push(cls); }
  if (section !== undefined) { updates.push('section=?'); params.push(section); }
  if (status  !== undefined) { updates.push('status=?');  params.push(status); }
  if (!updates.length) return res.json({ success: true });
  params.push(req.params.id);
  db.prepare(`UPDATE registrations SET ${updates.join(',')} WHERE id=?`).run(...params);
  res.json({ success: true });
});

// Admin: cancel and fully delete — removes registration + revenue
router.delete('/:id/cancel', adminMiddleware, (req, res) => {
  const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(req.params.id);
  if (!reg) return res.status(404).json({ success: false, message: 'Tapılmadı.' });
  db.prepare('DELETE FROM revenues WHERE registration_id=?').run(reg.id);
  db.prepare('DELETE FROM registrations WHERE id=?').run(reg.id);
  res.json({ success: true, message: 'İcazə və ödəniş silindi.' });
});

// Admin: delete permission only (student can't see exam, but revenue stays if was paid)
router.delete('/:id', adminMiddleware, (req, res) => {
  const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(req.params.id);
  if (!reg) return res.status(404).json({ success: false, message: 'Tapılmadı.' });
  db.prepare('DELETE FROM registrations WHERE id=?').run(reg.id);
  res.json({ success: true, message: 'İcazə silindi.' });
});

module.exports = router;
