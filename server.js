require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── SECURITY MIDDLEWARE ──────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://img.youtube.com", "https://*.ytimg.com"],
      frameSrc: ["'self'", "https://www.youtube.com"],
      connectSrc: ["'self'", "https://api.telegram.org"],
    },
  },
}));
app.use(cors({
  origin: process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',') : '*',
  credentials: true
}));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  message: { success: false, message: 'Çox sayda sorğu. 15 dəqiqə sonra yenidən cəhd edin.' }
});
const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 10,
  message: { success: false, message: 'Çox sayda giriş cəhdi. Bir dəqiqə gözləyin.' }
});
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// ─── REQUEST LOGGER ───────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`${new Date().toLocaleTimeString()} ${req.method} ${req.path}`);
    next();
  });
}

// ─── ROUTES ───────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/exams',         require('./routes/exams'));
app.use('/api/questions',     require('./routes/questions'));
app.use('/api/videos',        require('./routes/videos'));
app.use('/api/registrations', require('./routes/registrations'));
app.use('/api/results',       require('./routes/results'));
app.use('/api/certs',         require('./routes/certs'));
app.use('/api/admin',         require('./routes/admin'));

// ─── HEALTH CHECK ─────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({
    success: true,
    service: 'ABOM API',
    version: '1.0.0',
    time: new Date().toISOString(),
    env: process.env.NODE_ENV
  });
});

// ─── SERVE FRONTEND (optional) ────────────────────────────────
// If you put your HTML file in /public folder, it will be served here
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  const fs = require('fs');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.json({ success: true, message: 'ABOM API is running.' });
  }
});

// ─── ERROR HANDLER ────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Server error:', err.message);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Serverdə xəta baş verdi.' : err.message
  });
});

// ─── START SERVER ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║        ABOM Backend Server           ║');
  console.log('╚══════════════════════════════════════╝');
  console.log(`\n✅ Server işləyir: http://localhost:${PORT}`);
  console.log(`📡 API: http://localhost:${PORT}/api`);
  console.log(`🔧 Env: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📁 DB: ${process.env.DB_PATH || './database/abom.db'}`);
  console.log('\nEndpoints:');
  console.log('  POST /api/auth/register');
  console.log('  POST /api/auth/login');
  console.log('  POST /api/auth/admin-login');
  console.log('  GET  /api/exams');
  console.log('  GET  /api/videos');
  console.log('  POST /api/registrations');
  console.log('  POST /api/results/submit');
  console.log('  GET  /api/results/leaderboard');
  console.log('  GET  /api/admin/stats');
  console.log('');
});

module.exports = app;
