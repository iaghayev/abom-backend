const express = require('express');
const router = express.Router();
const db = require('../database');
const { adminMiddleware } = require('../middleware/auth');

function uid() { return 'q_' + Date.now() + Math.random().toString(36).slice(2,6); }

// GET /api/questions?exam_id=
router.get('/', adminMiddleware, (req, res) => {
  const { exam_id } = req.query;
  let sql = 'SELECT q.*, e.title as exam_title FROM questions q JOIN exams e ON q.exam_id=e.id';
  const params = [];
  if (exam_id) { sql += ' WHERE q.exam_id=?'; params.push(exam_id); }
  sql += ' ORDER BY q.exam_id, q.order_num';
  res.json({ success: true, data: db.prepare(sql).all(...params) });
});

// POST /api/questions
router.post('/', adminMiddleware, (req, res) => {
  const { exam_id, text, type='multiple_choice', option_a='', option_b='', option_c='', option_d='', correct } = req.body;
  if (!exam_id || !text || !correct)
    return res.status(400).json({ success: false, message: 'exam_id, sual mətni və cavab tələb olunur.' });
  if (!db.prepare('SELECT id FROM exams WHERE id=?').get(exam_id))
    return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });
  const maxO = db.prepare('SELECT MAX(order_num) as mo FROM questions WHERE exam_id=?').get(exam_id);
  const id = uid();
  db.prepare('INSERT INTO questions (id,exam_id,text,type,option_a,option_b,option_c,option_d,correct,order_num,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, exam_id, text.trim(), type, option_a, option_b, option_c, option_d, correct, (maxO.mo||0)+1, new Date().toISOString());
  res.status(201).json({ success: true, data: db.prepare('SELECT * FROM questions WHERE id=?').get(id) });
});

// POST /api/questions/bulk — CSV import
router.post('/bulk', adminMiddleware, (req, res) => {
  const { exam_id, csv } = req.body;
  if (!exam_id || !csv)
    return res.status(400).json({ success: false, message: 'exam_id və csv tələb olunur.' });
  if (!db.prepare('SELECT id FROM exams WHERE id=?').get(exam_id))
    return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });
  const lines = csv.split('\n').filter(l => l.trim());
  const maxO = db.prepare('SELECT MAX(order_num) as mo FROM questions WHERE exam_id=?').get(exam_id);
  let orderStart = (maxO.mo||0)+1;
  const ins = db.prepare('INSERT INTO questions (id,exam_id,text,type,option_a,option_b,option_c,option_d,correct,order_num,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
  let added=0, skipped=0, errors=[];
  const now = new Date().toISOString();
  const transaction = db.transaction(() => {
    lines.forEach((line, i) => {
      const sep = line.includes(';') ? ';' : ',';
      const p = line.split(sep).map(s => s.trim().replace(/^["']|["']$/g,''));
      // Format: sual,tip,A,B,C,D,cavab  OR  sual,A,B,C,D,cavab (default multiple_choice)
      let text, type, a='', b='', c='', d='', correct;
      if (p.length >= 7 && ['multiple_choice','open_ended','fill_blank'].includes(p[1])) {
        [text, type, a, b, c, d, correct] = p;
      } else if (p.length >= 6) {
        [text, a, b, c, d, correct] = p; type = 'multiple_choice';
      } else if (p.length === 2) {
        [text, correct] = p; type = 'open_ended';
      } else { skipped++; errors.push(`Sətir ${i+1}: format xətası`); return; }
      if (!text || !correct) { skipped++; return; }
      if (type === 'multiple_choice' && !['A','B','C','D'].includes(correct.toUpperCase())) { skipped++; errors.push(`Sətir ${i+1}: cavab A/B/C/D olmalıdır`); return; }
      ins.run(uid(), exam_id, text, type, a, b, c, d, type==='multiple_choice'?correct.toUpperCase():correct, orderStart++, now);
      added++;
    });
  });
  transaction();
  res.json({ success:true, added, skipped, errors: errors.slice(0,5), message:`${added} sual əlavə edildi.` });
});

// PUT /api/questions/:id
router.put('/:id', adminMiddleware, (req, res) => {
  const { text, type, option_a, option_b, option_c, option_d, correct } = req.body;
  if (!db.prepare('SELECT id FROM questions WHERE id=?').get(req.params.id))
    return res.status(404).json({ success: false, message: 'Sual tapılmadı.' });
  db.prepare('UPDATE questions SET text=?,type=?,option_a=?,option_b=?,option_c=?,option_d=?,correct=? WHERE id=?')
    .run(text, type||'multiple_choice', option_a||'', option_b||'', option_c||'', option_d||'', correct, req.params.id);
  res.json({ success:true, data: db.prepare('SELECT * FROM questions WHERE id=?').get(req.params.id) });
});

// DELETE /api/questions/:id
router.delete('/:id', adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM questions WHERE id=?').run(req.params.id);
  res.json({ success:true, message:'Sual silindi.' });
});

// DELETE /api/questions/exam/:exam_id
router.delete('/exam/:exam_id', adminMiddleware, (req, res) => {
  const { changes } = db.prepare('DELETE FROM questions WHERE exam_id=?').run(req.params.exam_id);
  res.json({ success:true, message:`${changes} sual silindi.` });
});

module.exports = router;
