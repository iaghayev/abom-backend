const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../config/uuid');
const db = require('../database');
const { adminMiddleware, optionalAuth } = require('../middleware/auth');

// GET /api/certs/config?exam_id=
router.get('/config', (req, res) => {
  const { exam_id } = req.query;
  let sql = 'SELECT cc.*, e.title as exam_title FROM cert_configs cc JOIN exams e ON cc.exam_id = e.id';
  const params = [];
  if (exam_id) { sql += ' WHERE cc.exam_id = ?'; params.push(exam_id); }
  sql += ' ORDER BY cc.exam_id, cc.min_score ASC';
  res.json({ success: true, data: db.prepare(sql).all(...params) });
});

// GET /api/certs/config/:exam_id — single exam config
router.get('/config/:exam_id', (req, res) => {
  const configs = db.prepare('SELECT * FROM cert_configs WHERE exam_id = ? ORDER BY min_score ASC').all(req.params.exam_id);
  res.json({ success: true, data: configs });
});

// PUT /api/certs/config/:exam_id — replace all configs for exam
router.put('/config/:exam_id', adminMiddleware, (req, res) => {
  const { levels } = req.body; // [{level_name, min_score, max_score, color}]
  if (!Array.isArray(levels)) return res.status(400).json({ success: false, message: 'levels massivi tələb olunur.' });
  const exam = db.prepare('SELECT id FROM exams WHERE id = ?').get(req.params.exam_id);
  if (!exam) return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });
  const replaceCerts = db.transaction(() => {
    db.prepare('DELETE FROM cert_configs WHERE exam_id = ?').run(req.params.exam_id);
    const ins = db.prepare('INSERT INTO cert_configs (id,exam_id,level_name,min_score,max_score,color) VALUES (?,?,?,?,?,?)');
    levels.forEach(l => {
      if (!l.level_name) return;
      ins.run('cc_'+uuidv4().slice(0,8), req.params.exam_id, l.level_name, l.min_score||0, l.max_score||100, l.color||'#94a3b8');
    });
  });
  replaceCerts();
  res.json({ success: true, data: db.prepare('SELECT * FROM cert_configs WHERE exam_id = ? ORDER BY min_score').all(req.params.exam_id) });
});

// GET /api/certs/check/:result_id — check cert for a result
router.get('/check/:result_id', optionalAuth, (req, res) => {
  const result = db.prepare('SELECT * FROM results WHERE id = ?').get(req.params.result_id);
  if (!result) return res.status(404).json({ success: false, message: 'Nəticə tapılmadı.' });
  const cfg = db.prepare('SELECT * FROM cert_configs WHERE exam_id = ? ORDER BY min_score').all(result.exam_id);
  const level = cfg.find(c => result.score >= c.min_score && result.score <= c.max_score);
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(result.user_id);
  const exam = db.prepare('SELECT title FROM exams WHERE id = ?').get(result.exam_id);
  res.json({
    success: true,
    hasCert: !!level,
    data: level ? {
      ...level,
      user_name: user?.name,
      exam_title: exam?.title,
      score: result.score,
      date: result.created_at.split('T')[0]
    } : null
  });
});

module.exports = router;
