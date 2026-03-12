const express = require('express');
const router = express.Router();
const db = require('../database');
const { adminMiddleware } = require('../middleware/auth');

// GET /api/revenues — list with filters
router.get('/', adminMiddleware, async (req, res) => {
  const { from, to, exam_id, format } = req.query;
  let sql = 'SELECT r.*, e.price FROM revenues r LEFT JOIN exams e ON r.exam_id=e.id WHERE 1=1';
  const params = [];
  if (from) { sql += ' AND r.created_at >= ?'; params.push(from); }
  if (to)   { sql += ' AND r.created_at <= ?'; params.push(to + 'T23:59:59'); }
  if (exam_id) { sql += ' AND r.exam_id=?'; params.push(exam_id); }
  sql += ' ORDER BY r.created_at DESC';
  const rows = await db.all(sql, params);
  const total = rows.reduce((s,r) => s + (r.amount||0), 0);

  if (format === 'csv') {
    const header = 'Tarix,Şagird,İmtahan,Məbləğ (₼),Status\n';
    const csvRows = rows.map(r =>
      `"${(r.created_at||'').split('T')[0]}","${r.student_name||''}","${r.exam_title||''}","${(r.amount||0).toFixed(2)}","${r.status||''}"`
    ).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="abom-gelir.csv"');
    return res.send('\uFEFF' + header + csvRows);
  }

  res.json({ success: true, data: rows, total });
});

// GET /api/revenues/stats — per-exam summary
router.get('/stats', adminMiddleware, async (req, res) => {
  const { from, to } = req.query;
  let sql = `SELECT r.exam_id, r.exam_title,
    COUNT(*) as ticket_count,
    SUM(r.amount) as total_revenue,
    MIN(r.created_at) as first_sale,
    MAX(r.created_at) as last_sale
    FROM revenues r WHERE 1=1`;
  const params = [];
  if (from) { sql += ' AND r.created_at >= ?'; params.push(from); }
  if (to)   { sql += ' AND r.created_at <= ?'; params.push(to + 'T23:59:59'); }
  sql += ' GROUP BY r.exam_id ORDER BY total_revenue DESC';
  const rows = await db.all(sql, params);
  const grandTotal = rows.reduce((s,r) => s + (r.total_revenue||0), 0);
  const totalTickets = rows.reduce((s,r) => s + r.ticket_count, 0);
  res.json({ success: true, data: rows, grand_total: grandTotal, total_tickets: totalTickets });
});

// POST /api/revenues — internal: add revenue entry
router.post('/', adminMiddleware, async (req, res) => {
  const { registration_id, exam_id, user_id, student_name, exam_title, amount } = req.body;
  if (!registration_id) return res.status(400).json({ success: false, message: 'registration_id tələb olunur.' });
  try {
    await db.run('INSERT INTO revenues (id,registration_id,exam_id,user_id,student_name,exam_title,amount,status,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(registration_id) DO NOTHING', ['rev_'+Date.now(), registration_id, exam_id, user_id||'', student_name||'', exam_title||'', amount||0, 'confirmed', new Date().toISOString()]);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DELETE /api/revenues/by-reg/:registration_id — cancel revenue by registration
router.delete('/by-reg/:registration_id', adminMiddleware, async (req, res) => {
  await db.run('DELETE FROM revenues WHERE registration_id=?', [req.params.registration_id]);
  res.json({ success: true });
});

// DELETE /api/revenues/:id
router.delete('/:id', adminMiddleware, async (req, res) => {
  await db.run('DELETE FROM revenues WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
