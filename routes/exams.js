const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../config/uuid');
const db = require('../database');
const { authMiddleware, adminMiddleware, optionalAuth } = require('../middleware/auth');

// GET /api/exams — public list
router.get('/', optionalAuth, (req, res) => {
  const { category, subject, class: cls, search } = req.query;
  let sql = 'SELECT e.*, (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) as question_count FROM exams e WHERE e.is_active = 1';
  const params = [];
  if (category) { sql += ' AND e.category = ?'; params.push(category); }
  if (subject)  { sql += ' AND e.subject = ?';  params.push(subject); }
  if (cls)      { sql += ' AND e.class = ?';    params.push(cls); }
  if (search)   { sql += ' AND (e.title LIKE ? OR e.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ' ORDER BY e.created_at DESC';
  const exams = db.prepare(sql).all(...params);
  res.json({ success: true, data: exams });
});

// GET /api/exams/:id — single exam
router.get('/:id', optionalAuth, (req, res) => {
  const exam = db.prepare('SELECT e.*, (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) as question_count FROM exams e WHERE e.id = ?').get(req.params.id);
  if (!exam) return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });
  res.json({ success: true, data: exam });
});

// GET /api/exams/:id/questions — only for activated students & admin
router.get('/:id/questions', authMiddleware, (req, res) => {
  const user = req.user;
  // Admin sees all
  if (user.role !== 'admin') {
    const reg = db.prepare('SELECT * FROM registrations WHERE user_id = ? AND exam_id = ? AND status = ?')
      .get(user.id, req.params.id, 'active');
    if (!reg) return res.status(403).json({ success: false, message: 'Bu imtahan üçün aktiv biletiniz yoxdur.' });
  }
  // Shuffle questions for fairness
  const questions = db.prepare('SELECT * FROM questions WHERE exam_id = ? ORDER BY order_num ASC').all(req.params.id);
  // Return without correct answer (only admin gets it)
  const safe = questions.map(q => {
    if (user.role === 'admin') return q;
    const { correct, ...rest } = q;
    return rest;
  });
  res.json({ success: true, data: safe });
});

// POST /api/exams — admin only
router.post('/', adminMiddleware, (req, res) => {
  const { title, description, category, subject, class: cls, duration, price } = req.body;
  if (!title || !category || !subject || !cls) {
    return res.status(400).json({ success: false, message: 'Başlıq, kateqoriya, fənn, sinif tələb olunur.' });
  }
  const id = 'ex_' + uuidv4().slice(0,8);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO exams (id,title,description,category,subject,class,duration,price,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, title, description||'', category, subject, cls, duration||60, price||0, now);
  // Default cert configs
  const insertCert = db.prepare('INSERT INTO cert_configs (id,exam_id,level_name,min_score,max_score,color) VALUES (?,?,?,?,?,?)');
  [['İştirak',0,40,'#94a3b8'],['Bürünc',41,70,'#b45309'],['Gümüş',71,85,'#64748b'],['Qızıl',86,100,'#d97706']]
    .forEach(([lvl,mn,mx,clr])=> insertCert.run(`cc_${id}_${lvl}`, id, lvl, mn, mx, clr));
  const exam = db.prepare('SELECT * FROM exams WHERE id = ?').get(id);
  res.status(201).json({ success: true, data: exam });
});

// PUT /api/exams/:id — admin only
router.put('/:id', adminMiddleware, (req, res) => {
  const { title, description, category, subject, class: cls, duration, price, is_active } = req.body;
  const exam = db.prepare('SELECT id FROM exams WHERE id = ?').get(req.params.id);
  if (!exam) return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });
  db.prepare('UPDATE exams SET title=?,description=?,category=?,subject=?,class=?,duration=?,price=?,is_active=? WHERE id=?')
    .run(title, description||'', category, subject, cls, duration, price, is_active??1, req.params.id);
  res.json({ success: true, data: db.prepare('SELECT * FROM exams WHERE id = ?').get(req.params.id) });
});

// DELETE /api/exams/:id — admin only
router.delete('/:id', adminMiddleware, (req, res) => {
  const exam = db.prepare('SELECT id FROM exams WHERE id = ?').get(req.params.id);
  if (!exam) return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });
  db.prepare('DELETE FROM exams WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'İmtahan silindi.' });
});

module.exports = router;
