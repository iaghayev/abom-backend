const jwt = require('jsonwebtoken');
const db = require('../database');

async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer '))
    return res.status(401).json({ success: false, message: 'Token yoxdur. Zəhmət olmasa daxil olun.' });
  const token = header.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await db.get('SELECT id, username, name, phone, class, section, role, is_disabled FROM users WHERE id=?', [decoded.id]);
    if (!user) return res.status(401).json({ success: false, message: 'İstifadəçi tapılmadı.' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Token etibarsızdır.' });
  }
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== 'admin')
      return res.status(403).json({ success: false, message: 'Admin icazəsi tələb olunur.' });
    next();
  });
}

async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.split(' ')[1];
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await db.get('SELECT id, username, name, phone, class, section, role FROM users WHERE id=?', [decoded.id]);
      if (user) req.user = user;
    } catch {}
  }
  next();
}

module.exports = { authMiddleware, adminMiddleware, optionalAuth };
