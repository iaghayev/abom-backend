const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../config/uuid');
const db = require('../database');
const { authMiddleware, adminMiddleware, optionalAuth } = require('../middleware/auth');
const tg = require('../config/telegram');

// POST /api/results/submit — submit exam answers
router.post('/submit', authMiddleware, (req, res) => {
  const { exam_id, answers, time_spent } = req.body;
  if (!exam_id || !answers || typeof answers !== 'object') {
    return res.status(400).json({ success: false, message: 'exam_id və cavablar tələb olunur.' });
  }
  // Check active registration
  const reg = db.prepare("SELECT * FROM registrations WHERE user_id = ? AND exam_id = ? AND status = 'active'")
    .get(req.user.id, exam_id);
  if (!reg) return res.status(403).json({ success: false, message: 'Bu imtahan üçün aktiv biletiniz yoxdur.' });
  // Get correct answers
  const questions = db.prepare('SELECT id, correct FROM questions WHERE exam_id = ? ORDER BY order_num').all(exam_id);
  if (!questions.length) return res.status(400).json({ success: false, message: 'Bu imtahanda sual yoxdur.' });
  let correct = 0;
  const total = questions.length;
  const detailedAnswers = {};
  questions.forEach((q, i) => {
    const userAns = answers[i] || answers[q.id] || '';
    const isCorrect = userAns.toUpperCase() === q.correct;
    if (isCorrect) correct++;
    detailedAnswers[i] = { given: userAns.toUpperCase(), correct: q.correct, isCorrect };
  });
  const score = Math.round((correct / total) * 100);
  const id = 'res_' + uuidv4().slice(0,10);
  const now = new Date().toISOString();
  db.prepare('INSERT INTO results (id,user_id,exam_id,score,correct,total,answers,time_spent,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.user.id, exam_id, score, correct, total, JSON.stringify(detailedAnswers), time_spent||0, now);
  const result = db.prepare('SELECT * FROM results WHERE id = ?').get(id);
  // Get cert level
  const certConfig = db.prepare('SELECT * FROM cert_configs WHERE exam_id = ? ORDER BY min_score').all(exam_id);
  const level = certConfig.find(c => score >= c.min_score && score <= c.max_score);
  // Telegram
  const exam = db.prepare('SELECT title FROM exams WHERE id = ?').get(exam_id);
  tg.notifyNewResult({ score, correct, total }, req.user, exam||{title:'?'});
  res.status(201).json({ success: true, data: { ...result, answers: detailedAnswers }, level, exam });
});

// GET /api/results — own results (or all for admin)
router.get('/', authMiddleware, (req, res) => {
  const { exam_id, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  let sql = `SELECT r.*, u.name as user_name, u.phone as user_phone, e.title as exam_title
             FROM results r
             JOIN users u ON r.user_id = u.id
             JOIN exams e ON r.exam_id = e.id`;
  const params = [];
  const where = [];
  if (req.user.role !== 'admin') { where.push('r.user_id = ?'); params.push(req.user.id); }
  if (exam_id) { where.push('r.exam_id = ?'); params.push(exam_id); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY r.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  const results = db.prepare(sql).all(...params).map(r => ({...r, answers: undefined })); // hide answers
  res.json({ success: true, data: results });
});

// GET /api/results/leaderboard
router.get('/leaderboard', optionalAuth, (req, res) => {
  const { exam_id, limit = 50 } = req.query;
  let sql = `SELECT r.id, r.score, r.correct, r.total, r.created_at,
               u.name as user_name, u.id as user_id,
               e.title as exam_title, e.id as exam_id
             FROM results r
             JOIN users u ON r.user_id = u.id
             JOIN exams e ON r.exam_id = e.id`;
  const params = [];
  if (exam_id) { sql += ' WHERE r.exam_id = ?'; params.push(exam_id); }
  sql += ' ORDER BY r.score DESC, r.created_at ASC LIMIT ?';
  params.push(Number(limit));
  const leaderboard = db.prepare(sql).all(...params);
  res.json({ success: true, data: leaderboard });
});

// GET /api/results/:id — result detail with answers
router.get('/:id', authMiddleware, (req, res) => {
  const result = db.prepare(`SELECT r.*, u.name as user_name, e.title as exam_title, e.subject as exam_subject
                              FROM results r JOIN users u ON r.user_id = u.id JOIN exams e ON r.exam_id = e.id
                              WHERE r.id = ?`).get(req.params.id);
  if (!result) return res.status(404).json({ success: false, message: 'Nəticə tapılmadı.' });
  if (req.user.role !== 'admin' && result.user_id !== req.user.id) {
    return res.status(403).json({ success: false, message: 'Giriş icazəsi yoxdur.' });
  }
  // Get cert level
  const certConfig = db.prepare('SELECT * FROM cert_configs WHERE exam_id = ? ORDER BY min_score').all(result.exam_id);
  const level = certConfig.find(c => result.score >= c.min_score && result.score <= c.max_score);
  res.json({ success: true, data: { ...result, answers: JSON.parse(result.answers||'{}') }, level });
});

// GET /api/results/my/stats — user statistics
router.get('/my/stats', authMiddleware, (req, res) => {
  const uid = req.user.id;
  const results = db.prepare('SELECT score FROM results WHERE user_id = ?').all(uid);
  if (!results.length) return res.json({ success: true, data: { total: 0, best: null, avg: null, trend: [] } });
  const scores = results.map(r => r.score);
  const best = Math.max(...scores);
  const avg  = Math.round(scores.reduce((a,b)=>a+b,0)/scores.length);
  const trend = db.prepare(`SELECT r.score, r.created_at, e.title as exam_title
                             FROM results r JOIN exams e ON r.exam_id = e.id
                             WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 10`).all(uid).reverse();
  // Rank
  const allBest = db.prepare(`SELECT user_id, MAX(score) as best FROM results GROUP BY user_id ORDER BY best DESC`).all();
  const rank = allBest.findIndex(r => r.user_id === uid) + 1;
  res.json({ success: true, data: { total: results.length, best, avg, rank, trend } });
});

// DELETE /api/results/:id — admin only
router.delete('/:id', adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM results WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Nəticə silindi.' });
});

// GET /api/results/export/csv — admin export
router.get('/export/csv', adminMiddleware, (req, res) => {
  const results = db.prepare(`SELECT u.name, u.phone, e.title, r.score, r.correct, r.total, r.created_at
                               FROM results r JOIN users u ON r.user_id = u.id JOIN exams e ON r.exam_id = e.id
                               ORDER BY r.created_at DESC`).all();
  const header = 'Ad Soyad,Telefon,İmtahan,Bal,Düzgün,Ümumi,Tarix\n';
  const rows = results.map(r => `"${r.name}","${r.phone}","${r.title}",${r.score},${r.correct},${r.total},"${r.created_at}"`).join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=abom_results.csv');
  res.send('\uFEFF' + header + rows); // BOM for Excel
});

module.exports = router;
