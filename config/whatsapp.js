const db = require('../database');

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
    const res = await fetch(`https://api.ultramsg.com/${instance}/messages/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, to, body: message, priority: 10 })
    });
    const data = await res.json();
    if (!res.ok) console.error('UltraMsg error:', JSON.stringify(data));
  } catch(e) { console.error('WhatsApp send error:', e.message); }
}

// Fill {{placeholders}} from a vars object
async function fillTemplate(key, vars) {
  const row = await db.get('SELECT template FROM wa_templates WHERE key=?', [key]);
  if (!row) return null;
  return row.template.replace(/\{\{(\w+)\}\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));
}

async function sendTemplate(toPhone, key, vars) {
  const msg = await fillTemplate(key, vars);
  if (!msg) return;
  await sendWhatsApp(toPhone, msg);
}

module.exports = { sendWhatsApp, sendTemplate, fillTemplate, normalizeWaPhone };
