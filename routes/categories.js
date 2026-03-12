const express = require('express');
const router = express.Router();
const db = require('../database');
const { adminMiddleware } = require('../middleware/auth');

// GET /api/categories?type=class|subject|section
router.get('/', async (req, res) => {
  const { type } = req.query;
  let sql = 'SELECT * FROM categories';
  const params = [];
  if (type) { sql += ' WHERE type=?'; params.push(type); }
  sql += ' ORDER BY type, name ASC';
  res.json({ success: true, data: await db.all(sql, params) });
});

// POST /api/categories
router.post('/', adminMiddleware, async (req, res) => {
  const { type, name } = req.body;
  if (!type || !name) return res.status(400).json({ success: false, message: 'type və name tələb olunur.' });
  const valid = ['class','subject','section'];
  if (!valid.includes(type)) return res.status(400).json({ success: false, message: 'Yanlış tip.' });
  const id = type.slice(0,3) + '_' + Date.now();
  await db.run('INSERT INTO categories (id,type,name,created_at) VALUES (?,?,?,?)', [id, type, name.trim(), new Date().toISOString()]);
  res.status(201).json({ success: true, data: { id, type, name: name.trim() } });
});

// PUT /api/categories/:id
router.put('/:id', adminMiddleware, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ success: false, message: 'name tələb olunur.' });
  await db.run('UPDATE categories SET name=? WHERE id=?', [name.trim(), req.params.id]);
  res.json({ success: true });
});

// DELETE /api/categories/:id
router.delete('/:id', adminMiddleware, async (req, res) => {
  await db.run('DELETE FROM categories WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
