const express = require('express');
const router = express.Router();
const db = require('../database');
const { authMiddleware, adminMiddleware, optionalAuth } = require('../middleware/auth');

function uid() { return 'r_' + Date.now() + Math.random().toString(36).slice(2,6); }

// GET /api/results — my results (student)
router.get('/', authMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, e.title as exam_title, e.subject, e.duration
    FROM results r JOIN exams e ON r.exam_id = e.id
    WHERE r.user_id = ? ORDER BY r.created_at DESC
  `).all(req.user.id);
  res.json({ success: true, data: rows });
});

// GET /api/results/my/stats — dashboard stats
router.get('/my/stats', authMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT r.score, r.created_at, e.title as exam_title
    FROM results r JOIN exams e ON r.exam_id=e.id
    WHERE r.user_id=? ORDER BY r.created_at ASC
  `).all(req.user.id);
  const total = rows.length;
  const best = total ? Math.max(...rows.map(r => r.score)) : null;
  const avg = total ? Math.round(rows.reduce((a, b) => a + b.score, 0) / total) : null;
  // Rank
  const rankRow = db.prepare(`
    SELECT COUNT(DISTINCT user_id)+1 as rank FROM (
      SELECT user_id, MAX(score) as best FROM results GROUP BY user_id
    ) t WHERE best > (SELECT COALESCE(MAX(score),0) FROM results WHERE user_id=?)
  `).get(req.user.id);
  res.json({ success: true, data: { total, best, avg, rank: rankRow?.rank || 1, trend: rows.slice(-10) } });
});

// GET /api/results/leaderboard
router.get('/leaderboard', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  const rows = db.prepare(`
    SELECT r.user_id, u.name as user_name, r.score, r.exam_id, e.title as exam_title, r.created_at
    FROM results r
    JOIN users u ON r.user_id = u.id
    JOIN exams e ON r.exam_id = e.id
    WHERE r.score = (SELECT MAX(score) FROM results r2 WHERE r2.user_id = r.user_id)
    ORDER BY r.score DESC, r.created_at ASC
    LIMIT ?
  `).all(limit);
  res.json({ success: true, data: rows });
});

// GET /api/results/check/:examId — check if student already took this exam
router.get('/check/:examId', authMiddleware, (req, res) => {
  const result = db.prepare(`
    SELECT r.*, e.title as exam_title FROM results r
    JOIN exams e ON r.exam_id = e.id
    WHERE r.user_id = ? AND r.exam_id = ?
    ORDER BY r.created_at DESC LIMIT 1
  `).get(req.user.id, req.params.examId);
  res.json({ success: true, taken: !!result, result: result || null });
});

// GET /api/results/:id/review — detailed review with per-question analysis
router.get('/:id/review', authMiddleware, (req, res) => {
  // Admin can view any result, student can only view own
  let result;
  if (req.user.role === 'admin') {
    result = db.prepare(`SELECT r.*, e.title as exam_title, e.subject FROM results r JOIN exams e ON r.exam_id = e.id WHERE r.id = ?`).get(req.params.id);
  } else {
    result = db.prepare(`SELECT r.*, e.title as exam_title, e.subject FROM results r JOIN exams e ON r.exam_id = e.id WHERE r.id = ? AND r.user_id = ?`).get(req.params.id, req.user.id);
  }
  if (!result) return res.status(404).json({ success: false, message: 'Nəticə tapılmadı.' });

  const questions = db.prepare(`
    SELECT * FROM questions WHERE exam_id = ? ORDER BY order_num
  `).all(result.exam_id);

  let savedAnswers = {};
  try { savedAnswers = JSON.parse(result.answers || '{}'); } catch(e) {}

  const review = questions.map((q, i) => {
    const given = savedAnswers[i] || '';
    const correct = q.correct || '';
    let isCorrect = false;
    if (q.type === 'multiple_choice') {
      isCorrect = given.toUpperCase() === correct.toUpperCase();
    } else {
      // open_ended / fill_blank — case insensitive, trimmed
      isCorrect = given.trim().toLowerCase() === correct.trim().toLowerCase();
    }
    return {
      index: i,
      text: q.text,
      type: q.type,
      option_a: q.option_a, option_b: q.option_b,
      option_c: q.option_c, option_d: q.option_d,
      correct_answer: correct,
      given_answer: given,
      is_correct: isCorrect
    };
  });

  res.json({ success: true, result, questions: review });
});

// POST /api/results/submit
router.post('/submit', authMiddleware, (req, res) => {
  const { exam_id, answers, time_spent } = req.body;
  if (!exam_id) return res.status(400).json({ success: false, message: 'exam_id tələb olunur.' });

  // Check already submitted
  const existing = db.prepare('SELECT id FROM results WHERE user_id=? AND exam_id=?').get(req.user.id, exam_id);
  if (existing) return res.status(409).json({ success: false, message: 'Bu imtahana artıq cavab vermişsiniz.', result_id: existing.id });

  // Check registration/permission
  const reg = db.prepare("SELECT id FROM registrations WHERE user_id=? AND exam_id=? AND status='active'").get(req.user.id, exam_id);
  if (!reg) return res.status(403).json({ success: false, message: 'Bu imtahan üçün aktiv icazəniz yoxdur.' });

  const questions = db.prepare('SELECT * FROM questions WHERE exam_id=? ORDER BY order_num').all(exam_id);
  if (!questions.length) return res.status(400).json({ success: false, message: 'İmtahanda sual tapılmadı.' });

  let correct = 0;
  questions.forEach((q, i) => {
    const given = (answers[i] || '').trim();
    const ans = (q.correct || '').trim();
    if (q.type === 'multiple_choice') {
      if (given.toUpperCase() === ans.toUpperCase()) correct++;
    } else {
      if (given.toLowerCase() === ans.toLowerCase()) correct++;
    }
  });
  const score = Math.round((correct / questions.length) * 100);
  const id = uid();
  const now = new Date().toISOString();

  db.prepare(`INSERT INTO results (id,user_id,exam_id,score,correct,total,answers,time_spent,created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, req.user.id, exam_id, score, correct, questions.length, JSON.stringify(answers || {}), time_spent || 0, now);

  // Get cert level
  const certLevels = db.prepare('SELECT * FROM cert_configs WHERE exam_id=? ORDER BY min_score ASC').all(exam_id);
  const level = certLevels.find(l => score >= l.min_score && score <= l.max_score) || null;

  const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(exam_id);
  const result = db.prepare('SELECT * FROM results WHERE id=?').get(id);
  res.json({ success: true, data: result, level, exam });
});

// GET /api/results — admin: all results
router.get('/admin/all', adminMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, u.name as user_name, e.title as exam_title
    FROM results r JOIN users u ON r.user_id=u.id JOIN exams e ON r.exam_id=e.id
    ORDER BY r.created_at DESC LIMIT 200
  `).all();
  res.json({ success: true, data: rows });
});

// DELETE /api/results/:id — admin: delete result (re-enables exam for student)
router.delete('/:id', adminMiddleware, (req, res) => {
  const result = db.prepare('SELECT * FROM results WHERE id=?').get(req.params.id);
  if (!result) return res.status(404).json({ success: false, message: 'Nəticə tapılmadı.' });
  db.prepare('DELETE FROM results WHERE id=?').run(req.params.id);
  // Registration stays active → student can re-take
  res.json({ success: true, message: 'Nəticə silindi. Şagird imtahanı yenidən verə bilər.' });
});

// GET /api/results/export/csv
router.get('/export/csv', adminMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT r.id, u.name as student, u.phone, e.title as exam, r.score, r.correct, r.total, r.created_at
    FROM results r JOIN users u ON r.user_id=u.id JOIN exams e ON r.exam_id=e.id
    ORDER BY r.created_at DESC
  `).all();
  const csv = ['ID,Şagird,Telefon,İmtahan,Bal,Düzgün,Cəmi,Tarix',
    ...rows.map(r => `${r.id},"${r.student}","${r.phone}","${r.exam}",${r.score},${r.correct},${r.total},"${r.created_at}"`)
  ].join('\n');
  res.setHeader('Content-Type','text/csv;charset=utf-8');
  res.setHeader('Content-Disposition','attachment;filename=results.csv');
  res.send('\uFEFF'+csv);
});

module.exports = router;
