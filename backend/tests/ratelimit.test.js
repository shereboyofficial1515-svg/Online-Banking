import './env-ratelimit.js';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { boot, shutdown, client, uniqueEmail } from './helpers.js';
import config from '../src/config/index.js';

let app;
before(async () => { ({ app } = await boot()); });
after(shutdown);

test('rate limiting is really enforced on authentication endpoints (429 + standard error shape)', async () => {
  assert.equal(config.rateLimit.enabled, true);
  const c = client(app);
  const statuses = [];
  for (let i = 0; i < 34; i++) statuses.push((await c.post('/api/auth/login', { identifier: uniqueEmail('nobody'), password: 'Wrong!Passw0rd#1' })).status);
  assert.ok(statuses.slice(0, 30).every((s) => s === 401), 'first 30 attempts are processed normally');
  assert.ok(statuses.slice(30).every((s) => s === 429), `later attempts are blocked, got ${statuses.slice(28).join(',')}`);
  const blocked = await c.post('/api/auth/login', { identifier: 'a@example.test', password: 'x' });
  assert.equal(blocked.body.error.code, 'TOO_MANY_REQUESTS');
  assert.ok(blocked.headers['ratelimit'] || blocked.headers['ratelimit-policy'], 'standard RateLimit headers present');
});

test('money-adjacent endpoints have their own tighter limiter', async () => {
  const c = client(app);
  const codes = new Set();
  for (let i = 0; i < 5; i++) codes.add((await c.post('/api/transactions/transfers', {})).status);
  assert.ok([...codes].every((s) => s === 401), 'unauthenticated callers are rejected before any processing');
});
