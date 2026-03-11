const fetch = require('node-fetch');

const BASE_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}`;

async function sendMessage(text, chatId = process.env.TELEGRAM_CHAT_ID) {
  try {
    const res = await fetch(`${BASE_URL}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' })
    });
    const data = await res.json();
    return data.ok;
  } catch (err) {
    console.error('Telegram error:', err.message);
    return false;
  }
}

async function notifyNewRegistration(reg, exam) {
  const msg = `🎓 <b>Yeni Bilet Satışı!</b>

👤 <b>Ad:</b> ${reg.name}
📞 <b>Telefon:</b> ${reg.phone}
💬 <b>WhatsApp:</b> ${reg.whatsapp}
📚 <b>İmtahan:</b> ${exam.title}
🏫 <b>Sinif:</b> ${reg.class}-ci sinif
📂 <b>Bölmə:</b> ${reg.section}
💰 <b>Qiymət:</b> ${exam.price} AZN
📅 <b>Tarix:</b> ${new Date().toLocaleDateString('az-AZ')}

⚙️ Admin paneldən aktivləşdirin.
🔗 Bilet ID: <code>${reg.id}</code>`;
  return sendMessage(msg);
}

async function notifyActivation(reg, exam) {
  const msg = `✅ <b>İmtahan Aktivləşdirildi</b>

👤 ${reg.name}
📚 ${exam.title}
💬 WhatsApp: ${reg.whatsapp}`;
  return sendMessage(msg);
}

async function notifyNewResult(result, user, exam) {
  const msg = `📊 <b>Yeni İmtahan Nəticəsi</b>

👤 ${user.name}
📚 ${exam.title}
🎯 Bal: <b>${result.score}%</b> (${result.correct}/${result.total} düzgün)
📅 ${new Date().toLocaleDateString('az-AZ')}`;
  return sendMessage(msg);
}

module.exports = { sendMessage, notifyNewRegistration, notifyActivation, notifyNewResult };
