const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../config/uuid');
const db = require('../database');
const { adminMiddleware } = require('../middleware/auth');

// GET /api/questions?exam_id=...
router.get('/', adminMiddleware, (req, res) => {
  const { exam_id } = req.query;
  let sql = 'SELECT q.*, e.title as exam_title FROM questions q JOIN exams e ON q.exam_id = e.id';
  const params = [];
  if (exam_id) { sql += ' WHERE q.exam_id = ?'; params.push(exam_id); }
  sql += ' ORDER BY q.exam_id, q.order_num ASC';
  const questions = db.prepare(sql).all(...params);
  res.json({ success: true, data: questions, total: questions.length });
});

// POST /api/questions — single question
router.post('/', adminMiddleware, (req, res) => {
  const { exam_id, text, option_a, option_b, option_c, option_d, correct } = req.body;
  if (!exam_id || !text || !option_a || !option_b || !option_c || !option_d || !correct) {
    return res.status(400).json({ success: false, message: 'Bütün sahələr tələb olunur.' });
  }
  if (!['A','B','C','D'].includes(correct.toUpperCase())) {
    return res.status(400).json({ success: false, message: 'Düzgün cavab A, B, C, D olmalıdır.' });
  }
  const exam = db.prepare('SELECT id FROM exams WHERE id = ?').get(exam_id);
  if (!exam) return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });
  const maxOrder = db.prepare('SELECT MAX(order_num) as mo FROM questions WHERE exam_id = ?').get(exam_id);
  const orderNum = (maxOrder.mo || 0) + 1;
  const id = 'q_' + uuidv4().slice(0,8);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO questions (id,exam_id,text,option_a,option_b,option_c,option_d,correct,order_num,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, exam_id, text.trim(), option_a, option_b, option_c, option_d, correct.toUpperCase(), orderNum, now);
  res.status(201).json({ success: true, data: db.prepare('SELECT * FROM questions WHERE id = ?').get(id) });
});

// POST /api/questions/bulk — CSV import
router.post('/bulk', adminMiddleware, (req, res) => {
  const { exam_id, csv } = req.body;
  if (!exam_id || !csv) {
    return res.status(400).json({ success: false, message: 'exam_id və csv məlumatı tələb olunur.' });
  }
  const exam = db.prepare('SELECT id FROM exams WHERE id = ?').get(exam_id);
  if (!exam) return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });

  const lines = csv.split('\n').filter(l => l.trim());
  const now = new Date().toISOString();
  const maxOrder = db.prepare('SELECT MAX(order_num) as mo FROM questions WHERE exam_id = ?').get(exam_id);
  let orderStart = (maxOrder.mo || 0) + 1;
  const insert = db.prepare('INSERT INTO questions (id,exam_id,text,option_a,option_b,option_c,option_d,correct,order_num,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  
  let added = 0, skipped = 0, errors = [];
  const insertMany = db.transaction(() => {
    lines.forEach((line, idx) => {
      // Support both comma and semicolon separators
      const parts = line.includes(';') ? line.split(';') : line.split(',');
      if (parts.length < 6) { skipped++; errors.push(`Sətir ${idx+1}: kifayət qədər sütun yoxdur`); return; }
      const [text, a, b, c, d, ans] = parts.map(p => p.trim().replace(/^["']|["']$/g,''));
      const correct = ans.toUpperCase();
      if (!['A','B','C','D'].includes(correct)) { skipped++; errors.push(`Sətir ${idx+1}: etibarsız cavab "${ans}"`); return; }
      if (!text || !a || !b || !c || !d) { skipped++; errors.push(`Sətir ${idx+1}: boş sahə`); return; }
      insert.run('q_' + uuidv4().slice(0,8), exam_id, text, a, b, c, d, correct, orderStart++, now);
      added++;
    });
  });
  insertMany();
  res.json({ success: true, added, skipped, errors: errors.slice(0,10), message: `${added} sual əlavə edildi.` });
});

// PUT /api/questions/:id
router.put('/:id', adminMiddleware, (req, res) => {
  const { text, option_a, option_b, option_c, option_d, correct } = req.body;
  const q = db.prepare('SELECT id FROM questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ success: false, message: 'Sual tapılmadı.' });
  db.prepare('UPDATE questions SET text=?,option_a=?,option_b=?,option_c=?,option_d=?,correct=? WHERE id=?')
    .run(text, option_a, option_b, option_c, option_d, correct.toUpperCase(), req.params.id);
  res.json({ success: true, data: db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id) });
});

// DELETE /api/questions/:id
router.delete('/:id', adminMiddleware, (req, res) => {
  const q = db.prepare('SELECT id FROM questions WHERE id = ?').get(req.params.id);
  if (!q) return res.status(404).json({ success: false, message: 'Sual tapılmadı.' });
  db.prepare('DELETE FROM questions WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Sual silindi.' });
});

// DELETE /api/questions/exam/:exam_id — delete all questions for an exam
router.delete('/exam/:exam_id', adminMiddleware, (req, res) => {
  const count = db.prepare('SELECT COUNT(*) as c FROM questions WHERE exam_id = ?').get(req.params.exam_id);
  db.prepare('DELETE FROM questions WHERE exam_id = ?').run(req.params.exam_id);
  res.json({ success: true, message: `${count.c} sual silindi.` });
});

module.exports = router;
