// HTTP adapters for the customer-facing APIs. Each handler takes identity ONLY from req.auth (the verified
// session) - ids in URLs/bodies are treated as lookup keys that must resolve to something the user owns.
import * as features from '../services/featureService.js';
import * as settings from '../services/settingsService.js';
import * as legal from '../services/legalService.js';
import * as users from '../repositories/users.js';
import * as userService from '../services/userService.js';
import * as preferences from '../services/preferencesService.js';
import * as accounts from '../services/accountService.js';
import * as transactions from '../services/transactionService.js';
import * as ledger from '../services/ledgerService.js';
import * as withdrawals from '../services/withdrawalService.js';
import * as verification from '../services/verificationService.js';
import * as notifications from '../services/notificationService.js';
import * as support from '../services/supportService.js';
import * as center from '../services/securityCenterService.js';
import * as mfa from '../services/mfaService.js';
import * as passkeys from '../services/passkeyService.js';
import * as authService from '../services/authService.js';
import { parseAmountToMinor } from '../utils/money.js';
import { asyncHandler as h } from '../utils/asyncHandler.js';
import { clearSessionCookies } from './authController.js';

const uid = (req) => req.auth.user.id;

// users
export const getProfile = (req, res) => res.json({ user: users.toPublic(req.auth.user) });
export const updateProfile = h(async (req, res) => res.json({ user: await userService.updateProfile(req.ctx, req.auth.user, req.body) }));
export const uploadPhoto = h(async (req, res) => res.json(await userService.setProfilePhoto(req.ctx, req.auth.user, req.file)));
export const getPhoto = h(async (req, res) => {
  const { buffer, mime } = await userService.getProfilePhoto(req.auth.user);
  res.set({ 'Content-Type': mime, 'Cache-Control': 'private, max-age=300', 'Content-Disposition': 'inline' }).send(buffer);
});

// preferences (display, accessibility, language, regional formatting)
export const getDisplayPreferences = h(async (req, res) => res.json({ preferences: await preferences.get(uid(req)) }));
export const saveDisplayPreferences = h(async (req, res) => res.json({ preferences: await preferences.update(uid(req), req.body) }));

// accounts
export const listAccounts = h(async (req, res) => res.json({ accounts: await accounts.listForUser(uid(req)) }));
export const getAccount = h(async (req, res) => res.json({ account: await accounts.getOwned(uid(req), req.params.id) }));
export const accountSummary = h(async (req, res) => res.json(await accounts.summary(uid(req), req.params.id)));
export const openAccount = h(async (req, res) => res.status(201).json({ account: await accounts.openAdditional(req.ctx, req.body) }));

// transactions
export const listTransactions = h(async (req, res) => res.json(await transactions.listForUser(uid(req), req.query)));
export const getTransaction = h(async (req, res) => res.json({ transaction: await transactions.getForUser(uid(req), req.params.id) }));
export const createTransfer = h(async (req, res) => {
  const out = await ledger.transfer(req.ctx, { ...req.body, amountMinor: parseAmountToMinor(req.body.amount) });
  res.status(out.replayed ? 200 : 201).json({ transaction: await transactions.getForUser(uid(req), out.transaction.id), replayed: out.replayed });
});

// withdrawals
export const listWithdrawals = h(async (req, res) => res.json({ withdrawals: await withdrawals.listForUser(uid(req)) }));
export const getWithdrawal = h(async (req, res) => res.json({ withdrawal: await withdrawals.getForUser(uid(req), req.params.id) }));
export const createWithdrawal = h(async (req, res) => res.status(202).json(await withdrawals.create(req.ctx, { ...req.body, amountMinor: parseAmountToMinor(req.body.amount) })));
export const cancelWithdrawal = h(async (req, res) => res.json({ withdrawal: await withdrawals.cancel(req.ctx, req.params.id) }));

// verification
export const verificationStatus = h(async (req, res) => res.json(await verification.getStatus(uid(req))));
export const verificationStart = h(async (req, res) => res.status(201).json(await verification.start(req.ctx)));
export const verificationUpload = h(async (req, res) => res.json(await verification.uploadDocument(req.ctx, req.body.kind, req.file)));
export const verificationSubmit = h(async (req, res) => res.json(await verification.submit(req.ctx)));

// notifications
export const listNotifications = h(async (req, res) => res.json(await notifications.list(uid(req), req.query)));
export const readNotification = h(async (req, res) => { await notifications.markRead(uid(req), req.params.id); res.json({ ok: true }); });
export const readAllNotifications = h(async (req, res) => { await notifications.markAllRead(uid(req)); res.json({ ok: true }); });
export const getPreferences = h(async (req, res) => res.json({ preferences: await notifications.getPreferences(uid(req)) }));
export const setPreferences = h(async (req, res) => res.json({ preferences: await notifications.setPreferences(uid(req), req.body.preferences) }));

// support
export const listTickets = h(async (req, res) => res.json({ tickets: await support.listForUser(uid(req)) }));
export const createTicket = h(async (req, res) => res.status(201).json({ ticket: await support.create(req.ctx, req.body, req.files) }));
export const getTicket = h(async (req, res) => res.json({ ticket: await support.getForUser(uid(req), req.params.id) }));
export const replyTicket = h(async (req, res) => res.status(201).json({ ticket: await support.reply(req.ctx, req.params.id, req.body, req.files) }));
export const closeTicket = h(async (req, res) => res.json({ ticket: await support.closeByUser(req.ctx, req.params.id) }));
export const downloadAttachment = h(async (req, res) => {
  const f = await support.getAttachment({ userId: uid(req) }, req.params.id);
  res.set({ 'Content-Type': f.mime, 'Content-Disposition': `attachment; filename="${f.filename}"`, 'X-Content-Type-Options': 'nosniff' }).send(f.buffer);
});

// security center
export const securityOverview = h(async (req, res) => res.json(await center.overview(req.auth.user, req.auth.session.id)));
export const changePassword = h(async (req, res) => { await authService.changePassword(req.ctx, req.auth.user, req.body); res.json({ ok: true }); });
export const mfaSetup = h(async (req, res) => res.json(await mfa.beginSetup(req.auth.user)));
export const mfaEnable = h(async (req, res) => res.json(await mfa.confirmSetup(req.ctx, req.auth.user, req.body.code)));
export const mfaDisable = h(async (req, res) => { await mfa.disable(req.ctx, req.auth.user, req.body); res.json({ ok: true }); });
export const mfaRecovery = h(async (req, res) => res.json(await mfa.regenerateRecoveryCodes(req.ctx, req.auth.user, req.body.code)));
export const listPasskeys = h(async (req, res) => res.json({ passkeys: await passkeys.list(uid(req)) }));
export const passkeyRegisterOptions = h(async (req, res) => res.json(await passkeys.registrationOptions(req.auth.user)));
export const passkeyRegister = h(async (req, res) => res.status(201).json({ passkey: await passkeys.verifyRegistration(req.ctx, req.auth.user, req.body) }));
export const passkeyRename = h(async (req, res) => res.json({ passkey: await passkeys.rename(req.ctx, uid(req), req.params.id, req.body.name) }));
export const passkeyRemove = h(async (req, res) => { await passkeys.remove(req.ctx, req.auth.user, req.params.id); res.json({ ok: true }); });
export const revokeSession = h(async (req, res) => {
  await center.revokeSession(req.ctx, req.auth.user, req.params.id);
  if (req.params.id === req.auth.session.id) clearSessionCookies(res);
  res.json({ ok: true });
});
export const revokeOthers = h(async (req, res) => res.json(await center.revokeOtherSessions(req.ctx, req.auth.user)));
export const removeDevice = h(async (req, res) => { await center.removeDevice(req.ctx, req.auth.user, req.params.id); res.json({ ok: true }); });

export const listLegalAcceptances = h(async (req, res) => res.json(await legal.listAcceptances(req.auth.user.id)));

// settings: email change, account name, closure, feedback
export const requestEmailChange = h(async (req, res) => res.json(await settings.requestEmailChange(req.ctx, req.auth.user, req.body)));
export const confirmEmailChange = h(async (req, res) => res.json({ user: await settings.confirmEmailChange(req.ctx, req.auth.user, req.body) }));
export const renameAccount = h(async (req, res) => res.json({ account: await settings.renameAccount(req.ctx, req.auth.user, req.params.id, req.body.name) }));
export const getClosure = h(async (req, res) => res.json({ closure: await settings.getClosure(uid(req), req.params.id) }));
export const requestClosure = h(async (req, res) => res.status(201).json({ closure: await settings.requestClosure(req.ctx, req.auth.user, req.params.id, req.body) }));
export const cancelClosure = h(async (req, res) => res.json({ closure: await settings.cancelClosure(req.ctx, req.auth.user, req.params.id) }));
export const sendFeedback = h(async (req, res) => {
  const label = { suggestion: 'Suggestion', problem: 'Problem report', compliment: 'Compliment' }[req.body.kind];
  res.status(201).json({ ticket: await support.create(req.ctx, { category: 'other', subject: `Feedback: ${label}`, message: req.body.message }, []) });
});

export const featureStatus = h(async (req, res) => res.json({ savings: { enabled: await features.isSavingsEnabled() } }));
