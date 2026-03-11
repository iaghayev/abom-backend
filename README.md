# ABOM Backend API

**Azərbaycan Beynəlxalq Olimpiadalar Mərkəzi — Node.js + SQLite Backend**

---

## 🚀 Quraşdırma

### Tələblər
- Node.js v18+
- npm

### Addımlar

```bash
# 1. Paketləri yükləyin
npm install

# 2. .env faylını hazırlayın
cp .env.example .env
# .env faylını redaktə edin

# 3. Serveri başladın (verilənlər bazası avtomatik yaranır)
npm start

# Və ya development modunda (auto-restart)
npm run dev
```

Server: `http://localhost:3001`

---

## ⚙️ .env Konfiqurasiyası

```env
PORT=3001
JWT_SECRET=your_very_secret_key_here
ADMIN_USERNAME=admin
ADMIN_PASSWORD=abom2025
TELEGRAM_BOT_TOKEN=7791652771:AAFW02XOMF9EOZ26sTtLQO_LXBlosyWBWQM
TELEGRAM_CHAT_ID=974088826
FRONTEND_URL=http://localhost:3000
DB_PATH=./database/abom.db
```

---

## 📡 API Endpoints

### 🔐 Auth
| Method | Endpoint | Açıqlama |
|--------|----------|----------|
| POST | `/api/auth/register` | Qeydiyyat |
| POST | `/api/auth/login` | Giriş |
| POST | `/api/auth/admin-login` | Admin girişi |
| GET | `/api/auth/me` | Cari istifadəçi |
| PUT | `/api/auth/profile` | Profil yenilə |
| PUT | `/api/auth/change-password` | Şifrə dəyiş |

### 📝 İmtahanlar
| Method | Endpoint | Açıqlama |
|--------|----------|----------|
| GET | `/api/exams` | Hamısı (filter: category, subject, class, search) |
| GET | `/api/exams/:id` | Tək imtahan |
| GET | `/api/exams/:id/questions` | Suallar (aktiv bilet lazım) |
| POST | `/api/exams` | Yarat (admin) |
| PUT | `/api/exams/:id` | Yenilə (admin) |
| DELETE | `/api/exams/:id` | Sil (admin) |

### ❓ Suallar
| Method | Endpoint | Açıqlama |
|--------|----------|----------|
| GET | `/api/questions?exam_id=` | Suallar (admin) |
| POST | `/api/questions` | Tək sual əlavə et |
| POST | `/api/questions/bulk` | CSV toplu yüklə |
| PUT | `/api/questions/:id` | Yenilə |
| DELETE | `/api/questions/:id` | Sil |
| DELETE | `/api/questions/exam/:exam_id` | İmtahanın hamısını sil |

### 🎬 Videolar
| Method | Endpoint | Açıqlama |
|--------|----------|----------|
| GET | `/api/videos` | Hamısı (filter: subject, class, type) |
| GET | `/api/videos/:id` | Tək video |
| POST | `/api/videos` | Əlavə et (admin) |
| PUT | `/api/videos/:id` | Yenilə (admin) |
| DELETE | `/api/videos/:id` | Sil (admin) |

### 🎫 Qeydiyyatlar (Bilet)
| Method | Endpoint | Açıqlama |
|--------|----------|----------|
| GET | `/api/registrations` | Öz biletləri (admin: hamısı) |
| GET | `/api/registrations/check/:exam_id` | Bilet var? |
| GET | `/api/registrations/pending-count` | Gözləyən sayı (admin) |
| POST | `/api/registrations` | Bilet al (Telegram bildirim) |
| PUT | `/api/registrations/:id/activate` | Aktivləşdir (admin) |
| PUT | `/api/registrations/:id/status` | Status dəyiş (admin) |
| DELETE | `/api/registrations/:id` | Sil (admin) |

### 📊 Nəticələr
| Method | Endpoint | Açıqlama |
|--------|----------|----------|
| POST | `/api/results/submit` | İmtahanı göndər |
| GET | `/api/results` | Öz nəticələri |
| GET | `/api/results/leaderboard` | Reytinq |
| GET | `/api/results/my/stats` | Öz statistikası |
| GET | `/api/results/:id` | Nəticə detalı |
| GET | `/api/results/export/csv` | CSV yüklə (admin) |
| DELETE | `/api/results/:id` | Sil (admin) |

### 🏅 Sertifikatlar
| Method | Endpoint | Açıqlama |
|--------|----------|----------|
| GET | `/api/certs/config` | Bütün konfiqler |
| GET | `/api/certs/config/:exam_id` | İmtahan konfiqü |
| PUT | `/api/certs/config/:exam_id` | Konfiqü yenilə (admin) |
| GET | `/api/certs/check/:result_id` | Sertifikat var? |

### ⚙️ Admin
| Method | Endpoint | Açıqlama |
|--------|----------|----------|
| GET | `/api/admin/stats` | Dashboard statistikaları |
| GET | `/api/admin/users` | İstifadəçilər |
| DELETE | `/api/admin/users/:id` | İstifadəçi sil |
| GET | `/api/admin/activity` | Son aktivliklər |
| POST | `/api/admin/telegram/test` | Telegram test |

---

## 📦 CSV Format (Toplu Sual)

```
sual mətni,A variantı,B variantı,C variantı,D variantı,düzgün cavab
2+2=?,3,4,5,6,B
Bakı nədir?,Şəhər,Ölkə,Çay,Dağ,A
```

---

## 🗄️ Verilənlər Bazası Sxemi

```
users          — İstifadəçilər
exams          — İmtahanlar
questions      — Suallar (imtahana bağlı)
videos         — Video dərslər
registrations  — Bilet satışları
results        — İmtahan nəticələri
cert_configs   — Sertifikat konfiqurasiyaları
sessions       — Oturumlar
```

---

## 🔑 Demo Hesablar

| Tip | Telefon | Şifrə |
|-----|---------|-------|
| Demo Şagird | 0551234567 | demo123 |
| Admin | admin | abom2025 |

---

## 🌐 Frontend ilə İnteqrasiya

Frontend faylınızı (`abom-v3-full.html`) `public/` qovluğuna qoyun:

```
abom-backend/
  public/
    index.html    ← abom-v3-full.html-i bura köçürün
  server.js
  ...
```

Frontend-dən API çağırışı nümunəsi:

```javascript
const API = 'http://localhost:3001/api';

// Giriş
const res = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ phone: '0551234567', password: 'demo123' })
});
const { token, user } = await res.json();

// Token-lə qorunan sorğu
const exams = await fetch(`${API}/exams`, {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

---

## 📱 Telegram Bildirimlər

Bot avtomatik olaraq aşağıdakı hadisələrdə mesaj göndərir:
- 🎓 Yeni bilet satışı
- ✅ Bilet aktivləşdirilməsi
- 📊 Yeni imtahan nəticəsi

---

## 🚀 Production-a Deploy

```bash
# Render.com, Railway.app, VPS üçün
NODE_ENV=production npm start

# PM2 ilə
npm install -g pm2
pm2 start server.js --name abom-api
pm2 save
pm2 startup
```
