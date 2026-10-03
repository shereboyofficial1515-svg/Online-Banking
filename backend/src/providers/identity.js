// IdentityVerificationProvider contract
//   name
//   createSession({ user }) -> { providerSessionId|null, status, redirectUrl|null, requiresDocuments }
//   parseWebhook(rawBody: Buffer, headers) -> { providerSessionId, status, reason }   (must verify the signature)
//
// ManualReviewProvider is the default: the customer uploads ID + selfie to private storage and a
// compliance administrator decides. SignedWebhookProvider is the reference shape for connecting a
// licensed KYC vendor: the vendor hosts capture, then calls our webhook, which we authenticate with
// an HMAC signature before changing any state. We store only status + provider reference, never
// raw biometric templates.
import config from '../config/index.js';
import { hmacSha256Hex, randomToken, safeEqual } from '../utils/crypto.js';
import { badRequest, unauthorized, AppError } from '../utils/errors.js';

export const VERIFICATION_STATUSES = ['not_started', 'pending', 'verification_required', 'verified', 'failed', 'expired', 'manual_review'];

export class ManualReviewProvider {
  name = 'manual';
  async createSession() {
    return { providerSessionId: null, status: 'verification_required', redirectUrl: null, requiresDocuments: true };
  }
  parseWebhook() {
    throw badRequest('This provider does not use webhooks.');
  }
}

export class SignedWebhookProvider {
  name = 'signed_webhook';
  async createSession() {
    // A real vendor integration would call the vendor API here and return its hosted-flow URL.
    return { providerSessionId: `idv_${randomToken(12)}`, status: 'pending', redirectUrl: null, requiresDocuments: false };
  }
  parseWebhook(rawBody, headers) {
    const secret = config.identity.webhookSecret;
    if (!secret) throw new AppError(503, 'WEBHOOK_NOT_CONFIGURED', 'Identity webhooks are not configured.');
    const sig = String(headers['x-ewb-signature'] || '').replace(/^sha256=/, '');
    const ts = Number(headers['x-ewb-timestamp']);
    if (!sig || !Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) throw unauthorized('Invalid webhook signature.', 'INVALID_SIGNATURE');
    const expected = hmacSha256Hex(secret, `${ts}.${rawBody.toString('utf8')}`);
    if (!safeEqual(sig, expected)) throw unauthorized('Invalid webhook signature.', 'INVALID_SIGNATURE');
    let body;
    try { body = JSON.parse(rawBody.toString('utf8')); } catch { throw badRequest('Malformed webhook body.'); }
    if (!body.sessionId || !VERIFICATION_STATUSES.includes(body.status)) throw badRequest('Malformed webhook body.');
    return { providerSessionId: String(body.sessionId), status: body.status, reason: body.reason ? String(body.reason).slice(0, 500) : null };
  }
}

export const createIdentityProvider = () => (config.identity.provider === 'webhook' ? new SignedWebhookProvider() : new ManualReviewProvider());
