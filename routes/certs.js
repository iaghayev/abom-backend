const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('../config/uuid');
const db = require('../database');
const { adminMiddleware, authMiddleware, optionalAuth } = require('../middleware/auth');

// ── Multer for image uploads ──────────────────────────────────
let upload;
try {
  const multer = require('multer');
  const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, 'cert_' + Date.now() + '_' + Math.random().toString(36).slice(2,6) + ext);
    }
  });
  upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });
} catch(e) {
  console.warn('multer not installed — file upload disabled');
  upload = { single: () => (req,res,next) => next() };
}

// GET /api/certs/config/:exam_id
router.get('/config/:exam_id', (req, res) => {
  const configs = db.prepare('SELECT * FROM cert_configs WHERE exam_id = ? ORDER BY min_score ASC').all(req.params.exam_id);
  res.json({ success: true, data: configs });
});

// GET /api/certs/config/by-id/:id — single cert_config row
router.get('/by-id/:id', (req, res) => {
  const cfg = db.prepare('SELECT * FROM cert_configs WHERE id = ?').get(req.params.id);
  if (!cfg) return res.status(404).json({ success: false });
  try { cfg.template_fields = JSON.parse(cfg.template_fields || '{}'); } catch(e) { cfg.template_fields = {}; }
  res.json({ success: true, data: cfg });
});

// PUT /api/certs/config/:exam_id — save level ranges only (no template)
router.put('/config/:exam_id', adminMiddleware, (req, res) => {
  const { levels } = req.body;
  if (!Array.isArray(levels)) return res.status(400).json({ success: false, message: 'levels tələb olunur.' });
  const exam = db.prepare('SELECT id FROM exams WHERE id = ?').get(req.params.exam_id);
  if (!exam) return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });

  // Keep existing templates while updating ranges
  const existing = db.prepare('SELECT * FROM cert_configs WHERE exam_id = ? ORDER BY min_score').all(req.params.exam_id);
  const existingMap = {};
  existing.forEach(e => existingMap[e.level_name] = e);

  db.transaction(() => {
    db.prepare('DELETE FROM cert_configs WHERE exam_id = ?').run(req.params.exam_id);
    const ins = db.prepare(`INSERT INTO cert_configs (id,exam_id,level_name,min_score,max_score,color,template_url,template_fields)
      VALUES (?,?,?,?,?,?,?,?)`);
    levels.forEach(l => {
      if (!l.level_name) return;
      const prev = existingMap[l.level_name] || {};
      ins.run(
        'cc_' + uuidv4().slice(0,8), req.params.exam_id,
        l.level_name, l.min_score || 0, l.max_score || 100,
        l.color || '#94a3b8',
        l.template_url ?? prev.template_url ?? '',
        l.template_fields ?? prev.template_fields ?? '{}'
      );
    });
  })();
  res.json({ success: true, data: db.prepare('SELECT * FROM cert_configs WHERE exam_id = ? ORDER BY min_score').all(req.params.exam_id) });
});

// POST /api/certs/upload-template/:cert_config_id — upload image template
router.post('/upload-template/:cert_config_id', adminMiddleware, upload.single('template'), (req, res) => {
  const cfg = db.prepare('SELECT * FROM cert_configs WHERE id = ?').get(req.params.cert_config_id);
  if (!cfg) return res.status(404).json({ success: false, message: 'Config tapılmadı.' });
  if (!req.file) return res.status(400).json({ success: false, message: 'Şəkil yüklənmədi.' });

  // Delete old template if exists
  if (cfg.template_url) {
    const oldPath = path.join(__dirname, '..', 'public', cfg.template_url.replace(/^\//, ''));
    if (fs.existsSync(oldPath)) try { fs.unlinkSync(oldPath); } catch(e) {}
  }

  const url = '/uploads/' + req.file.filename;
  db.prepare('UPDATE cert_configs SET template_url=? WHERE id=?').run(url, req.params.cert_config_id);
  res.json({ success: true, url });
});

// PUT /api/certs/fields/:cert_config_id — save field positions
router.put('/fields/:cert_config_id', adminMiddleware, (req, res) => {
  const { fields } = req.body; // {name:{x,y,fontSize,color,align}, date:{...}, exam:{...}, score:{...}}
  const cfg = db.prepare('SELECT id FROM cert_configs WHERE id=?').get(req.params.cert_config_id);
  if (!cfg) return res.status(404).json({ success:false, message:'Config tapılmadı.' });
  db.prepare('UPDATE cert_configs SET template_fields=? WHERE id=?')
    .run(JSON.stringify(fields || {}), req.params.cert_config_id);
  res.json({ success: true });
});

// GET /api/certs/check/:result_id
router.get('/check/:result_id', optionalAuth, (req, res) => {
  const result = db.prepare('SELECT * FROM results WHERE id = ?').get(req.params.result_id);
  if (!result) return res.status(404).json({ success: false });
  const cfg = db.prepare('SELECT * FROM cert_configs WHERE exam_id = ? ORDER BY min_score ASC').all(result.exam_id);
  const level = cfg.find(c => result.score >= c.min_score && result.score <= c.max_score);
  const user = db.prepare('SELECT name FROM users WHERE id = ?').get(result.user_id);
  const exam = db.prepare('SELECT title FROM exams WHERE id = ?').get(result.exam_id);
  res.json({
    success: true, hasCert: !!level,
    data: level ? {
      ...level,
      template_fields: level.template_fields ? JSON.parse(level.template_fields) : {},
      user_name: user?.name, exam_title: exam?.title,
      score: result.score, date: result.created_at.split('T')[0]
    } : null
  });
});

module.exports = router;
