import config from '../config/index.js';
import { createEmailProvider } from './email.js';
import { createStorageProvider } from './storage.js';
import { createIdentityProvider, SignedWebhookProvider } from './identity.js';
import { NullPaymentProvider, NullBankingProvider, NullSmsProvider, NullFraudProvider } from './regulated.js';

let registry = null;

export function buildProviders(overrides = {}) {
  const providers = {
    email: createEmailProvider(),
    storage: createStorageProvider(),
    identity: createIdentityProvider(),
    identityWebhook: new SignedWebhookProvider(), // webhook signature verification is independent of how sessions are created
    payment: new NullPaymentProvider(),
    banking: new NullBankingProvider(),
    sms: new NullSmsProvider(),
    fraud: new NullFraudProvider(),
    ...overrides,
  };
  // Hard guard: "live" ledger mode is meaningless without real, reconciled rails.
  if (config.ledger.mode === 'live' && !(providers.payment.enabled && providers.banking.enabled)) {
    throw new Error('LEDGER_MODE=live requires enabled PaymentProvider and BankingProvider implementations. Refusing to start.');
  }
  return providers;
}

export function initProviders(overrides) {
  registry = buildProviders(overrides);
  return registry;
}
export function providers() {
  if (!registry) throw new Error('Providers not initialised');
  return registry;
}
