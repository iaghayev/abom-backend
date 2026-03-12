const express = require('express');
const router  = express.Router();
const db      = require('../database');

// POST /api/telegram/webhook — Telegram bot callback handler
// Set webhook once:
//   curl "https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://abom-backend-production.up.railway.app/api/telegram/webhook"

async function tgApi(method, body) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function normalizeWaPhone(phone) {
  let p = (phone || '').replace(/\D/g, '');
  if (p.startsWith('0')) p = '994' + p.slice(1);
  if (!p.startsWith('994') && p.length === 9) p = '994' + p;
  return p;
}
async function sendWhatsApp(toPhone, message) {
  const token    = process.env.ULTRAMSG_TOKEN;
  const instance = process.env.ULTRAMSG_INSTANCE;
  if (!token || !instance) return;
  const to = normalizeWaPhone(toPhone);
  if (!to) return;
  try {
    await fetch(`https://api.ultramsg.com/${instance}/messages/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, to, body: message, priority: 10 })
    });
  } catch(e) { console.error('WhatsApp error:', e.message); }
}

router.post('/webhook', async (req, res) => {
  res.sendStatus(200); // always ack quickly

  const update = req.body;
  const cbq = update?.callback_query;
  if (!cbq) return;

  const callbackId = cbq.id;
  const data       = cbq.data || '';
  const msgId      = cbq.message?.message_id;
  const chatId     = cbq.message?.chat?.id;

  // ── activate:REG_ID ──────────────────────────────────────
  if (data.startsWith('activate:')) {
    const regId = data.slice('activate:'.length);
    const reg   = db.prepare('SELECT * FROM registrations WHERE id=?').get(regId);

    if (!reg) {
      await tgApi('answerCallbackQuery', { callback_query_id: callbackId, text: '⚠️ Qeydiyyat tapılmadı!', show_alert: true });
      return;
    }
    if (reg.status === 'active') {
      await tgApi('answerCallbackQuery', { callback_query_id: callbackId, text: '✅ Artıq aktivdir.', show_alert: false });
      return;
    }

    // Activate
    const now = new Date().toISOString();
    db.prepare("UPDATE registrations SET status='active', activated_at=? WHERE id=?").run(now, regId);

    const exam = db.prepare('SELECT * FROM exams WHERE id=?').get(reg.exam_id);
    try {
      db.prepare(`INSERT OR IGNORE INTO revenues
        (id,registration_id,exam_id,user_id,student_name,exam_title,amount,status,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`)
        .run('rev_'+Date.now(), reg.id, reg.exam_id, reg.user_id,
             reg.name, exam?.title||'', exam?.price||0, 'confirmed', now);
    } catch(e) {}

    // WhatsApp to student
    const user = db.prepare('SELECT username, plain_password FROM users WHERE id=?').get(reg.user_id);
    if (user) {
      const link = process.env.PLATFORM_URL || 'https://abom.edusoft.az';
      const pass = user.plain_password || '—';
      const waPhone = reg.whatsapp || reg.phone;

      let dateLine = '';
      if (exam?.start_date || exam?.end_date) {
        const fmt = d => { try { return new Date(d).toLocaleDateString('az-AZ',{day:'2-digit',month:'short',timeZone:'Asia/Baku'}); } catch{ return d; } };
        const s = exam.start_date ? fmt(exam.start_date) : '';
        const e = exam.end_date   ? fmt(exam.end_date)   : '';
        if (s && e) dateLine = `\n📅 İmtahan ${s} - ${e} tarixləri arasında aktiv olacaq. Bu müddət ərzində istədiyiniz vaxt imtahana başlaya bilərsiniz. ⏰`;
        else if (s) dateLine = `\n📅 İmtahan ${s} tarixindən aktivdir. ⏰`;
      }

      await sendWhatsApp(waPhone,
`Ödənişiniz təsdiqləndi və övladınız üçün imtahan aktivləşdirildi. ✅

${reg.name} siz ${exam?.title || '—'} imtahanından uğurla qeydiyyatınız tamamlandı. 

👉 İstifadəçi adı: ${user.username}
👉 Şifrə: ${pass}

İmtahana giriş linki: ${link}/login?u=${encodeURIComponent(user.username)}&p=${encodeURIComponent(pass)}

📘 İmtahana başlamaq üçün:
1. Linkə daxil olun
2. Şagird hesabına daxil olun
3. "Aktiv İmtahanlar" düyməsinə klikləyin
4. İmtahanı seçib başlayın
${dateLine}
Uğurlar! 🍀`);
    }

    // Answer callback + edit original TG message
    await tgApi('answerCallbackQuery', { callback_query_id: callbackId, text: '✅ Aktivləşdirildi! WhatsApp mesajı göndərildi.' });
    await tgApi('editMessageText', {
      chat_id: chatId,
      message_id: msgId,
      text: `✅ *AKTİVLƏŞDİRİLDİ*\n\n👤 ${reg.name}\n📚 ${exam?.title||'—'}\n🕐 ${new Date().toLocaleString('az-AZ',{timeZone:'Asia/Baku'})}`,
      parse_mode: 'Markdown'
    });
  }
});

module.exports = router;
