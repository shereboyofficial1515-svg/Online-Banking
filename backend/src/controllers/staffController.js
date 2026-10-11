// HTTP adapters for staff/admin APIs. Routes already enforce authentication + staff status + a base permission;
// handlers add the action-specific permission and, for money-affecting actions, an MFA step-up.
import { getDb } from '../db/index.js';
import * as admin from '../services/adminService.js';
import * as ledger from '../services/ledgerService.js';
import * as L from '../repositories/ledger.js';
import * as transactions from '../services/transactionService.js';
import * as withdrawals from '../services/withdrawalService.js';
import * as verification from '../services/verificationService.js';
import * as support from '../services/supportService.js';
import * as security from '../services/securityEventService.js';
import * as settings from '../services/settingsService.js';
import * as features from '../services/featureService.js';
import * as audit from '../services/auditService.js';
import * as mfa from '../services/mfaService.js';
import { can } from '../config/permissions.js';
import { parseAmountToMinor } from '../utils/money.js';
import { forbidden, notFound } from '../utils/errors.js';
import { asyncHandler as h } from '../utils/asyncHandler.js';

const needs = (req, perm) => { if (!can(req.auth.user.role, perm)) throw forbidden('You do not have permission to perform this action.'); };

export const dashboard = h(async (req, res) => res.json(await admin.dashboard()));

// customers
export const listCustomers = h(async (req, res) => res.json(await admin.listCustomers(req.query)));
export const customerDetail = h(async (req, res) => res.json(await admin.customerDetail(req.params.id)));
export const customerAction = h(async (req, res) => {
  needs(req, admin.CUSTOMER_ACTIONS[req.body.action]);
  res.json(await admin.customerAction(req.ctx, req.params.id, req.body.action, req.body.reason));
});

// ledger (finance)
export const ledgerAdjust = h(async (req, res) => {
  await mfa.requireStepUp(req.auth.user, req.body.mfaCode);
  const out = await ledger.adjust(req.ctx, {
    accountId: req.body.accountId, direction: req.body.direction, amountMinor: parseAmountToMinor(req.body.amount),
    currency: req.body.currency, reason: req.body.reason, idempotencyKey: req.body.idempotencyKey,
  });
  res.status(out.replayed ? 200 : 201).json({
    replayed: out.replayed,
    reference: out.transaction.reference,
    transactionId: out.transaction.id,
    status: out.transaction.status,
    ...(out.replayed ? {} : { balanceBefore: out.before, balanceAfter: out.after }),
  });
});
export const ledgerReverse = h(async (req, res) => {
  await mfa.requireStepUp(req.auth.user, req.body.mfaCode);
  const out = await ledger.reverse(req.ctx, req.body);
  res.status(201).json({ reversalReference: out.reversal.reference, originalReference: out.original.reference });
});
export const ledgerAccount = h(async (req, res) => {
  const db = getDb();
  const { rows } = await db.query('SELECT a.*, u.email FROM accounts a LEFT JOIN users u ON u.id=a.user_id WHERE a.id=$1', [req.params.id]);
  if (!rows[0]) throw notFound('Account not found.');
  const a = rows[0];
  res.json({
    account: { id: a.id, accountNumber: a.account_number, kind: a.kind, currency: a.currency, status: a.status, owner: a.email },
    balances: await L.balances(db, a.id),
    integrity: await L.verifyIntegrity(db, a.id),
    transactions: await transactions.listForAccount(a.id, { limit: 50 }),
  });
});

// withdrawals
export const listWithdrawals = h(async (req, res) => res.json(await withdrawals.adminList(req.query)));
export const withdrawalDetail = h(async (req, res) => res.json({ withdrawal: await withdrawals.adminDetail(req.params.id) }));
export const withdrawalNote = h(async (req, res) => { await withdrawals.addNote(req.ctx, req.params.id, req.body.note); res.status(201).json({ withdrawal: await withdrawals.adminDetail(req.params.id) }); });
export const withdrawalAction = h(async (req, res) => {
  needs(req, withdrawals.TRANSITION_PERMISSIONS[req.body.action]);
  if (req.body.action === 'approve') await mfa.requireStepUp(req.auth.user, req.body.mfaCode); // approvals need a fresh authenticator code
  await withdrawals.transition(req.ctx, req.params.id, req.body.action, req.body.reason);
  res.json({ withdrawal: await withdrawals.adminDetail(req.params.id) });
});

// verification
export const verificationQueue = h(async (req, res) => res.json({ items: await verification.adminQueue(req.query) }));
export const verificationDetail = h(async (req, res) => res.json({ verification: await verification.adminDetail(req.params.id) }));
export const verificationReview = h(async (req, res) => res.json({ verification: await verification.adminReview(req.ctx, req.params.id, req.body) }));
export const verificationDocument = h(async (req, res) => {
  const f = await verification.adminGetDocument(req.ctx, req.params.id);
  res.set({ 'Content-Type': f.mime, 'Content-Disposition': 'inline', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' }).send(f.buffer);
});

// support
export const listTickets = h(async (req, res) => res.json({ tickets: await support.adminList(req.query) }));
export const getTicket = h(async (req, res) => res.json({ ticket: await support.adminGet(req.params.id) }));
export const replyTicket = h(async (req, res) => res.status(201).json({ ticket: await support.staffReply(req.ctx, req.params.id, req.body, req.files) }));
export const ticketStatus = h(async (req, res) => res.json({ ticket: await support.setStatus(req.ctx, req.params.id, req.body.status) }));
export const ticketAssign = h(async (req, res) => res.json({ ticket: await support.assign(req.ctx, req.params.id, req.body.assigneeId) }));
export const ticketAttachment = h(async (req, res) => {
  const f = await support.getAttachment({ staff: true }, req.params.id);
  res.set({ 'Content-Type': f.mime, 'Content-Disposition': `attachment; filename="${f.filename}"`, 'X-Content-Type-Options': 'nosniff' }).send(f.buffer);
});

// security events & audit
export const listSecurityEvents = h(async (req, res) => res.json(await security.list(req.query)));
export const updateSecurityEvent = h(async (req, res) => res.json({ event: await security.updateStatus(req.ctx, req.params.id, req.body) }));
export const listAudit = h(async (req, res) => res.json(await audit.list(req.query)));

// staff
export const listStaff = h(async (req, res) => res.json({ staff: await admin.listStaff() }));
export const createStaff = h(async (req, res) => res.status(201).json({ staff: await admin.createStaff(req.ctx, req.body) }));
export const updateStaff = h(async (req, res) => res.json({ staff: await admin.updateStaff(req.ctx, req.params.id, req.body) }));

// account closure requests (customer settings workflow)
export const listClosures = h(async (req, res) => res.json(await settings.listClosureRequests()));
export const decideClosure = h(async (req, res) => res.json({ closure: await settings.decideClosure(req.ctx, req.params.id, req.body) }));
export const accountSecurityReview = h(async (req, res) => res.json(await withdrawals.setSecurityReview(req.ctx, req.params.id, req.body)));

// feature switches (management)
export const getFeature = h(async (req, res) => res.json(await features.getFeature(req.params.key)));
export const setFeature = h(async (req, res) => res.json(await features.setFeature(req.ctx, req.params.key, req.body)));
