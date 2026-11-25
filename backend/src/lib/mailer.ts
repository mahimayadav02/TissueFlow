// Sends email through Resend if RESEND_API_KEY is set; otherwise prints it in the server console.
import { env } from '../config/env.js';

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.log(`\n--- Email (not sent: RESEND_API_KEY is not set) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---\n`);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to, subject, text }),
  });
  if (!res.ok) console.error('email send failed', res.status, await res.text());
}
