const express = require('express');
const router = express.Router();
const db = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { notifyNewRegistration, notifyActivation } = require('../config/telegram');

function uid() { return 'reg_' + Date.now() + Math.random().toString(36).slice(2,5); }

// GET /api/registrations — student: my active registrations
router.get('/', authMiddleware, (req, res) => {
  const { status } = req.query;
  let sql = `SELECT reg.*, e.title as exam_title, e.subject, e.duration as exam_duration, e.price as exam_price
    FROM registrations reg JOIN exams e ON reg.exam_id=e.id WHERE reg.user_id=?`;
  const params = [req.user.id];
  if (status) { sql += ' AND reg.status=?'; params.push(status); }
  sql += ' ORDER BY reg.created_at DESC';
  res.json({ success: true, data: db.prepare(sql).all(...params) });
});

// GET /api/registrations/check/:examId — has ticket?
router.get('/check/:examId', authMiddleware, (req, res) => {
  const reg = db.prepare('SELECT * FROM registrations WHERE user_id=? AND exam_id=?').get(req.user.id, req.params.examId);
  res.json({ success: true, hasTicket: !!reg, status: reg?.status || null, id: reg?.id || null });
});

// GET /api/registrations/pending-count — admin
router.get('/pending-count', adminMiddleware, (req, res) => {
  const r = db.prepare("SELECT COUNT(*) as c FROM registrations WHERE status='pending'").get();
  res.json({ success: true, count: r.c });
});

// GET /api/registrations — admin: all
router.get('/admin/all', adminMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT reg.*, e.title as exam_title, e.price as exam_price
    FROM registrations reg JOIN exams e ON reg.exam_id=e.id
    ORDER BY reg.created_at DESC LIMIT 500
  `).all();
  res.json({ success: true, data: rows });
});

// POST /api/registrations — student buys ticket
router.post('/', authMiddleware, (req, res) => {
  const { exam_id, name, phone, whatsapp, class: cls, section } = req.body;
  if (!exam_id || !name || !phone) return res.status(400).json({ success: false, message: 'Məlumatlar natamamdır.' });
  const exam = db.prepare('SELECT * FROM exams WHERE id=? AND is_active=1').get(exam_id);
  if (!exam) return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });
  const existing = db.prepare('SELECT id FROM registrations WHERE user_id=? AND exam_id=?').get(req.user.id, exam_id);
  if (existing) return res.status(409).json({ success: false, message: 'Bu imtahan üçün artıq müraciət etmisiniz.' });
  const id = uid();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO registrations (id,user_id,exam_id,name,phone,whatsapp,class,section,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id, req.user.id, exam_id, name, phone, whatsapp||phone, cls||'', section||'', 'pending', now);
  // Notify telegram
  notifyNewRegistration({ id, name, phone, whatsapp: whatsapp||phone, class: cls||'', section: section||'' }, exam).catch(()=>{});
  res.status(201).json({ success: true, message: 'Bilet sorğunuz qəbul edildi.' });
});

// PUT /api/registrations/:id/activate — admin activates
router.put('/:id/activate', adminMiddleware, (req, res) => {
  const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(req.params.id);
  if (!reg) return res.status(404).json({ success: false, message: 'Qeydiyyat tapılmadı.' });
  db.prepare("UPDATE registrations SET status='active', activated_at=? WHERE id=?")
    .run(new Date().toISOString(), req.params.id);
  const exam = db.prepare('SELECT title FROM exams WHERE id=?').get(reg.exam_id);
  notifyActivation(reg, exam).catch(()=>{});
  res.json({ success: true, message: 'Aktivləşdirildi.' });
});

// PUT /api/registrations/:id/status — admin changes status
router.put('/:id/status', adminMiddleware, (req, res) => {
  const { status } = req.body;
  if (!['pending','active','cancelled'].includes(status)) return res.status(400).json({ success:false, message:'Yanlış status.' });
  db.prepare('UPDATE registrations SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ success: true });
});

// DELETE /api/registrations/:id — admin removes permission
// This means student can no longer see/take this exam
router.delete('/:id', adminMiddleware, (req, res) => {
  const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(req.params.id);
  if (!reg) return res.status(404).json({ success: false, message: 'Tapılmadı.' });
  db.prepare('DELETE FROM registrations WHERE id=?').run(req.params.id);
  res.json({ success: true, message: 'İcazə silindi. Şagird bu imtahanı artıq görməyəcək.' });
});

module.exports = router;

// PUT /api/registrations/:id/edit — admin edits registration details
router.put('/:id/edit', adminMiddleware, (req, res) => {
  const { name, phone, class: cls, section, status } = req.body;
  const reg = db.prepare('SELECT id FROM registrations WHERE id=?').get(req.params.id);
  if (!reg) return res.status(404).json({ success: false, message: 'Tapılmadı.' });
  const updates = [];
  const params = [];
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
