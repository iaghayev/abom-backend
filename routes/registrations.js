const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('../config/uuid');
const db = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const uid = () => 'reg_' + uuidv4().slice(0,8);

// Telegram notification helpers
async function notifyNewRegistration(reg, exam) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = process.env;
  if (!token || !chatId) return;
  const msg = `🎫 YENİ BİLET SORĞUSUⁿ\n👤 ${reg.name}\n📱 ${reg.phone}\n📚 ${exam?.title||'—'}\n🏫 ${reg.class||'?'} sinif ${reg.section||''}`;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id: chatId, text: msg })
  });
}
async function notifyActivation(reg, exam) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = process.env;
  if (!token || !chatId) return;
  const msg = `✅ AKTİVLƏŞDİRİLDİ\n👤 ${reg.name}\n📚 ${exam?.title||'—'}\n💰 ${exam?.price||0} AZN`;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: {'Content-Type':'application/json'},
    body: JSON.stringify({ chat_id: chatId, text: msg })
  });
}

// ── GET student's own registrations ──────────────────────
router.get('/', authMiddleware, (req, res) => {
  const { status } = req.query;
  let sql = `
    SELECT r.*, e.title as exam_title, e.duration as exam_duration, e.price as exam_price
    FROM registrations r
    LEFT JOIN exams e ON e.id = r.exam_id
    WHERE r.user_id = ?`;
  const params = [req.user.id];
  // Default: exclude completed exams from student's active list
  if (status) {
    sql += ' AND r.status = ?'; params.push(status);
  } else {
    sql += " AND r.status NOT IN ('completed','cancelled')";
  }
  sql += ' ORDER BY r.created_at DESC';
  const rows = db.prepare(sql).all(...params);
  res.json({ success: true, data: rows });
});

// ── Pending count (admin badge) ──────────────────────────
router.get('/pending-count', adminMiddleware, (req, res) => {
  const row = db.prepare("SELECT COUNT(*) as count FROM registrations WHERE status='pending'").get();
  res.json({ success: true, count: row?.count||0 });
});

// ── GET all (admin) ──────────────────────────────────────
router.get('/admin/all', adminMiddleware, (req, res) => {
  const rows = db.prepare(`
    SELECT r.*, e.title as exam_title, e.price as exam_price, u.name as user_name
    FROM registrations r
    LEFT JOIN exams e ON e.id = r.exam_id
    LEFT JOIN users u ON u.id = r.user_id
    ORDER BY r.created_at DESC
  `).all();
  res.json({ success: true, data: rows });
});

// ── Check if user has ticket ─────────────────────────────
router.get('/check/:examId', authMiddleware, (req, res) => {
  const reg = db.prepare('SELECT * FROM registrations WHERE user_id=? AND exam_id=?')
    .get(req.user.id, req.params.examId);
  res.json({ success: true, hasTicket: !!reg, status: reg?.status || null });
});

// ── Student buys ticket ──────────────────────────────────
router.post('/', authMiddleware, (req, res) => {
  const { exam_id, name, phone, whatsapp, class: cls, section } = req.body;
  if (!exam_id || !name || !phone) return res.status(400).json({ success: false, message: 'Məlumatlar natamamdır.' });

  let targetExam = db.prepare('SELECT * FROM exams WHERE id=? AND is_active=1').get(exam_id);
  if (!targetExam) return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });

  // Smart sub-exam assignment
  const subCount = db.prepare("SELECT COUNT(*) as c FROM exams WHERE parent_exam_id=? AND is_active=1").get(exam_id)?.c || 0;
  if (subCount > 0) {
    const studentClass   = cls || req.user.class || '';
    const studentSection = section || req.user.section || '';
    let subExam = db.prepare("SELECT * FROM exams WHERE parent_exam_id=? AND is_active=1 AND class=? AND section=?").get(exam_id, studentClass, studentSection);
    if (!subExam) subExam = db.prepare("SELECT * FROM exams WHERE parent_exam_id=? AND is_active=1 AND class=?").get(exam_id, studentClass);
    if (!subExam) subExam = db.prepare("SELECT * FROM exams WHERE parent_exam_id=? AND is_active=1 AND section=?").get(exam_id, studentSection);
    if (!subExam) return res.status(400).json({
      success: false,
      message: `"${targetExam.title}" imtahanında ${studentClass} sinif ${studentSection} bölməsi üçün alt imtahan tapılmadı.`
    });
    targetExam = subExam;
  }

  // Check if already registered (any status — including cancelled)
  const existing = db.prepare('SELECT * FROM registrations WHERE user_id=? AND exam_id=?').get(req.user.id, targetExam.id);
  if (existing) {
    if (existing.status === 'active') return res.status(409).json({ success: false, message: 'Bu imtahan üçün aktiv biletiniz var.' });
    if (existing.status === 'pending') return res.status(409).json({ success: false, message: 'Biletiniz artıq gözləmə siyahısındadır.' });
    if (existing.status === 'cancelled') return res.status(409).json({ success: false, message: 'Bu imtahan üçün əvvəllər qeydiyyat etdiniz. Adminlə əlaqə saxlayın.' });
  }

  const id = uid();
  db.prepare(`INSERT INTO registrations (id,user_id,exam_id,name,phone,whatsapp,class,section,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.user.id, targetExam.id, name, phone, whatsapp||phone, cls||'', section||'', 'pending', new Date().toISOString());
  notifyNewRegistration({ id, name, phone, whatsapp: whatsapp||phone, class: cls||'', section: section||'' }, targetExam).catch(()=>{});
  res.status(201).json({
    success: true,
    message: subCount > 0 ? `"${targetExam.title}" imtahanına qeydiyyatınız qəbul edildi.` : 'Bilet sorğunuz qəbul edildi.',
    assigned_exam: targetExam.title
  });
});

// ── Admin: manually assign ───────────────────────────────
router.post('/admin/assign', adminMiddleware, (req, res) => {
  const { user_id, exam_id, activate, is_paid } = req.body;
  if (!user_id || !exam_id) return res.status(400).json({ success: false, message: 'user_id və exam_id tələb olunur.' });

  const existing = db.prepare('SELECT * FROM registrations WHERE user_id=? AND exam_id=?').get(user_id, exam_id);
  if (existing) {
    // If cancelled, allow re-activate via this route
    if (existing.status === 'cancelled') {
      const now = new Date().toISOString();
      const status = activate ? 'active' : 'pending';
      db.prepare("UPDATE registrations SET status=?, activated_at=? WHERE id=?").run(status, activate ? now : null, existing.id);
      if (activate && is_paid !== false) {
        const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(exam_id);
        const user = db.prepare('SELECT * FROM users WHERE id=?').get(user_id);
        try {
          db.prepare(`INSERT OR IGNORE INTO revenues (id,registration_id,exam_id,user_id,student_name,exam_title,amount,status,created_at)
            VALUES (?,?,?,?,?,?,?,?,?)`)
            .run('rev_'+Date.now(), existing.id, exam_id, user_id, user?.name||'', exam?.title||'', exam?.price||0, 'confirmed', now);
        } catch(e) {}
      }
      return res.json({ success: true, message: 'Şagirdin icazəsi bərpa edildi.', reactivated: true });
    }
    return res.status(409).json({ success: false, message: 'Bu şagird artıq bu imtahana qeydiyyatdadır.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(user_id);
  const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(exam_id);
  if (!user || !exam) return res.status(404).json({ success: false, message: 'Şagird və ya imtahan tapılmadı.' });

  const id  = uid();
  const now = new Date().toISOString();
  const status = activate ? 'active' : 'pending';
  db.prepare(`INSERT INTO registrations (id,user_id,exam_id,name,phone,whatsapp,class,section,status,created_at,activated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, user_id, exam_id, user.name, user.phone, user.phone, user.class||'', user.section||'', status, now, activate ? now : null);

  // Write to revenues only if paid (is_paid !== false, default true)
  if (activate && is_paid !== false) {
    try {
      db.prepare(`INSERT OR IGNORE INTO revenues (id,registration_id,exam_id,user_id,student_name,exam_title,amount,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run('rev_'+Date.now(), id, exam_id, user_id, user.name, exam.title, exam.price||0, 'confirmed', now);
    } catch(e) {}
  }
  res.status(201).json({ success: true, message: 'Assign edildi.' });
});

// ── Admin: activate registration ─────────────────────────
router.put('/:id/activate', adminMiddleware, (req, res) => {
  const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(req.params.id);
  if (!reg) return res.status(404).json({ success: false, message: 'Qeydiyyat tapılmadı.' });
  const now = new Date().toISOString();
  db.prepare("UPDATE registrations SET status='active', activated_at=? WHERE id=?").run(now, req.params.id);
  const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(reg.exam_id);
  try {
    db.prepare(`INSERT OR IGNORE INTO revenues (id,registration_id,exam_id,user_id,student_name,exam_title,amount,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`)
      .run('rev_'+Date.now(), reg.id, reg.exam_id, reg.user_id, reg.name, exam?.title||'', exam?.price||0, 'confirmed', now);
  } catch(e) {}
  notifyActivation(reg, exam).catch(()=>{});
  res.json({ success: true, message: 'Aktivləşdirildi.' });
});

// ── Admin: SOFT cancel — keeps registration, removes revenue only ──
router.put('/:id/cancel', adminMiddleware, (req, res) => {
  const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(req.params.id);
  if (!reg) return res.status(404).json({ success: false, message: 'Tapılmadı.' });
  db.prepare("UPDATE registrations SET status='cancelled' WHERE id=?").run(req.params.id);
  db.prepare('DELETE FROM revenues WHERE registration_id=?').run(reg.id);
  res.json({ success: true, message: 'İcazə ləğv edildi. Qeydiyyat saxlanıldı.' });
});

// ── Admin: re-activate a cancelled registration ───────────
router.put('/:id/reactivate', adminMiddleware, (req, res) => {
  const { is_paid } = req.body;
  const reg = db.prepare('SELECT * FROM registrations WHERE id=?').get(req.params.id);
  if (!reg) return res.status(404).json({ success: false, message: 'Tapılmadı.' });
  const now = new Date().toISOString();
  db.prepare("UPDATE registrations SET status='active', activated_at=? WHERE id=?").run(now, req.params.id);
  if (is_paid !== false) {
    const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(reg.exam_id);
    try {
      db.prepare(`INSERT OR IGNORE INTO revenues (id,registration_id,exam_id,user_id,student_name,exam_title,amount,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run('rev_'+Date.now(), reg.id, reg.exam_id, reg.user_id, reg.name, exam?.title||'', exam?.price||0, 'confirmed', now);
    } catch(e) {}
  }
  res.json({ success: true, message: 'Yenidən aktivləşdirildi.' });
});

// ── Admin: change status (generic) ──────────────────────
router.put('/:id/status', adminMiddleware, (req, res) => {
  const { status } = req.body;
  if (!['pending','active','cancelled'].includes(status)) return res.status(400).json({ success: false, message: 'Yanlış status.' });
  db.prepare('UPDATE registrations SET status=? WHERE id=?').run(status, req.params.id);
  res.json({ success: true });
});

// ── Admin: edit registration details ────────────────────
router.put('/:id/edit', adminMiddleware, (req, res) => {
  const { name, phone, class: cls, section, status } = req.body;
  const reg = db.prepare('SELECT id FROM registrations WHERE id=?').get(req.params.id);
  if (!reg) return res.status(404).json({ success: false, message: 'Tapılmadı.' });
  const updates = [], params = [];
  if (name    !== undefined) { updates.push('name=?');    params.push(name); }
  if (phone   !== undefined) { updates.push('phone=?');   params.push(phone); }
  if (cls     !== undefined) { updates.push('class=?');   params.push(cls); }
  if (section !== undefined) { updates.push('section=?'); params.push(section); }
  if (status  !== undefined) { updates.push('status=?');  params.push(status); }
  if (!updates.length) return res.json({ success: true });
  params.push(req.params.id);
  db.prepare(`UPDATE registrations SET ${updates.join(',')} WHERE id=?`).run(...params);
  res.json({ success: true });
});

// ── Admin: hard delete registration ─────────────────────
router.delete('/:id', adminMiddleware, (req, res) => {
  const reg = db.prepare('SELECT id FROM registrations WHERE id=?').get(req.params.id);
  if (!reg) return res.status(404).json({ success: false, message: 'Tapılmadı.' });
  db.prepare('DELETE FROM revenues WHERE registration_id=?').run(req.params.id);
  db.prepare('DELETE FROM registrations WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

module.exports = router;
