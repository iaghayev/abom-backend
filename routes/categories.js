const express = require('express');
const router = express.Router();
const db = require('../database');
const { adminMiddleware } = require('../middleware/auth');

// GET /api/categories?type=class|subject|section
router.get('/', (req, res) => {
  const { type } = req.query;
  let sql = 'SELECT * FROM categories';
  const params = [];
  if (type) { sql += ' WHERE type=?'; params.push(type); }
  sql += ' ORDER BY type, name ASC';
  res.json({ success: true, data: db.prepare(sql).all(...params) });
});

// POST /api/categories
router.post('/', adminMiddleware, (req, res) => {
  const { type, name } = req.body;
  if (!type || !name) return res.status(400).json({ success: false, message: 'type və name tələb olunur.' });
  const valid = ['class','subject','section'];
  if (!valid.includes(type)) return res.status(400).json({ success: false, message: 'Yanlış tip.' });
  const id = type.slice(0,3) + '_' + Date.now();
  db.prepare('INSERT INTO categories (id,type,name,created_at) VALUES (?,?,?,?)').run(id, type, name.trim(), new Date().toISOString());
  res.status(201).json({ success: true, data: { id, type, name: name.trim() } });
});

// PUT /api/categories/:id
router.put('/:id', adminMiddleware, (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'name tələb olunur.' });
  db.prepare('UPDATE categories SET name=? WHERE id=?').run(name.trim(), req.params.id);
  res.json({ success: true });
});

// DELETE /api/categories/:id
router.delete('/:id', adminMiddleware, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
