import { getDb } from '../db/index.js';
import { providers } from '../providers/index.js';
import { renderTemplate } from '../emails/templates.js';
import { logger } from '../utils/logger.js';
import config from '../config/index.js';

// Email must never break the business operation that triggered it, so this never throws. Every attempt
// (sent, failed, or logged-only in dev) is recorded in email_outbox so support can see the truth.
export async function sendEmail({ to, userId = null, template, data = {} }) {
  const db = getDb();
  let subject = template;
  try {
    const rendered = renderTemplate(template, data);
    subject = rendered.subject;
    const provider = providers().email;
    const result = await provider.send({ to, subject, html: rendered.html, text: rendered.text });
    await db.query(
      'INSERT INTO email_outbox (user_id,to_email,template,subject,status,provider,provider_message_id,body_html) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [userId, to, template, subject, result.status, provider.name, result.id ?? null, provider.name === 'console' && (config.isTest || config.db.driver === 'pglite') ? rendered.html : null],
    );
    return result.status;
  } catch (err) {
    logger.error('email send failed', { template, error: err.message });
    await db.query(
      'INSERT INTO email_outbox (user_id,to_email,template,subject,status,provider,error) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [userId, to, template, subject, 'failed', providers().email.name, String(err.message).slice(0, 300)],
    ).catch(() => {});
    return 'failed';
  }
}
