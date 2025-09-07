# Geniumed MVP Backend (Node + TypeScript)

Features:
- Retell outbound calls with dynamic variables (name, city, specialty, reason, phone_last4, doctor_*)
- Retry engine (up to 3 attempts) with WhatsApp fallback & preference capture
- Twilio WhatsApp webhook (receipts OCR stub + preference intents)
- Stripe Checkout payment links + webhook
- Google Calendar booking helper
- Supabase integration (server key) + SQL schema

## Run
```bash
cp .env.example .env   # fill values
npm i
npm run dev
```

Nginx should proxy these:
- `/health`, `/lead/submit`, `/retell/*`, `/twilio/*`, `/fn/*`, `/webhook/stripe`

## Key endpoints
- `POST /lead/submit` — create lead and immediately place outbound attempt #1
- `POST /retell/webhook` — call_started / call_ended / call_analyzed (retry + WA fallback)
- `POST /twilio/whatsapp/webhook` — WhatsApp inbounds (receipt + preference)
- `POST /fn/create-payment-link` — Stripe Checkout Session (returns `url`)
- `POST /fn/send-payment-link` — send URL via Twilio (SMS/WA)
- `POST /fn/check-identity`, `/fn/recommend_doctor`, `/fn/set-communication-preference`, `/fn/schedule-call`
- `GET /pay/success`, `GET /pay/cancel` — simple landing JSON
```