require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

const limiter = rateLimit({ windowMs: 15*60*1000, max: 1000,
  message: { success:false, message:'Çox sayda sorğu. Bir az gözləyin.' } });
const authLimiter = rateLimit({ windowMs: 60*1000, max: 30,
  message: { success:false, message:'Çox sayda giriş cəhdi. Bir dəqiqə gözləyin.' } });

app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/exams',         require('./routes/exams'));
app.use('/api/questions',     require('./routes/questions'));
app.use('/api/videos',        require('./routes/videos'));
app.use('/api/registrations', require('./routes/registrations'));
app.use('/api/results',       require('./routes/results'));
app.use('/api/certs',         require('./routes/certs'));
app.use('/api/admin',         require('./routes/admin'));
app.use('/api/parents',       require('./routes/parents'));
app.use('/api/categories',    require('./routes/categories'));
app.use('/api/revenues',      require('./routes/revenues'));
app.use('/api/telegram',      require('./routes/telegram'));
app.use('/api/contact',       require('./routes/contact'));

app.get('/api/health', (_req, res) => {
  res.json({ success:true, service:'ABOM API', version:'2.0.0', time: new Date().toISOString() });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_req, res) => {
  const fs = require('fs');
  const p = path.join(__dirname, 'public', 'index.html');
  fs.existsSync(p) ? res.sendFile(p) : res.json({ success:true, message:'ABOM API v2.0' });
});

app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(err.status||500).json({ success:false, message: err.message });
});

app.listen(PORT, () => {
  console.log(`\n✅ ABOM v2.0 — http://localhost:${PORT}\n`);
});

module.exports = app;
