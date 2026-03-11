const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const db = require('../database');

function parentAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer '))
    return res.status(401).json({ success: false, message: 'Token lazımdır.' });
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    if (decoded.role !== 'parent')
      return res.status(403).json({ success: false, message: 'Valideyn girişi tələb olunur.' });
    const parent = db.prepare('SELECT * FROM parents WHERE id=?').get(decoded.id);
    if (!parent) return res.status(401).json({ success: false, message: 'Valideyn tapılmadı.' });
    req.parent = parent;
    next();
  } catch { res.status(401).json({ success: false, message: 'Token etibarsızdır.' }); }
}

// GET /api/parents/children
router.get('/children', parentAuth, (req, res) => {
  const childIds = JSON.parse(req.parent.child_codes || '[]');
  const children = childIds.map(id => {
    const child = db.prepare('SELECT id,username,name,phone,class,section,parent_code FROM users WHERE id=?').get(id);
    if (!child) return null;
    const results = db.prepare(`SELECT r.*, e.title as exam_title FROM results r JOIN exams e ON r.exam_id=e.id WHERE r.user_id=? ORDER BY r.created_at DESC LIMIT 10`).all(id);
    const activeRegs = db.prepare(`SELECT reg.*, e.title as exam_title, e.subject, e.duration FROM registrations reg JOIN exams e ON reg.exam_id=e.id WHERE reg.user_id=? AND reg.status='active'`).all(id);
    const stats = { total: results.length, best: results.length ? Math.max(...results.map(r=>r.score)) : null, avg: results.length ? Math.round(results.reduce((a,b)=>a+b.score,0)/results.length) : null };
    return { ...child, results, activeRegs, stats };
  }).filter(Boolean);
  res.json({ success: true, data: children });
});

// GET /api/parents/child/:childId/results
router.get('/child/:childId/results', parentAuth, (req, res) => {
  const childIds = JSON.parse(req.parent.child_codes || '[]');
  if (!childIds.includes(req.params.childId))
    return res.status(403).json({ success: false, message: 'Bu şagird sizin uşaqlarınızdan deyil.' });
  const results = db.prepare(`SELECT r.*, e.title as exam_title, e.subject FROM results r JOIN exams e ON r.exam_id=e.id WHERE r.user_id=? ORDER BY r.created_at DESC`).all(req.params.childId);
  res.json({ success: true, data: results });
});

module.exports = router;
