// EmailProvider contract:  send({ to, subject, html, text }) -> { id, status: 'sent' | 'logged_only' }
// ResendEmailProvider talks to the Resend REST API. ConsoleEmailProvider is used only when no API key
// is configured (local dev / tests): it records the message as "logged_only" so nothing is ever
// reported as delivered when it was not.
import config from '../config/index.js';
import { logger } from '../utils/logger.js';

export class ResendEmailProvider {
  name = 'resend';
  async send({ to, subject, html, text }) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.email.resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: config.email.from, to: [to], subject, html, text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Resend responded ${res.status}: ${detail.slice(0, 200)}`);
    }
    const body = await res.json();
    return { id: body.id, status: 'sent' };
  }
}

export class ConsoleEmailProvider {
  name = 'console';
  async send({ to, subject, text }) {
    logger.info('email (console provider, not delivered)', { to, subject });
    if (!config.isTest && !config.isProd) console.log(`\n--- EMAIL to ${to}: ${subject}\n${text}\n---\n`);
    return { id: null, status: 'logged_only' };
  }
}

export const createEmailProvider = () => (config.email.provider === 'resend' ? new ResendEmailProvider() : new ConsoleEmailProvider());
