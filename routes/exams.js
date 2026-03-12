const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('../config/uuid');
const db = require('../database');
const { authMiddleware, adminMiddleware, optionalAuth } = require('../middleware/auth');

// ── GET /  ────────────────────────────────────────────────
router.get('/', optionalAuth, (req, res) => {
  const { category, subject, class: cls, section, search, parent_only, parent_id, admin } = req.query;
  let sql = `SELECT e.*,
    (SELECT COUNT(*) FROM questions q WHERE q.exam_id=e.id) as own_question_count,
    (SELECT COUNT(*) FROM exams sub WHERE sub.parent_exam_id=e.id) as sub_count
    FROM exams e WHERE 1=1`;
  const params = [];

  if (!admin) {
    sql += ' AND e.is_active=1';
    const now = new Date().toISOString().slice(0,10);
    sql += ` AND (e.is_unlimited=1 OR (
      (e.start_date='' OR e.start_date IS NULL OR e.start_date<=?)
      AND (e.end_date='' OR e.end_date IS NULL OR e.end_date>=?)
    ))`;
    params.push(now, now);
    sql += " AND (e.parent_exam_id='' OR e.parent_exam_id IS NULL)";
  }

  if (category)    { sql += ' AND e.category=?';   params.push(category); }
  if (subject)     { sql += ' AND e.subject=?';    params.push(subject); }
  if (cls)         { sql += ' AND e.class=?';      params.push(cls); }
  if (section)     { sql += ' AND e.section=?';    params.push(section); }
  if (search)      { sql += ' AND (e.title LIKE ? OR e.description LIKE ?)'; params.push(`%${search}%`,`%${search}%`); }
  if (parent_only) { sql += " AND (e.parent_exam_id='' OR e.parent_exam_id IS NULL)"; }
  if (parent_id)   { sql += ' AND e.parent_exam_id=?'; params.push(parent_id); }
  sql += ' ORDER BY e.created_at DESC';

  const exams = db.prepare(sql).all(...params);

  // For root exams (no parent), calculate total question count across all descendants
  const countDescendantQuestions = (examId) => {
    const direct = db.prepare('SELECT COUNT(*) as c FROM questions WHERE exam_id=?').get(examId).c;
    const children = db.prepare('SELECT id FROM exams WHERE parent_exam_id=?').all(examId);
    return direct + children.reduce((sum, c) => sum + countDescendantQuestions(c.id), 0);
  };

  const result = exams.map(e => {
    const isRoot = !e.parent_exam_id || e.parent_exam_id === '';
    const question_count = (isRoot && e.sub_count > 0)
      ? countDescendantQuestions(e.id)
      : e.own_question_count;
    return { ...e, question_count };
  });

  res.json({ success:true, data: result });
});

// ── GET /:id/tree — full nested tree for buy modal (BEFORE /:id) ──
router.get('/:id/tree', optionalAuth, (req, res) => {
  // Level 1: language groups (direct children of root exam)
  const langGroups = db.prepare(`
    SELECT * FROM exams WHERE parent_exam_id=? AND is_active=1 ORDER BY section, title
  `).all(req.params.id);

  if (!langGroups.length) {
    // Flat group (old-style) — return direct children as grades
    const subs = db.prepare(`
      SELECT class, section FROM exams
      WHERE parent_exam_id=? AND is_active=1 ORDER BY class, section
    `).all(req.params.id);
    return res.json({ success:true, type:'flat', data:subs,
      classes:[...new Set(subs.map(s=>s.class).filter(Boolean))],
      sections:[...new Set(subs.map(s=>s.section).filter(Boolean))] });
  }

  // Check if level-1 children themselves have children (3-level)
  const firstChild = langGroups[0];
  const gradeCheck = db.prepare("SELECT COUNT(*) as c FROM exams WHERE parent_exam_id=? AND is_active=1").get(firstChild.id);

  if (gradeCheck?.c > 0) {
    // 3-level: root → language → grade
    const tree = langGroups.map(lang => {
      const grades = db.prepare(`
        SELECT * FROM exams WHERE parent_exam_id=? AND is_active=1 ORDER BY CAST(class AS INTEGER), class
      `).all(lang.id);
      return { id: lang.id, label: lang.section||lang.title, title: lang.title, section: lang.section, grades };
    });
    const allGrades = [...new Set(tree.flatMap(l=>l.grades.map(g=>g.class)).filter(Boolean))].sort((a,b)=>parseInt(a)-parseInt(b));
    return res.json({ success:true, type:'multilevel', languages: tree, allGrades });
  }

  // 2-level: root → direct subs with class/section
  const subs = db.prepare(`
    SELECT class, section FROM exams
    WHERE parent_exam_id=? AND is_active=1 ORDER BY class, section
  `).all(req.params.id);
  res.json({ success:true, type:'flat', data:subs,
    classes:[...new Set(subs.map(s=>s.class).filter(Boolean))],
    sections:[...new Set(subs.map(s=>s.section).filter(Boolean))] });
});

// ── GET /:id/subs (MUST be before /:id) ──────────────────
router.get('/:id/subs', optionalAuth, (req, res) => {
  const subs = db.prepare(`
    SELECT class, section FROM exams
    WHERE parent_exam_id=? AND is_active=1 ORDER BY class, section
  `).all(req.params.id);
  const classes  = [...new Set(subs.map(s=>s.class).filter(Boolean))];
  const sections = [...new Set(subs.map(s=>s.section).filter(Boolean))];
  res.json({ success:true, data:subs, classes, sections });
});

// ── GET /:id/questions (MUST be before /:id) ─────────────
router.get('/:id/questions', authMiddleware, (req, res) => {
  const user = req.user;
  if (user.role !== 'admin') {
    const reg = db.prepare("SELECT * FROM registrations WHERE user_id=? AND exam_id=? AND status='active'")
      .get(user.id, req.params.id);
    if (!reg) return res.status(403).json({ success:false, message:'Bu imtahan üçün aktiv biletiniz yoxdur.' });
  }
  const questions = db.prepare('SELECT * FROM questions WHERE exam_id=? ORDER BY order_num ASC').all(req.params.id);
  const safe = questions.map(q => {
    if (user.role==='admin') return q;
    const { correct, ...rest } = q; return rest;
  });
  res.json({ success:true, data:safe });
});

// ── GET /:id ──────────────────────────────────────────────
router.get('/:id', optionalAuth, (req, res) => {
  const exam = db.prepare(`SELECT e.*,
    (SELECT COUNT(*) FROM questions q WHERE q.exam_id=e.id) as question_count,
    (SELECT COUNT(*) FROM exams sub WHERE sub.parent_exam_id=e.id) as sub_count
    FROM exams e WHERE e.id=?`).get(req.params.id);
  if (!exam) return res.status(404).json({ success:false, message:'İmtahan tapılmadı.' });
  res.json({ success:true, data:exam });
});

// ── POST / ────────────────────────────────────────────────
router.post('/', adminMiddleware, (req, res) => {
  const { title, description, category, subject, class: cls, section,
    duration, price, start_date, end_date, is_unlimited, parent_exam_id } = req.body;
  if (!title || !category || !subject)
    return res.status(400).json({ success:false, message:'Başlıq, kateqoriya, fənn tələb olunur.' });
  const id  = 'ex_' + uuidv4().slice(0,8);
  const now = new Date().toISOString();
  const unlimited = (is_unlimited===false||is_unlimited===0||is_unlimited==='0') ? 0 : 1;
  db.prepare(`INSERT INTO exams
    (id,title,description,category,subject,class,section,duration,price,
     start_date,end_date,is_unlimited,parent_exam_id,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, title, description||'', category, subject, cls||'', section||'',
         duration||60, price||0, start_date||'', end_date||'', unlimited, parent_exam_id||'', now);
  if (!parent_exam_id) {
    const icc = db.prepare('INSERT INTO cert_configs (id,exam_id,level_name,min_score,max_score,color) VALUES (?,?,?,?,?,?)');
    [['İştirak',0,40,'#94a3b8'],['Bürünc',41,70,'#b45309'],['Gümüş',71,85,'#64748b'],['Qızıl',86,100,'#d97706']]
      .forEach(([l,mn,mx,c]) => icc.run(`cc_${id}_${l}`, id, l, mn, mx, c));
  }
  res.status(201).json({ success:true, data: db.prepare('SELECT * FROM exams WHERE id=?').get(id) });
});

// ── PATCH /:id/toggle-active ──────────────────────────────
router.patch('/:id/toggle-active', adminMiddleware, (req, res) => {
  const exam = db.prepare('SELECT id, is_active FROM exams WHERE id=?').get(req.params.id);
  if (!exam) return res.status(404).json({ success:false, message:'İmtahan tapılmadı.' });
  const newVal = exam.is_active ? 0 : 1;
  db.prepare('UPDATE exams SET is_active=? WHERE id=?').run(newVal, req.params.id);
  res.json({ success:true, is_active: newVal });
});

// ── PUT /:id ──────────────────────────────────────────────
router.put('/:id', adminMiddleware, (req, res) => {
  const { title, description, category, subject, class: cls, section,
    duration, price, is_active, start_date, end_date, is_unlimited, parent_exam_id } = req.body;
  if (!db.prepare('SELECT id FROM exams WHERE id=?').get(req.params.id))
    return res.status(404).json({ success:false, message:'İmtahan tapılmadı.' });
  const unlimited = (is_unlimited===false||is_unlimited===0||is_unlimited==='0') ? 0 : 1;
  db.prepare(`UPDATE exams SET
    title=?,description=?,category=?,subject=?,class=?,section=?,
    duration=?,price=?,is_active=?,start_date=?,end_date=?,is_unlimited=?,parent_exam_id=?
    WHERE id=?`)
    .run(title, description||'', category, subject, cls||'', section||'',
         duration||60, price||0, is_active??1,
         start_date||'', end_date||'', unlimited, parent_exam_id||'', req.params.id);
  res.json({ success:true, data: db.prepare('SELECT * FROM exams WHERE id=?').get(req.params.id) });
});

// ── DELETE /:id ───────────────────────────────────────────
router.delete('/:id', adminMiddleware, (req, res) => {
  const id = req.params.id;
  if (!db.prepare('SELECT id FROM exams WHERE id=?').get(id))
    return res.status(404).json({ success:false, message:'İmtahan tapılmadı.' });

  // Recursive cascade delete: collect all descendant exam ids
  function collectIds(examId) {
    const ids = [examId];
    const children = db.prepare('SELECT id FROM exams WHERE parent_exam_id=?').all(examId);
    children.forEach(c => ids.push(...collectIds(c.id)));
    return ids;
  }
  const allIds = collectIds(id);

  // Delete in dependency order for all collected ids
  const del = db.transaction(() => {
    allIds.forEach(eid => {
      db.prepare('DELETE FROM results        WHERE exam_id=?').run(eid);
      db.prepare('DELETE FROM registrations  WHERE exam_id=?').run(eid);
      db.prepare('DELETE FROM questions      WHERE exam_id=?').run(eid);
      db.prepare('DELETE FROM cert_configs   WHERE exam_id=?').run(eid);
    });
    // Delete from leaf to root so FK on parent_exam_id is satisfied
    allIds.reverse().forEach(eid => {
      db.prepare('DELETE FROM exams WHERE id=?').run(eid);
    });
  });
  del();

  res.json({ success:true, deleted: allIds.length });
});

module.exports = router;
