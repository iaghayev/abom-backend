const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('../config/uuid');
const db = require('../database');
const { authMiddleware, adminMiddleware, optionalAuth } = require('../middleware/auth');

// ─── VIDEOS ──────────────────────────────────────────────────

// GET /api/videos
router.get('/', optionalAuth, async (req, res) => {
  const { subject, class: cls, type, search } = req.query;
  let sql = 'SELECT * FROM videos WHERE is_active = 1';
  const params = [];
  if (subject) { sql += ' AND subject = ?'; params.push(subject); }
  if (cls)     { sql += ' AND class = ?';   params.push(cls); }
  if (type)    { sql += ' AND type = ?';    params.push(type); }
  if (search)  { sql += ' AND title LIKE ?'; params.push(`%${search}%`); }
  sql += ' ORDER BY created_at DESC';
  let videos = await db.all(sql, params);
  // For non-logged-in users, hide youtube_id of paid videos
  if (!req.user) {
    videos = videos.map(v => v.type === 'paid' ? { ...v, youtube_id: null } : v);
  }
  res.json({ success: true, data: videos });
});

// GET /api/videos/:id
router.get('/:id', optionalAuth, async (req, res) => {
  const v = await db.get('SELECT * FROM videos WHERE id = ?', [req.params.id]);
  if (!v) return res.status(404).json({ success: false, message: 'Video tapılmadı.' });
  if (v.type === 'paid' && !req.user) {
    return res.json({ success: true, data: { ...v, youtube_id: null, locked: true } });
  }
  res.json({ success: true, data: v });
});

// POST /api/videos — admin
router.post('/', adminMiddleware, async (req, res) => {
  const { title, youtube_id, subject, class: cls, type, duration } = req.body;
  if (!title || !youtube_id || !subject || !cls) {
    return res.status(400).json({ success: false, message: 'Başlıq, YouTube ID, fənn, sinif tələb olunur.' });
  }
  // Extract YT ID if full URL given
  const ytId = youtube_id.replace(/.*[?&]v=([^&]+).*/,'$1').replace(/.*youtu\.be\//,'').split('?')[0];
  const id = 'v_' + uuidv4().slice(0,8);
  const now = new Date().toISOString();
  await db.run('INSERT INTO videos (id,title,youtube_id,subject,class,type,duration,created_at) VALUES (?,?,?,?,?,?,?,?)', [id, title, ytId, subject, cls, type||'free', duration||'00:00', now]);
  res.status(201).json({ success: true, data: await db.get('SELECT * FROM videos WHERE id = ?', [id]) });
});

// PUT /api/videos/:id — admin
router.put('/:id', adminMiddleware, async (req, res) => {
  const { title, youtube_id, subject, class: cls, type, duration, is_active } = req.body;
  const v = await db.get('SELECT id FROM videos WHERE id = ?', [req.params.id]);
  if (!v) return res.status(404).json({ success: false, message: 'Video tapılmadı.' });
  const ytId = (youtube_id||'').replace(/.*[?&]v=([^&]+).*/,'$1').replace(/.*youtu\.be\//,'').split('?')[0] || youtube_id;
  await db.run('UPDATE videos SET title=?,youtube_id=?,subject=?,class=?,type=?,duration=?,is_active=? WHERE id=?', [title, ytId, subject, cls, type||'free', duration||'00:00', is_active??1, req.params.id]);
  res.json({ success: true, data: await db.get('SELECT * FROM videos WHERE id = ?', [req.params.id]) });
});

// DELETE /api/videos/:id — admin
router.delete('/:id', adminMiddleware, async (req, res) => {
  await db.run('DELETE FROM videos WHERE id = ?', [req.params.id]);
  res.json({ success: true, message: 'Video silindi.' });
});

module.exports = router;
