import 'dotenv/config';
import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { OpenAI } from 'openai';
import fetch from 'node-fetch';
import twilio from 'twilio';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? '*' }));
app.use(bodyParser.json({ limit: '2mb' }));
app.use(express.static('public'));

// -------- OpenAI Client --------
if (!process.env.OPENAI_API_KEY) {
  console.warn('⚠️  Falta OPENAI_API_KEY en .env. El endpoint /api/chat fallará hasta que la configures.');
}
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -------- Util: enviar lead a tu email (Webhook gratis con formsubmit.co) --------
async function enviarLeadEmail(lead) {
  if (!process.env.ADMIN_EMAIL) return;
  try {
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(process.env.ADMIN_EMAIL)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(lead)
      }
    );
    return await res.json();
  } catch (e) { console.error('Error enviando lead:', e); }
}

// -------- API Chat para tu widget (demo) --------
app.post('/api/chat', async (req, res) => {
  try {
    const { messages, business } = req.body;

    const system = `Eres un asistente de ventas para la empresa ${business?.name ?? 'Mi Negocio'}.
Respondes claro y breve, captas datos (nombre, teléfono, email) y ofreces agendar una llamada.
Si la pregunta no es del negocio, pides reformular.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: system },
        ...(messages ?? []),
      ],
      temperature: 0.6,
      max_tokens: 300
    });

    const reply = completion.choices?.[0]?.message?.content ?? '…';
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Fallo en el chat' });
  }
});

// -------- Captura de leads desde formulario de la landing --------
app.post('/api/lead', async (req, res) => {
  const lead = req.body; // { nombre, email, telefono, mensaje }
  await enviarLeadEmail({ ...lead, origen: 'Landing' });
  res.json({ ok: true });
});

// -------- Webhook WhatsApp (Twilio) --------
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  app.post('/webhooks/whatsapp', express.urlencoded({ extended: false }), async (req, res) => {
    const msg = req.body.Body?.trim() || '';
    const from = req.body.From;

    const intro = 'Soy tu asistente virtual. Puedo ayudarte 24/7. ¿Cómo te llamas?';
    const messages = [
      { role: 'system', content: 'Eres un agente de WhatsApp amable. Pide nombre y teléfono si falta, y ofrece agendar.' },
      { role: 'user', content: msg }
    ];

    try {
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.6,
        max_tokens: 250
      });
      const reply = completion.choices?.[0]?.message?.content || intro;

      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
<Message>${reply}</Message>
</Response>`;
      res.set('Content-Type', 'text/xml');
      return res.send(twiml);
    } catch (e) {
      console.error(e);
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
<Message>Ahora mismo no puedo responder, lo siento.</Message>
</Response>`;
      res.set('Content-Type', 'text/xml');
      return res.send(twiml);
    }
  });
}

// -------- Arranque --------
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ API lista en http://localhost:${port}`));
