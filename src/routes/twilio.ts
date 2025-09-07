import { Router } from 'express';
import axios from 'axios';
import { twiml as Twiml } from 'twilio';
import { verifyTwilio } from '../middleware/verifyTwilio.js';
import { env } from '../config/env.js';
import { ocrReceiptAmount } from '../lib/ocr.js';
import { expectedAmountForLead } from '../services/payments.js';
import { supa } from '../lib/supabase.js';
import { dialOutbound } from '../services/dialer.js';
import { pickDoctorForLead } from '../services/doctors.js';

const r = Router();

r.post('/twilio/outbound', (req, res) => {
  const lead = String(req.query.lead || '');
  const agent = String(req.query.agent || process.env.RETELL_AGENT_OUT || '');
  const rtwiml = new Twiml.VoiceResponse();
  const sipUri = `sip:outbound@${env.RETELL_SIP_DOMAIN};transport=tls?header_X-Geniumed-Agent=${encodeURIComponent(agent)}&header_X-Lead=${encodeURIComponent(lead)}`;
  rtwiml.dial({ answerOnBridge: true, timeout: 45 }).sip(sipUri);
  res.type('text/xml').send(rtwiml.toString());
});

r.post('/twilio/whatsapp/webhook', verifyTwilio, async (req, res) => {
  const from = req.body.From;
  const mediaUrl = req.body.MediaUrl0;
  const message = (req.body.Body || '').trim();
  const tw = new Twiml.MessagingResponse();

  if (mediaUrl) {
    const img = await axios.get(mediaUrl, { responseType: 'arraybuffer', auth:{ username: process.env.TWILIO_ACCOUNT_SID as string, password: process.env.TWILIO_AUTH_TOKEN as string } });
    const amount = await ocrReceiptAmount(new Uint8Array(img.data));
    if (!amount) tw.message('Não consegui ler o valor no comprovante. Pode enviar uma foto mais nítida?');
    else {
      const expected = await expectedAmountForLead('lead-id'); // TODO map by WA number
      if (Math.abs(amount - expected) > 1) tw.message(`Recebi R$ ${amount.toFixed(2)} mas o valor esperado é R$ ${expected.toFixed(2)}. Pode verificar?`);
      else tw.message('Pagamento confirmado ✅ Vamos agendar sua consulta. Prefere amanhã às 14h ou 16h?');
    }
    return res.type('text/xml').send(tw.toString());
  }

  if (/(call|ligar|telefone)/i.test(message)) {
    tw.message('Certo! Vou ligar para você. Se preferir um horário específico, diga: "ligar às 16:00".');
  } else if (/whats(app)?|aqui mesmo|mensagem/i.test(message)) {
    tw.message('Perfeito, podemos continuar por aqui no WhatsApp. Como posso ajudar com sua consulta?');
  } else {
    tw.message('Recebi sua mensagem. Se preferir ligação, diga "ligar". Se preferir continuar por aqui, diga "WhatsApp".');
  }
  res.type('text/xml').send(tw.toString());
});

export default r;