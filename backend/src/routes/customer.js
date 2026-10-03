// Customer-facing routers, grouped by API area. All require an authenticated, non-limited customer session.
import { Router } from 'express';
import * as c from '../controllers/customerController.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireCustomer } from '../middleware/authenticate.js';
import { sensitiveLimiter, uploadLimiter } from '../middleware/rateLimit.js';
import { uploadOne, uploadMany } from '../middleware/upload.js';
import * as v from '../validators/index.js';

const guard = [requireAuth(), requireCustomer];
const mk = () => Router();

export const users = mk();
users.use(requireAuth());
users.get('/me', c.getProfile);
users.patch('/me', validate(v.profileSchema), c.updateProfile);
users.post('/me/photo', uploadLimiter, uploadOne('photo'), c.uploadPhoto);
users.get('/me/photo', c.getPhoto);

export const accounts = mk();
accounts.use(guard);
accounts.get('/', c.listAccounts);
accounts.post('/', sensitiveLimiter, validate(v.openAccountSchema), c.openAccount);
accounts.get('/:id', validate(v.idParam, 'params'), c.getAccount);
accounts.get('/:id/summary', validate(v.idParam, 'params'), c.accountSummary);

export const transactions = mk();
transactions.use(guard);
transactions.get('/', validate(v.transactionQuery, 'query'), c.listTransactions);
transactions.post('/transfers', sensitiveLimiter, validate(v.transferSchema), c.createTransfer);
transactions.get('/:id', validate(v.idParam, 'params'), c.getTransaction);

export const withdrawals = mk();
withdrawals.use(guard);
withdrawals.get('/', c.listWithdrawals);
withdrawals.post('/', sensitiveLimiter, validate(v.withdrawalSchema), c.createWithdrawal);
withdrawals.get('/:id', validate(v.idParam, 'params'), c.getWithdrawal);
withdrawals.post('/:id/cancel', sensitiveLimiter, validate(v.idParam, 'params'), c.cancelWithdrawal);

export const verification = mk();
verification.use(guard);
verification.get('/status', c.verificationStatus);
verification.post('/start', sensitiveLimiter, c.verificationStart);
verification.post('/documents', uploadLimiter, uploadOne('file'), validate(v.documentKindSchema), c.verificationUpload);
verification.post('/submit', sensitiveLimiter, c.verificationSubmit);

export const notifications = mk();
notifications.use(requireAuth());
notifications.get('/', validate(v.notificationQuery, 'query'), c.listNotifications);
notifications.post('/read-all', c.readAllNotifications);
notifications.get('/preferences', c.getPreferences);
notifications.put('/preferences', validate(v.preferencesSchema), c.setPreferences);
notifications.post('/:id/read', validate(v.idParam, 'params'), c.readNotification);

export const support = mk();
support.use(guard);
support.get('/', c.listTickets);
support.post('/', uploadLimiter, uploadMany('attachments'), validate(v.ticketCreateSchema), c.createTicket);
support.get('/attachments/:id', validate(v.idParam, 'params'), c.downloadAttachment);
support.get('/:id', validate(v.idParam, 'params'), c.getTicket);
support.post('/:id/replies', uploadLimiter, uploadMany('attachments'), validate(v.idParam, 'params'), validate(v.ticketReplySchema), c.replyTicket);
support.post('/:id/close', validate(v.idParam, 'params'), c.closeTicket);

// Security Center. MFA enrolment endpoints are the only ones a "limited" (MFA-pending) staff session may reach.
export const security = mk();
security.post('/mfa/setup', requireAuth({ allowLimited: true }), c.mfaSetup);
security.post('/mfa/enable', requireAuth({ allowLimited: true }), validate(v.mfaCodeSchema), c.mfaEnable);
security.use(requireAuth());
security.get('/overview', c.securityOverview);
security.post('/password', sensitiveLimiter, validate(v.changePasswordSchema), c.changePassword);
security.post('/mfa/disable', sensitiveLimiter, validate(v.mfaDisableSchema), c.mfaDisable);
security.post('/mfa/recovery-codes', sensitiveLimiter, validate(v.mfaCodeSchema), c.mfaRecovery);
security.get('/passkeys', c.listPasskeys);
security.post('/passkeys/options', c.passkeyRegisterOptions);
security.post('/passkeys/register', validate(v.passkeyRegisterSchema), c.passkeyRegister);
security.patch('/passkeys/:id', validate(v.idParam, 'params'), validate(v.passkeyRenameSchema), c.passkeyRename);
security.delete('/passkeys/:id', validate(v.idParam, 'params'), c.passkeyRemove);
security.post('/sessions/revoke-others', c.revokeOthers);
security.delete('/sessions/:id', validate(v.idParam, 'params'), c.revokeSession);
security.delete('/devices/:id', validate(v.idParam, 'params'), c.removeDevice);
