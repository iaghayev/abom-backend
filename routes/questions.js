const express = require('express');
const router = express.Router();
const db = require('../database');
const { adminMiddleware } = require('../middleware/auth');

function uid() { return 'q_' + Date.now() + Math.random().toString(36).slice(2,6); }

// GET /api/questions?exam_id=
router.get('/', adminMiddleware, async (req, res) => {
  const { exam_id } = req.query;
  let sql = 'SELECT q.*, e.title as exam_title FROM questions q JOIN exams e ON q.exam_id=e.id';
  const params = [];
  if (exam_id) { sql += ' WHERE q.exam_id=?'; params.push(exam_id); }
  sql += ' ORDER BY q.exam_id, q.order_num';
  res.json({ success: true, data: await db.all(sql, params) });
});

// POST /api/questions
router.post('/', adminMiddleware, async (req, res) => {
  const { exam_id, text, type='multiple_choice', option_a='', option_b='', option_c='', option_d='', correct } = req.body;
  if (!exam_id || !text || !correct)
    return res.status(400).json({ success: false, message: 'exam_id, sual mətni və cavab tələb olunur.' });
  if (!await db.get('SELECT id FROM exams WHERE id=?', [exam_id]))
    return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });
  const maxO = await db.get('SELECT MAX(order_num) as mo FROM questions WHERE exam_id=?', [exam_id]);
  const id = uid();
  await db.run('INSERT INTO questions (id,exam_id,text,type,option_a,option_b,option_c,option_d,correct,order_num,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)', [id, exam_id, text.trim(), type, option_a, option_b, option_c, option_d, correct, (maxO.mo||0)+1, new Date().toISOString()]);
  res.status(201).json({ success: true, data: await db.get('SELECT * FROM questions WHERE id=?', [id]) });
});

// POST /api/questions/bulk — CSV import
router.post('/bulk', adminMiddleware, async (req, res) => {
  const { exam_id, csv } = req.body;
  if (!exam_id || !csv)
    return res.status(400).json({ success: false, message: 'exam_id və csv tələb olunur.' });
  if (!await db.get('SELECT id FROM exams WHERE id=?', [exam_id]))
    return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });
  const lines = csv.split('\n').filter(l => l.trim());
  const maxO = await db.get('SELECT MAX(order_num) as mo FROM questions WHERE exam_id=?', [exam_id]);
  let orderStart = (maxO.mo||0)+1;
    let added=0, skipped=0, errors=[];
  const now = new Date().toISOString();
  for (let i=0; i<lines.length; i++) {
    const line = lines[i];
    const sep = line.includes(';') ? ';' : ',';
    const p = line.split(sep).map(s => s.trim().replace(/^["']|["']$/g,''));
    let text, type, a='', b='', c='', d='', correct;
    if (p.length >= 7 && ['multiple_choice','open_ended','fill_blank'].includes(p[1])) {
      [text, type, a, b, c, d, correct] = p;
    } else if (p.length >= 6) {
      [text, a, b, c, d, correct] = p; type = 'multiple_choice';
    } else if (p.length === 2) {
      [text, correct] = p; type = 'open_ended';
    } else { skipped++; errors.push(`Sətir ${i+1}: format xətası`); continue; }
    if (!text || !correct) { skipped++; continue; }
    if (type === 'multiple_choice' && !['A','B','C','D'].includes(correct.toUpperCase())) { skipped++; errors.push(`Sətir ${i+1}: cavab A/B/C/D olmalıdır`); continue; }
    await db.run('INSERT INTO questions (id,exam_id,text,type,option_a,option_b,option_c,option_d,correct,order_num,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [uid(), exam_id, text, type, a, b, c, d, type==='multiple_choice'?correct.toUpperCase():correct, orderStart++, now]);
    added++;
  }
  res.json({ success:true, added, skipped, errors: errors.slice(0,5), message:`${added} sual əlavə edildi.` });
});

// PUT /api/questions/:id
router.put('/:id', adminMiddleware, async (req, res) => {
  const { text, type, option_a, option_b, option_c, option_d, correct } = req.body;
  if (!await db.get('SELECT id FROM questions WHERE id=?', [req.params.id]))
    return res.status(404).json({ success: false, message: 'Sual tapılmadı.' });
  await db.run('UPDATE questions SET text=?,type=?,option_a=?,option_b=?,option_c=?,option_d=?,correct=? WHERE id=?', [text, type||'multiple_choice', option_a||'', option_b||'', option_c||'', option_d||'', correct, req.params.id]);
  res.json({ success:true, data: await db.get('SELECT * FROM questions WHERE id=?', [req.params.id]) });
});

// DELETE /api/questions/:id
router.delete('/:id', adminMiddleware, async (req, res) => {
  await db.run('DELETE FROM questions WHERE id=?', [req.params.id]);
  res.json({ success:true, message:'Sual silindi.' });
});

// DELETE /api/questions/exam/:exam_id
router.delete('/exam/:exam_id', adminMiddleware, async (req, res) => {
  const { changes } = await db.run('DELETE FROM questions WHERE exam_id=?', [req.params.exam_id]);
  res.json({ success:true, message:`${changes} sual silindi.` });
});

module.exports = router;
