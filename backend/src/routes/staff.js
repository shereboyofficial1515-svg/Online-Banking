// Staff routers. Pipeline for every endpoint: authenticated session -> staff role with MFA completed ->
// base permission -> validation -> controller (action-level permission / MFA step-up where relevant).
import { Router } from 'express';
import * as c from '../controllers/staffController.js';
import { validate } from '../middleware/validate.js';
import { requireAuth, requireStaff, requirePermission as can } from '../middleware/authenticate.js';
import { sensitiveLimiter, uploadLimiter } from '../middleware/rateLimit.js';
import { uploadMany } from '../middleware/upload.js';
import * as v from '../validators/index.js';

const staff = [requireAuth(), requireStaff];
const id = validate(v.idParam, 'params');

export const admin = Router();
admin.use(staff);
admin.get('/dashboard', can('dashboard.read'), c.dashboard);

admin.get('/customers', can('customers.read'), validate(v.customerQuery, 'query'), c.listCustomers);
admin.get('/customers/:id', can('customers.read'), id, c.customerDetail);
admin.post('/customers/:id/actions', sensitiveLimiter, id, validate(v.customerActionSchema), c.customerAction); // action-specific permission in controller

admin.get('/withdrawals', can('withdrawals.read'), validate(v.withdrawalAdminQuery, 'query'), c.listWithdrawals);
admin.get('/withdrawals/:id', can('withdrawals.read'), id, c.withdrawalDetail);
admin.post('/withdrawals/:id/notes', can('withdrawals.note'), id, validate(v.noteSchema), c.withdrawalNote);
admin.post('/withdrawals/:id/actions', sensitiveLimiter, id, validate(v.withdrawalActionSchema), c.withdrawalAction);

admin.get('/account-closures', can('accounts.review'), c.listClosures);
admin.post('/account-closures/:id', sensitiveLimiter, can('accounts.review'), id, validate(v.closureDecisionSchema), c.decideClosure);

admin.get('/verification', can('verification.review'), validate(v.verificationQueueQuery, 'query'), c.verificationQueue);
admin.get('/verification/documents/:id', can('verification.review'), id, c.verificationDocument);
admin.get('/verification/:id', can('verification.review'), id, c.verificationDetail);
admin.post('/verification/:id/review', sensitiveLimiter, can('verification.review'), id, validate(v.verificationReviewSchema), c.verificationReview);

admin.get('/support', can('support.read'), validate(v.adminTicketQuery, 'query'), c.listTickets);
admin.get('/support/attachments/:id', can('support.read'), id, c.ticketAttachment);
admin.get('/support/:id', can('support.read'), id, c.getTicket);
admin.post('/support/:id/replies', can('support.manage'), uploadLimiter, uploadMany('attachments'), id, validate(v.staffReplySchema), c.replyTicket);
admin.post('/support/:id/status', can('support.manage'), id, validate(v.ticketStatusSchema), c.ticketStatus);
admin.post('/support/:id/assign', can('support.manage'), id, validate(v.ticketAssignSchema), c.ticketAssign);

admin.get('/security-events', can('security.read'), validate(v.securityEventQuery, 'query'), c.listSecurityEvents);
admin.patch('/security-events/:id', can('security.manage'), id, validate(v.securityEventUpdateSchema), c.updateSecurityEvent);

admin.get('/staff', can('staff.manage'), c.listStaff);
admin.post('/staff', sensitiveLimiter, can('staff.manage'), validate(v.staffCreateSchema), c.createStaff);
admin.patch('/staff/:id', sensitiveLimiter, can('staff.manage'), id, validate(v.staffUpdateSchema), c.updateStaff);

export const ledger = Router();
ledger.use(staff);
ledger.post('/adjustments', sensitiveLimiter, can('ledger.adjust'), validate(v.ledgerAdjustSchema), c.ledgerAdjust);
ledger.post('/reversals', sensitiveLimiter, can('ledger.reverse'), validate(v.ledgerReverseSchema), c.ledgerReverse);
ledger.get('/accounts/:id', can('ledger.read'), id, c.ledgerAccount);

export const audit = Router();
audit.use(staff);
audit.get('/', can('audit.read'), validate(v.auditQuery, 'query'), c.listAudit);
