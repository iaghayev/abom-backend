const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('../config/uuid');
const db = require('../database');
const { authMiddleware, adminMiddleware, optionalAuth } = require('../middleware/auth');

// ── helpers ────────────────────────────────────────────────
function isDateActive(exam) {
  if (exam.is_unlimited) return true;
  const now = new Date().toISOString();
  if (exam.start_date && now < exam.start_date) return false;
  if (exam.end_date   && now > exam.end_date + 'T23:59:59') return false;
  return true;
}

// Enrich exam: add is_date_active, is_parent, sub_exam_count
function enrich(exam) {
  exam.is_date_active = isDateActive(exam);
  exam.is_parent      = !!exam.parent_exam_id === false && !!exam.is_group;
  return exam;
}

// GET /api/exams
router.get('/', optionalAuth, (req, res) => {
  const { category, subject, class: cls, section, search, parent_only, parent_id, admin } = req.query;
  let sql = `SELECT e.*,
    (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) as question_count,
    (SELECT COUNT(*) FROM exams sub WHERE sub.parent_exam_id = e.id) as sub_count
    FROM exams e WHERE e.is_active = 1`;
  const params = [];

  // Non-admin: filter by date AND hide sub-exams
  if (!admin) {
    const now = new Date().toISOString().slice(0, 10);
    sql += ` AND (e.is_unlimited = 1 OR (
      (e.start_date = '' OR e.start_date IS NULL OR e.start_date <= ?)
      AND
      (e.end_date = '' OR e.end_date IS NULL OR e.end_date >= ?)
    ))`;
    params.push(now, now);
    // Only show top-level (parent) exams to students — sub-exams are auto-assigned
    sql += " AND (e.parent_exam_id = '' OR e.parent_exam_id IS NULL)";
  }

  if (category)    { sql += ' AND e.category = ?';   params.push(category); }
  if (subject)     { sql += ' AND e.subject = ?';    params.push(subject); }
  if (cls)         { sql += ' AND e.class = ?';      params.push(cls); }
  if (section)     { sql += ' AND e.section = ?';    params.push(section); }
  if (search)      { sql += ' AND (e.title LIKE ? OR e.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (parent_only) { sql += " AND (e.parent_exam_id = '' OR e.parent_exam_id IS NULL)"; }
  if (parent_id)   { sql += ' AND e.parent_exam_id = ?'; params.push(parent_id); }

  sql += ' ORDER BY e.created_at DESC';
  const exams = db.prepare(sql).all(...params);
  res.json({ success: true, data: exams });
});

// GET /api/exams/:id
router.get('/:id', optionalAuth, (req, res) => {
  const exam = db.prepare(`SELECT e.*,
    (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) as question_count,
    (SELECT COUNT(*) FROM exams sub WHERE sub.parent_exam_id = e.id) as sub_count
    FROM exams e WHERE e.id = ?`).get(req.params.id);
  if (!exam) return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });
  res.json({ success: true, data: exam });
});

// GET /api/exams/:id/questions
router.get('/:id/questions', authMiddleware, (req, res) => {
  const user = req.user;
  if (user.role !== 'admin') {
    const reg = db.prepare('SELECT * FROM registrations WHERE user_id=? AND exam_id=? AND status=?')
      .get(user.id, req.params.id, 'active');
    if (!reg) return res.status(403).json({ success: false, message: 'Bu imtahan üçün aktiv biletiniz yoxdur.' });
  }
  const questions = db.prepare('SELECT * FROM questions WHERE exam_id=? ORDER BY order_num ASC').all(req.params.id);
  const safe = questions.map(q => {
    if (user.role === 'admin') return q;
    const { correct, ...rest } = q; return rest;
  });
  res.json({ success: true, data: safe });
});

// POST /api/exams — create
router.post('/', adminMiddleware, (req, res) => {
  const {
    title, description, category, subject, class: cls, section,
    duration, price, start_date, end_date, is_unlimited, parent_exam_id
  } = req.body;
  if (!title || !category || !subject) {
    return res.status(400).json({ success: false, message: 'Başlıq, kateqoriya, fənn tələb olunur.' });
  }
  const id  = 'ex_' + uuidv4().slice(0,8);
  const now = new Date().toISOString();
  const unlimited = (is_unlimited === false || is_unlimited === 0 || is_unlimited === '0') ? 0 : 1;
  db.prepare(`INSERT INTO exams
    (id,title,description,category,subject,class,section,duration,price,
     start_date,end_date,is_unlimited,parent_exam_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, title, description||'', category, subject, cls||'', section||'',
         duration||60, price||0,
         start_date||'', end_date||'', unlimited,
         parent_exam_id||'', now);
  // Default cert configs (only for non-sub-exams)
  if (!parent_exam_id) {
    const icc = db.prepare('INSERT INTO cert_configs (id,exam_id,level_name,min_score,max_score,color) VALUES (?,?,?,?,?,?)');
    [['İştirak',0,40,'#94a3b8'],['Bürünc',41,70,'#b45309'],['Gümüş',71,85,'#64748b'],['Qızıl',86,100,'#d97706']]
      .forEach(([l,mn,mx,c]) => icc.run(`cc_${id}_${l}`, id, l, mn, mx, c));
  }
  res.status(201).json({ success: true, data: db.prepare('SELECT * FROM exams WHERE id=?').get(id) });
});

// PUT /api/exams/:id — update
router.put('/:id', adminMiddleware, (req, res) => {
  const {
    title, description, category, subject, class: cls, section,
    duration, price, is_active, start_date, end_date, is_unlimited, parent_exam_id
  } = req.body;
  const exam = db.prepare('SELECT id FROM exams WHERE id=?').get(req.params.id);
  if (!exam) return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });
  const unlimited = (is_unlimited === false || is_unlimited === 0 || is_unlimited === '0') ? 0 : 1;
  db.prepare(`UPDATE exams SET
    title=?,description=?,category=?,subject=?,class=?,section=?,
    duration=?,price=?,is_active=?,
    start_date=?,end_date=?,is_unlimited=?,parent_exam_id=?
    WHERE id=?`)
    .run(title, description||'', category, subject, cls||'', section||'',
         duration||60, price||0, is_active??1,
         start_date||'', end_date||'', unlimited,
         parent_exam_id||'', req.params.id);
  res.json({ success: true, data: db.prepare('SELECT * FROM exams WHERE id=?').get(req.params.id) });
});

// DELETE /api/exams/:id
router.delete('/:id', adminMiddleware, (req, res) => {
  if (!db.prepare('SELECT id FROM exams WHERE id=?').get(req.params.id))
    return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });
  db.prepare('DELETE FROM exams WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
