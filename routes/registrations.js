const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../config/uuid');
const db = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const tg = require('../config/telegram');

// GET /api/registrations — admin: all, user: own
router.get('/', authMiddleware, (req, res) => {
  const { status, exam_id, search, page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;
  let sql = `SELECT r.*, e.title as exam_title, e.price as exam_price
             FROM registrations r
             JOIN exams e ON r.exam_id = e.id`;
  const params = [];
  const where = [];
  if (req.user.role !== 'admin') { where.push('r.user_id = ?'); params.push(req.user.id); }
  if (status)  { where.push('r.status = ?'); params.push(status); }
  if (exam_id) { where.push('r.exam_id = ?'); params.push(exam_id); }
  if (search)  { where.push('(r.name LIKE ? OR r.phone LIKE ? OR r.whatsapp LIKE ?)'); params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  const regs = db.prepare(sql).all(...params);
  const totalSql = sql.replace(/SELECT .* FROM/, 'SELECT COUNT(*) as total FROM').replace(/LIMIT .* OFFSET .*$/,'');
  const total = db.prepare(totalSql).get(...params.slice(0,-2))?.total || 0;
  res.json({ success: true, data: regs, total, page: Number(page), pages: Math.ceil(total/limit) });
});

// GET /api/registrations/pending-count — admin
router.get('/pending-count', adminMiddleware, (req, res) => {
  const count = db.prepare("SELECT COUNT(*) as c FROM registrations WHERE status = 'pending'").get();
  res.json({ success: true, count: count.c });
});

// GET /api/registrations/check/:exam_id — check if user has ticket
router.get('/check/:exam_id', authMiddleware, (req, res) => {
  const reg = db.prepare('SELECT id, status FROM registrations WHERE user_id = ? AND exam_id = ?')
    .get(req.user.id, req.params.exam_id);
  res.json({ success: true, hasTicket: !!reg, status: reg?.status || null, registrationId: reg?.id || null });
});

// POST /api/registrations — buy ticket
router.post('/', authMiddleware, (req, res) => {
  const { exam_id, name, phone, whatsapp, class: cls, section } = req.body;
  if (!exam_id || !name || !phone || !whatsapp || !cls || !section) {
    return res.status(400).json({ success: false, message: 'Bütün sahələr tələb olunur.' });
  }
  const exam = db.prepare('SELECT * FROM exams WHERE id = ? AND is_active = 1').get(exam_id);
  if (!exam) return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });
  // Check for duplicate
  const existing = db.prepare('SELECT id, status FROM registrations WHERE user_id = ? AND exam_id = ?')
    .get(req.user.id, exam_id);
  if (existing) {
    return res.status(409).json({ success: false, message: 'Bu imtahan üçün artıq bilet almısınız.', status: existing.status });
  }
  const id = 'reg_' + uuidv4().slice(0,10);
  const now = new Date().toISOString();
  const cleanPhone = phone.replace(/\D/g,'');
  const cleanWa    = whatsapp.replace(/\D/g,'');
  db.prepare('INSERT INTO registrations (id,user_id,exam_id,name,phone,whatsapp,class,section,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.user.id, exam_id, name.trim(), '+994'+cleanPhone.slice(-9), '+994'+cleanWa.slice(-9), cls, section, 'pending', now);
  const reg = db.prepare('SELECT * FROM registrations WHERE id = ?').get(id);
  // Telegram notification (async)
  tg.notifyNewRegistration(reg, exam).then(ok => {
    if (ok) db.prepare('UPDATE registrations SET tg_notified = 1 WHERE id = ?').run(id);
  });
  res.status(201).json({ success: true, data: reg, message: 'Qeydiyyat tamamlandı! WhatsApp-a ödəniş məlumatı göndəriləcək.' });
});

// PUT /api/registrations/:id/activate — admin activates
router.put('/:id/activate', adminMiddleware, (req, res) => {
  const reg = db.prepare('SELECT r.*, e.title as exam_title FROM registrations r JOIN exams e ON r.exam_id = e.id WHERE r.id = ?').get(req.params.id);
  if (!reg) return res.status(404).json({ success: false, message: 'Qeydiyyat tapılmadı.' });
  if (reg.status === 'active') return res.status(400).json({ success: false, message: 'Artıq aktivdir.' });
  db.prepare("UPDATE registrations SET status = 'active', activated_at = ? WHERE id = ?")
    .run(new Date().toISOString(), req.params.id);
  // Telegram notification
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(reg.exam_id);
  tg.notifyActivation(reg, exam);
  res.json({ success: true, message: `${reg.name} üçün imtahan aktivləşdirildi.` });
});

// PUT /api/registrations/:id/status — admin: change any status
router.put('/:id/status', adminMiddleware, (req, res) => {
  const { status } = req.body;
  if (!['pending','active','cancelled'].includes(status)) {
    return res.status(400).json({ success: false, message: 'Etibarsız status.' });
  }
  const reg = db.prepare('SELECT id FROM registrations WHERE id = ?').get(req.params.id);
  if (!reg) return res.status(404).json({ success: false, message: 'Qeydiyyat tapılmadı.' });
  db.prepare('UPDATE registrations SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true, message: 'Status yeniləndi.' });
});

// DELETE /api/registrations/:id — admin
router.delete('/:id', adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM registrations WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Qeydiyyat silindi.' });
});

module.exports = router;
