const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('../config/uuid');
const db = require('../database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { sendTemplate, sendWhatsApp } = require('../config/whatsapp');

const uid = () => 'reg_' + uuidv4().slice(0,8);

// ── Telegram: Bilet sorğusu — "Aktiv et" düyməsi ilə ────────
async function notifyNewRegistration(reg, exam) {
  const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId } = process.env;
  if (!token || !chatId) return;
  const text =
`🎫 *YENİ BİLET SORĞUSU*

👤 Ad: ${reg.name}
📱 Nömrə: ${reg.phone}
📚 İmtahan: ${exam?.title || '—'}
🏫 Sinif: ${reg.class || '?'}${reg.section ? ' · ' + reg.section : ''}
💰 Məbləğ: ${exam?.price || 0} AZN
🆔 Sorğu ID: \`${reg.id}\``;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId, text, parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [[{ text: '✅ Aktiv et', callback_data: `activate:${reg.id}` }]] }
    })
  });
}
async function notifyActivation() {} // handled via Telegram inline button

function examDateLine(exam) {
  if (!exam?.start_date && !exam?.end_date) return '';
  const fmt = d => { try { return new Date(d).toLocaleDateString('az-AZ',{day:'2-digit',month:'short',timeZone:'Asia/Baku'}); } catch{ return d; } };
  const s = exam.start_date ? fmt(exam.start_date) : '';
  const e = exam.end_date   ? fmt(exam.end_date)   : '';
  if (s && e) return `\n📅 İmtahan ${s} - ${e} tarixləri arasında aktiv olacaq. Bu müddət ərzində istədiyiniz vaxt imtahana başlaya bilərsiniz. ⏰`;
  if (s)      return `\n📅 İmtahan ${s} tarixindən aktivdir. ⏰`;
  return '';
}

async function waNewTicket(reg, exam) {
  const waPhone = reg.whatsapp || reg.phone;
  if (!waPhone) return;
  await sendTemplate(waPhone, 'ticket', {
    name:       reg.name,
    exam_title: exam?.title || '—',
    price:      exam?.price || 0,
  });
}

async function waActivated(reg, exam) {
  const waPhone = reg.whatsapp || reg.phone;
  if (!waPhone) return;
  const user = await db.get('SELECT username, plain_password FROM users WHERE id=?', [reg.user_id]);
  if (!user) return;
  const pass = user.plain_password || '—';
  await sendTemplate(waPhone, 'activate', {
    name:         reg.name,
    exam_title:   exam?.title || '—',
    username:     user.username,
    password:     pass,
    username_enc: encodeURIComponent(user.username),
    password_enc: encodeURIComponent(pass),
    date_line:    examDateLine(exam),
  });
}

// ── GET student's own registrations ──────────────────────
router.get('/', authMiddleware, async (req, res) => {
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
  const rows = await db.all(sql, params);
  res.json({ success: true, data: rows });
});

// ── Pending count (admin badge) ──────────────────────────
router.get('/pending-count', adminMiddleware, async (req, res) => {
  const row = await db.get("SELECT COUNT(*) as count FROM registrations WHERE status='pending'", []);
  res.json({ success: true, count: row?.count||0 });
});

// ── GET all (admin) ──────────────────────────────────────
router.get('/admin/all', adminMiddleware, async (req, res) => {
  const rows = await db.all(`
    SELECT r.*, e.title as exam_title, e.price as exam_price, u.name as user_name
    FROM registrations r
    LEFT JOIN exams e ON e.id = r.exam_id
    LEFT JOIN users u ON u.id = r.user_id
    ORDER BY r.created_at DESC
  `, []);
  res.json({ success: true, data: rows });
});

// ── Check if user has ticket ─────────────────────────────
router.get('/check/:examId', authMiddleware, async (req, res) => {
  const reg = await db.get('SELECT * FROM registrations WHERE user_id=? AND exam_id=?', [req.user.id, req.params.examId]);
  res.json({ success: true, hasTicket: !!reg, status: reg?.status || null });
});

// ── Student buys ticket ──────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  const { exam_id, name, phone, whatsapp, class: cls, section } = req.body;
  if (!exam_id || !name || !phone) return res.status(400).json({ success: false, message: 'Məlumatlar natamamdır.' });

  let targetExam = await db.get('SELECT * FROM exams WHERE id=? AND is_active=1', [exam_id]);
  if (!targetExam) return res.status(404).json({ success: false, message: 'İmtahan tapılmadı.' });

  // Smart sub-exam assignment — supports up to 3 levels deep
  // level 1: root→children (flat: class+section)
  // level 2: root→language→grade  (req.body.language + class)
  const _subRow = await db.get("SELECT COUNT(*) as c FROM exams WHERE parent_exam_id=? AND is_active=1", [exam_id]);
  const subCount = Number(_subRow?.c) || 0;
  if (subCount > 0) {
    const studentClass    = cls || req.user.class || '';
    const studentSection  = section || req.user.section || '';
    const studentLanguage = req.body.language || '';

    // Check if first-level children have children (3-level tree)
    const firstChild = await db.get("SELECT id FROM exams WHERE parent_exam_id=? AND is_active=1 LIMIT 1", [exam_id]);
    const grandchildRow = firstChild
      ? await db.get("SELECT COUNT(*) as c FROM exams WHERE parent_exam_id=? AND is_active=1", [firstChild.id])
      : null;
    const grandchildCount = Number(grandchildRow?.c) || 0;

    let targetLeaf = null;

    if (grandchildCount > 0) {
      // 3-level: find language group first, then grade within it
      // Frontend sends section ('AZ','RU','EN') — use it as language selector
      const langKey = studentLanguage || studentSection;
      let langGroup = null;
      if (langKey) {
        langGroup = await db.get("SELECT * FROM exams WHERE parent_exam_id=? AND is_active=1 AND section=?", [exam_id, langKey]);
      }
      if (!langGroup) langGroup = await db.get("SELECT * FROM exams WHERE parent_exam_id=? AND is_active=1 LIMIT 1", [exam_id]);

      if (langGroup) {
        targetLeaf = await db.get("SELECT * FROM exams WHERE parent_exam_id=? AND is_active=1 AND class=?", [langGroup.id, studentClass]);
        if (!targetLeaf) targetLeaf = await db.get("SELECT * FROM exams WHERE parent_exam_id=? AND is_active=1 LIMIT 1", [langGroup.id]);
      }
      if (!targetLeaf) return res.status(400).json({
        success: false,
        message: `"${targetExam.title}" imtahanında ${studentLanguage||'?'} dili, ${studentClass||'?'}-ci sinif üçün imtahan tapılmadı.`
      });
    } else {
      // 2-level: class + section
      targetLeaf = await db.get("SELECT * FROM exams WHERE parent_exam_id=? AND is_active=1 AND class=? AND section=?", [exam_id, studentClass, studentSection]);
      if (!targetLeaf) targetLeaf = await db.get("SELECT * FROM exams WHERE parent_exam_id=? AND is_active=1 AND class=?", [exam_id, studentClass]);
      if (!targetLeaf) targetLeaf = await db.get("SELECT * FROM exams WHERE parent_exam_id=? AND is_active=1 AND section=?", [exam_id, studentSection]);
      if (!targetLeaf) return res.status(400).json({
        success: false,
        message: `"${targetExam.title}" imtahanında ${studentClass}-ci sinif ${studentSection} bölməsi üçün alt imtahan tapılmadı.`
      });
    }
    targetExam = targetLeaf;
  }

  // Check if already registered (any status — including cancelled)
  const existing = await db.get('SELECT * FROM registrations WHERE user_id=? AND exam_id=?', [req.user.id, targetExam.id]);
  if (existing) {
    if (existing.status === 'active') return res.status(409).json({ success: false, message: 'Bu imtahan üçün aktiv biletiniz var.' });
    if (existing.status === 'pending') return res.status(409).json({ success: false, message: 'Biletiniz artıq gözləmə siyahısındadır.' });
    if (existing.status === 'cancelled') return res.status(409).json({ success: false, message: 'Bu imtahan üçün əvvəllər qeydiyyat etdiniz. Adminlə əlaqə saxlayın.' });
  }

  const id = uid();
  await db.run(`INSERT INTO registrations (id,user_id,exam_id,name,phone,whatsapp,class,section,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`, [id, req.user.id, targetExam.id, name, phone, whatsapp||phone, cls||'', section||'', 'pending', new Date().toISOString()]);
  notifyNewRegistration({ id, name, phone, whatsapp: whatsapp||phone, class: cls||'', section: section||'' }, targetExam).catch(()=>{});
  waNewTicket({ id, name, phone, whatsapp: whatsapp||phone, class: cls||'', section: section||'' }, targetExam).catch(()=>{});
  res.status(201).json({
    success: true,
    message: subCount > 0 ? `"${targetExam.title}" imtahanına qeydiyyatınız qəbul edildi.` : 'Bilet sorğunuz qəbul edildi.',
    assigned_exam: targetExam.title
  });
});

// ── Admin: manually assign ───────────────────────────────
router.post('/admin/assign', adminMiddleware, async (req, res) => {
  const { user_id, exam_id, activate, is_paid } = req.body;
  if (!user_id || !exam_id) return res.status(400).json({ success: false, message: 'user_id və exam_id tələb olunur.' });

  const existing = await db.get('SELECT * FROM registrations WHERE user_id=? AND exam_id=?', [user_id, exam_id]);
  if (existing) {
    // If cancelled, allow re-activate via this route
    if (existing.status === 'cancelled') {
      const now = new Date().toISOString();
      const status = activate ? 'active' : 'pending';
      await db.run("UPDATE registrations SET status=?, activated_at=? WHERE id=?", [status, activate ? now : null, existing.id]);
      if (activate && is_paid !== false) {
        const exam = await db.get('SELECT * FROM exams WHERE id=?', [exam_id]);
        const user = await db.get('SELECT * FROM users WHERE id=?', [user_id]);
        try {
          await db.run(`INSERT INTO revenues (id,registration_id,exam_id,user_id,student_name,exam_title,amount,status,created_at)
            VALUES (?,?,?,?,?,?,?,?,?)`, ['rev_'+Date.now(), existing.id, exam_id, user_id, user?.name||'', exam?.title||'', exam?.price||0, 'confirmed', now]);
        } catch(e) {}
      }
      return res.json({ success: true, message: 'Şagirdin icazəsi bərpa edildi.', reactivated: true });
    }
    return res.status(409).json({ success: false, message: 'Bu şagird artıq bu imtahana qeydiyyatdadır.' });
  }

  const user = await db.get('SELECT * FROM users WHERE id=?', [user_id]);
  const exam = await db.get('SELECT * FROM exams WHERE id=?', [exam_id]);
  if (!user || !exam) return res.status(404).json({ success: false, message: 'Şagird və ya imtahan tapılmadı.' });

  const id  = uid();
  const now = new Date().toISOString();
  const status = activate ? 'active' : 'pending';
  await db.run(`INSERT INTO registrations (id,user_id,exam_id,name,phone,whatsapp,class,section,status,created_at,activated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [id, user_id, exam_id, user.name, user.phone, user.phone, user.class||'', user.section||'', status, now, activate ? now : null]);

  // Write to revenues only if paid (is_paid !== false, default true)
  if (activate && is_paid !== false) {
    try {
      await db.run(`INSERT INTO revenues (id,registration_id,exam_id,user_id,student_name,exam_title,amount,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`, ['rev_'+Date.now(), id, exam_id, user_id, user.name, exam.title, exam.price||0, 'confirmed', now]);
    } catch(e) {}
  }
  res.status(201).json({ success: true, message: 'Assign edildi.' });
});

// ── Admin: activate registration ─────────────────────────
router.put('/:id/activate', adminMiddleware, async (req, res) => {
  const reg = await db.get('SELECT * FROM registrations WHERE id=?', [req.params.id]);
  if (!reg) return res.status(404).json({ success: false, message: 'Qeydiyyat tapılmadı.' });
  const now = new Date().toISOString();
  await db.run("UPDATE registrations SET status='active', activated_at=? WHERE id=?", [now, req.params.id]);
  const exam = await db.get('SELECT * FROM exams WHERE id=?', [reg.exam_id]);
  try {
    await db.run(`INSERT INTO revenues (id,registration_id,exam_id,user_id,student_name,exam_title,amount,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`, ['rev_'+Date.now(), reg.id, reg.exam_id, reg.user_id, reg.name, exam?.title||'', exam?.price||0, 'confirmed', now]);
  } catch(e) {}
  notifyActivation(reg, exam).catch(()=>{});
  waActivated(reg, exam).catch(()=>{});
  res.json({ success: true, message: 'Aktivləşdirildi.' });
});

// ── Admin: SOFT cancel — keeps registration, removes revenue only ──
router.put('/:id/cancel', adminMiddleware, async (req, res) => {
  const reg = await db.get('SELECT * FROM registrations WHERE id=?', [req.params.id]);
  if (!reg) return res.status(404).json({ success: false, message: 'Tapılmadı.' });
  await db.run("UPDATE registrations SET status='cancelled' WHERE id=?", [req.params.id]);
  await db.run('DELETE FROM revenues WHERE registration_id=?', [reg.id]);
  res.json({ success: true, message: 'İcazə ləğv edildi. Qeydiyyat saxlanıldı.' });
});

// ── Admin: re-activate a cancelled registration ───────────
router.put('/:id/reactivate', adminMiddleware, async (req, res) => {
  const { is_paid } = req.body;
  const reg = await db.get('SELECT * FROM registrations WHERE id=?', [req.params.id]);
  if (!reg) return res.status(404).json({ success: false, message: 'Tapılmadı.' });
  const now = new Date().toISOString();
  await db.run("UPDATE registrations SET status='active', activated_at=? WHERE id=?", [now, req.params.id]);
  if (is_paid !== false) {
    const exam = await db.get('SELECT * FROM exams WHERE id=?', [reg.exam_id]);
    try {
      await db.run(`INSERT INTO revenues (id,registration_id,exam_id,user_id,student_name,exam_title,amount,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`, ['rev_'+Date.now(), reg.id, reg.exam_id, reg.user_id, reg.name, exam?.title||'', exam?.price||0, 'confirmed', now]);
    } catch(e) {}
  }
  res.json({ success: true, message: 'Yenidən aktivləşdirildi.' });
});

// ── Admin: change status (generic) ──────────────────────
router.put('/:id/status', adminMiddleware, async (req, res) => {
  const { status } = req.body;
  if (!['pending','active','cancelled'].includes(status)) return res.status(400).json({ success: false, message: 'Yanlış status.' });
  await db.run('UPDATE registrations SET status=? WHERE id=?', [status, req.params.id]);
  res.json({ success: true });
});

// ── Admin: edit registration details ────────────────────
router.put('/:id/edit', adminMiddleware, async (req, res) => {
  const { name, phone, class: cls, section, status } = req.body;
  const reg = await db.get('SELECT id FROM registrations WHERE id=?', [req.params.id]);
  if (!reg) return res.status(404).json({ success: false, message: 'Tapılmadı.' });
  const updates = [], params = [];
  if (name    !== undefined) { updates.push('name=?');    params.push(name); }
  if (phone   !== undefined) { updates.push('phone=?');   params.push(phone); }
  if (cls     !== undefined) { updates.push('class=?');   params.push(cls); }
  if (section !== undefined) { updates.push('section=?'); params.push(section); }
  if (status  !== undefined) { updates.push('status=?');  params.push(status); }
  if (!updates.length) return res.json({ success: true });
  params.push(req.params.id);
  await db.run(`UPDATE registrations SET ${updates.join(',')} WHERE id=?`, [...params]);
  res.json({ success: true });
});

// ── Admin: hard delete registration ─────────────────────
router.delete('/:id', adminMiddleware, async (req, res) => {
  const reg = await db.get('SELECT id FROM registrations WHERE id=?', [req.params.id]);
  if (!reg) return res.status(404).json({ success: false, message: 'Tapılmadı.' });
  await db.run('DELETE FROM revenues WHERE registration_id=?', [req.params.id]);
  await db.run('DELETE FROM registrations WHERE id=?', [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
