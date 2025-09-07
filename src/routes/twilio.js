import { Router } from 'express';
import axios from 'axios';
import pkg from 'twilio';
const { twiml: Twiml } = pkg;
import { verifyTwilio } from '../middleware/verifyTwilio.js';
import { ocrReceiptAmount } from '../lib/ocr.js';
import { expectedAmountForLead } from '../services/payments.js';

const r = Router();

r.post('/twilio/outbound', (_req, res) => {
  const t = new Twiml.VoiceResponse();
  t.say('Hello from Geniumed.');
  res.type('text/xml').send(t.toString());
});

r.post('/twilio/whatsapp/webhook', verifyTwilio, async (req, res) => {
  const mediaUrl = req.body.MediaUrl0;
  const message = (req.body.Body || '').trim();
  const tw = new Twiml.MessagingResponse();

  if (mediaUrl) {
    const img = await axios.get(mediaUrl, { responseType: 'arraybuffer', auth:{ username: process.env.TWILIO_ACCOUNT_SID, password: process.env.TWILIO_AUTH_TOKEN } });
    const amount = await ocrReceiptAmount(new Uint8Array(img.data));
    if (!amount) tw.message('Não consegui ler o valor no comprovante. Pode enviar uma foto mais nítida?');
    else {
      const expected = await expectedAmountForLead('lead-id'); // TODO map WA -> lead
      if (Math.abs(amount - expected) > 1) tw.message(`Recebi R$ ${amount.toFixed(2)} mas o valor esperado é R$ ${expected.toFixed(2)}. Pode verificar?`);
      else tw.message('Pagamento confirmado ✅ Vamos agendar sua consulta. Prefere amanhã às 14h ou 16h?');
    }
    return res.type('text/xml').send(tw.toString());
  }

  if (/\b(call|ligar|telefone)\b/i.test(message))
    tw.message('Certo! Vou ligar para você. Se preferir um horário específico, diga: "ligar às 16:00".');
  else if (/\bwhats(app)?\b|aqui mesmo|mensagem/i.test(message))
    tw.message('Perfeito, podemos continuar por aqui no WhatsApp. Como posso ajudar com sua consulta?');
  else
    tw.message('Recebi sua mensagem. Se preferir ligação, diga "ligar". Se preferir continuar por aqui, diga "WhatsApp".');

  res.type('text/xml').send(tw.toString());
});

export default r;
