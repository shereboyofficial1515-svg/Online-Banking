import { z } from 'zod';
import { CATEGORIES } from '../services/notificationService.js';
import { STAFF_ROLES } from '../config/permissions.js';

const trimmed = (min, max, label = 'This field') => z.string().trim().min(min, `${label} is required.`).max(max, `${label} is too long.`);
// Names: letters, spaces, hyphens, apostrophes (unicode aware). Blocks markup and control characters.
const name = (label) => trimmed(1, 60, label).regex(/^[\p{L}][\p{L}\p{M}' .-]*$/u, `${label} contains invalid characters.`);
export const uuid = z.uuid('Invalid identifier.');
const money = z.union([z.string(), z.number()]).transform(String).pipe(z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter a valid amount with at most two decimal places.'));
const code6 = z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.');
const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address.'));
const password = z.string().min(1, 'Password is required.').max(128, 'Password is too long.');

const dob = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.').refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s && d <= new Date() && d.getUTCFullYear() > 1900;
}, 'Enter a valid date of birth.');

export const pagination = z.object({ limit: z.coerce.number().int().min(1).max(200).optional(), offset: z.coerce.number().int().min(0).optional() });

// ───────── auth ─────────
export const registerSchema = z.object({
  email,
  password,
  firstName: name('First name'),
  lastName: name('Last name'),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number.'),
  dateOfBirth: dob,
  addressLine1: trimmed(3, 120, 'Address'),
  city: trimmed(1, 80, 'City'),
  state: trimmed(1, 80, 'State'),
  postalCode: trimmed(2, 20, 'Postal code').optional(),
  country: trimmed(2, 60, 'Country'),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_.]{3,30}$/, 'Use 3-30 letters, numbers, dots or underscores.').optional(),
});
export const loginSchema = z.object({ identifier: trimmed(1, 200, 'Email or username'), password });
export const loginMfaSchema = z.object({
  mfaToken: z.string().min(10).max(2000),
  code: code6.optional(),
  recoveryCode: z.string().trim().max(20).optional(),
  trustDevice: z.boolean().optional(),
}).refine((v) => v.code || v.recoveryCode, { message: 'Enter an authenticator code or a recovery code.', path: ['code'] });
export const tokenSchema = z.object({ token: z.string().min(10).max(200) });
export const emailOnlySchema = z.object({ email });
export const resetSchema = z.object({ token: z.string().min(10).max(200), password });
export const changePasswordSchema = z.object({ currentPassword: password, newPassword: password });
export const passkeyOptionsSchema = z.object({ email: email.optional() });
export const passkeyAuthSchema = z.object({ response: z.record(z.string(), z.any()) });
export const passkeyRegisterSchema = z.object({ response: z.record(z.string(), z.any()), name: z.string().trim().max(60).optional() });
export const passkeyRenameSchema = z.object({ name: trimmed(1, 60, 'Name') });
export const mfaCodeSchema = z.object({ code: code6 });
export const mfaDisableSchema = z.object({ password, code: code6 });

// ───────── profile / accounts ─────────
export const profileSchema = z.object({
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number.').optional(),
  addressLine1: trimmed(3, 120, 'Address').optional(),
  city: trimmed(1, 80, 'City').optional(),
  state: trimmed(1, 80, 'State').optional(),
  postalCode: trimmed(2, 20, 'Postal code').optional(),
  country: trimmed(2, 60, 'Country').optional(),
});
export const openAccountSchema = z.object({ type: z.enum(['checking', 'savings']), name: z.string().trim().max(40).optional() });
export const idParam = z.object({ id: uuid });

// ───────── transactions / transfers / withdrawals ─────────
export const transactionQuery = pagination.extend({
  accountId: uuid.optional(),
  q: z.string().trim().max(60).optional(),
  type: z.enum(['ledger_credit', 'ledger_debit', 'transfer', 'withdrawal', 'reversal']).optional(),
  status: z.enum(['pending', 'completed', 'failed', 'reversed', 'blocked', 'cancelled']).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export const transferSchema = z.object({
  fromAccountId: uuid,
  toAccountNumber: z.string().trim().toUpperCase().regex(/^EWB\d{10}$/, 'Enter a valid EWB account number.'),
  amount: money,
  description: z.string().trim().max(140).optional(),
  idempotencyKey: z.string().min(8).max(80),
});
export const withdrawalSchema = z.object({
  accountId: uuid,
  amount: money,
  bankName: trimmed(2, 80, 'Bank name'),
  accountName: trimmed(2, 80, 'Account holder name'),
  last4: z.string().trim().regex(/^\d{4}$/, 'Enter the last 4 digits of the destination account.'),
  note: z.string().trim().max(300).optional(),
  idempotencyKey: z.string().min(8).max(80).optional(), // one per form submission; makes double-clicks and retries safe
});

// ───────── verification ─────────
export const documentKindSchema = z.object({ kind: z.enum(['id_front', 'id_back', 'selfie', 'proof_of_address']) });
export const verificationReviewSchema = z.object({ decision: z.enum(['verified', 'failed', 'verification_required']), reason: trimmed(5, 500, 'Reason') });

// ───────── support ─────────
export const ticketCreateSchema = z.object({
  category: z.enum(['account', 'transactions', 'withdrawals', 'verification', 'security', 'technical', 'other']),
  subject: trimmed(3, 120, 'Subject'),
  message: trimmed(10, 5000, 'Message'),
});
export const ticketReplySchema = z.object({ message: trimmed(2, 5000, 'Message') });
export const staffReplySchema = z.object({
  message: trimmed(2, 5000, 'Message'),
  internal: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).optional(),
  status: z.enum(['open', 'in_progress', 'waiting_for_customer', 'resolved', 'closed']).optional(),
});
export const ticketStatusSchema = z.object({ status: z.enum(['open', 'in_progress', 'waiting_for_customer', 'resolved', 'closed']) });
export const ticketAssignSchema = z.object({ assigneeId: uuid.nullable() });

// ───────── notifications ─────────
export const notificationQuery = pagination.extend({ unreadOnly: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), category: z.enum(CATEGORIES).optional() });
export const preferencesSchema = z.object({ preferences: z.array(z.object({ category: z.enum(CATEGORIES), inApp: z.boolean(), email: z.boolean() })).max(20) });

// ───────── admin ─────────
export const customerQuery = pagination.extend({
  q: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'suspended', 'locked', 'rejected']).optional(),
  verification: z.enum(['not_started', 'pending', 'verification_required', 'verified', 'failed', 'expired', 'manual_review']).optional(),
});
export const customerActionSchema = z.object({
  action: z.enum(['approve_account', 'reject_account', 'suspend', 'reactivate', 'lock', 'reset_sessions']),
  reason: trimmed(5, 500, 'Reason'),
});
export const ledgerAdjustSchema = z.object({
  accountId: uuid,
  direction: z.enum(['credit', 'debit']).default('credit'),
  amount: money,
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Select a currency.'),
  reason: trimmed(10, 500, 'Reason'),
  mfaCode: code6,
  idempotencyKey: z.string().min(8).max(80),
});
export const ledgerReverseSchema = z.object({ transactionId: uuid, reason: trimmed(10, 500, 'Reason'), mfaCode: code6 });
export const withdrawalActionSchema = z.object({
  action: z.enum(['start_review', 'request_verification', 'require_support', 'approve', 'reject']),
  reason: z.string().trim().max(500).optional(),
  mfaCode: code6.optional(),
});
export const noteSchema = z.object({ note: trimmed(3, 1000, 'Note') });
export const withdrawalAdminQuery = pagination.extend({
  status: z.enum(['requested', 'under_review', 'additional_verification_required', 'customer_support_required', 'approved', 'rejected', 'cancelled']).optional(),
  q: z.string().trim().max(80).optional(),
});
export const securityEventQuery = pagination.extend({
  status: z.enum(['open', 'investigating', 'resolved', 'dismissed']).optional(),
  severity: z.enum(['info', 'low', 'medium', 'high']).optional(),
  type: z.string().max(60).optional(),
  userId: uuid.optional(),
});
export const securityEventUpdateSchema = z.object({ status: z.enum(['open', 'investigating', 'resolved', 'dismissed']), note: z.string().trim().max(500).optional() });
export const auditQuery = pagination.extend({
  actorId: uuid.optional(), accountId: uuid.optional(), targetId: z.string().max(80).optional(), action: z.string().max(60).optional(),
  from: z.string().optional(), to: z.string().optional(),
});
export const staffCreateSchema = z.object({ email, firstName: name('First name'), lastName: name('Last name'), role: z.enum(STAFF_ROLES) });
export const staffUpdateSchema = z.object({ role: z.enum(STAFF_ROLES).optional(), status: z.enum(['active', 'suspended']).optional() });
export const adminTicketQuery = pagination.extend({
  status: z.enum(['open', 'in_progress', 'waiting_for_customer', 'resolved', 'closed']).optional(),
  q: z.string().trim().max(80).optional(), assignedTo: uuid.optional(),
});
export const verificationQueueQuery = pagination.extend({ status: z.enum(['pending', 'verification_required', 'verified', 'failed', 'expired', 'manual_review']).optional() });
