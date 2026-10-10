// Provider abstractions for FUTURE regulated integrations. Nothing here moves real money.
//
// PaymentProvider    : collect / pay out through a licensed processor
// BankingProvider    : initiate bank-rail transfers (ACH / wire / faster payments) via a banking partner
// SmsProvider        : phone verification and security alerts
// FraudProvider      : third-party risk scoring
//
// The only implementations shipped are "not configured" ones that fail loudly, so no code path can
// silently pretend that a real transfer happened. Wiring a real provider requires legal, licensing,
// KYC/AML and banking-partner sign-off first (see docs/COMPLIANCE.md), plus a reconciliation job
// that compares provider settlement reports with ledger entries.
import { AppError } from '../utils/errors.js';

const notConfigured = (what) =>
  new AppError(501, 'PROVIDER_NOT_CONFIGURED', `${what} is not available yet.`);

export class NullPaymentProvider {
  name = 'none';
  enabled = false;
  async createPayout() { throw notConfigured('Payment processing'); }
  async createCharge() { throw notConfigured('Payment processing'); }
}
export class NullBankingProvider {
  name = 'none';
  enabled = false;
  async initiateExternalTransfer() { throw notConfigured('External bank transfers'); }
  async getTransferStatus() { throw notConfigured('External bank transfers'); }
}
export class NullSmsProvider {
  name = 'none';
  enabled = false;
  async send() { return { status: 'not_sent' }; }
}
export class NullFraudProvider {
  name = 'internal-rules';
  // Internal rules live in securityService; this hook is where a vendor score would be merged in.
  async assess() { return { score: null, source: 'internal-rules' }; }
}
