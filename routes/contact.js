const express = require('express');
const router  = express.Router();
const { sendWhatsApp } = require('../config/whatsapp');

// POST /api/contact/wa — send greeting from our number to visitor
router.post('/wa', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, message: 'Nömrə daxil edin.' });
  const msg =
`Salam! 👋

ABOM - Azərbaycan Beynəlxalq Olimpiadalar Mərkəzinə xoş gəlmisiniz!

Sizə necə kömək edə bilərik? 😊

📞 +994 70 888 08 06
🌐 https://abom.up.railway.app`;
  try {
    await sendWhatsApp(phone, msg);
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ success: false, message: 'Mesaj göndərilmədi.' });
  }
});

module.exports = router;
