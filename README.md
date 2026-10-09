# CarerTexts

Texts carers a geofenced check-in link, a check-out link and progress note reminders.

- `api/` and `lib/` deploy to Vercel (check-in/out page in `lib/page.js`, distance check, writes to Bubble)
- `worker/` runs on Railway (`npm start`), checks every minute, sends texts via Twilio (+61483931556)
- `sql/carer_text_log.sql` runs once in Supabase (send log, prevents duplicate texts)
- `npm run probe` confirms Bubble Data API field keys, `npm test` runs the tests

## Texts

| Kind | When | Skipped if |
| --- | --- | --- |
| checkin | 15 min before start | `attend start` set |
| checkout | at shift end | `attend end` set |
| notes_1 | 10pm on the shift day | `progress note` set, or before shift end |
| notes_2 | 10am next day | `progress note` set |
| notes_3 | 8pm next day | `progress note` set |

Check-in and check-out only work within `RADIUS_M` (500) metres of the shift address.
Check-in sets `attend start`. Check-out sets `attend end` and `attended` = yes.

## Environment

See `.env.example`. `SMS_MODE=dry` (default) logs texts instead of sending. Set `SMS_MODE=live` to send.

## Early check-out

A carer texts the Klarra number (for example "i need to check out early"). Klarra (`Call-Klarra`, `agent/sms_webhook.py`)
asks `POST /api/early-checkout` (Vercel, secret `KLARRA_SHARED_SECRET`) for a check-out link for the shift that carer is on, and texts it back.

## Tracks

Only a shift with a participant (NDIS) gets texts: check in, check out and progress note reminders.
A shift with no participant (aged care) gets no texts. Those carers use the check in button in Bubble (`/api/link`).
