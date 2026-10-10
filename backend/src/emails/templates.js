// Transactional email templates. Every dynamic value is HTML-escaped. No template ever contains a
// password, full account number, or token other than the single-use link the recipient requested.
import config from '../config/index.js';

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NAVY = '#0B1F3A';
const ACCENT = '#1E9E86';

function button(href, label, align = 'left') {
  return `<p style="margin:28px 0;text-align:${align}"><a href="${esc(href)}" style="background:${NAVY};color:#fff;text-decoration:none;padding:13px 26px;border-radius:10px;font-weight:600;display:inline-block">${esc(label)}</a></p>`;
}
function codeBlock(code) {
  return `<table role="presentation" align="center" style="margin:22px auto 14px"><tr><td style="background:#F1F4F9;border:1px solid #E1E5EC;border-radius:12px;padding:16px 30px;font-family:'SF Mono',Consolas,'Courier New',monospace;font-size:34px;font-weight:700;letter-spacing:10px;color:${NAVY};text-align:center">${esc(code)}</td></tr></table>`;
}
const detailTable = (rows) =>
  `<table role="presentation" width="100%" style="border-collapse:collapse;margin:18px 0;font-size:14px">${rows
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `<tr><td style="padding:9px 0;border-bottom:1px solid #E6E9EF;color:#5B6678">${esc(k)}</td><td style="padding:9px 0;border-bottom:1px solid #E6E9EF;text-align:right;color:${NAVY};font-weight:600">${esc(v)}</td></tr>`)
    .join('')}</table>`;

function layout({ preheader, heading, bodyHtml, security = true }) {
  const now = new Date().toUTCString();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(heading)}</title></head>
<body style="margin:0;background:#F2F4F8;font-family:Inter,'Segoe UI',Arial,sans-serif;color:#1B2536">
<span style="display:none;max-height:0;overflow:hidden">${esc(preheader)}</span>
<table role="presentation" width="100%" style="background:#F2F4F8;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E1E5EC">
<tr><td style="background:${NAVY};padding:22px 32px"><span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:.04em">EWB</span><span style="color:${ACCENT};font-size:20px;font-weight:700"> Bank</span></td></tr>
<tr><td style="padding:34px 32px 8px"><h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:${NAVY}">${esc(heading)}</h1>
<div style="font-size:15px;line-height:1.65">${bodyHtml}</div></td></tr>
<tr><td style="padding:8px 32px 30px"><hr style="border:none;border-top:1px solid #E6E9EF;margin:18px 0">
${security ? `<p style="font-size:12.5px;line-height:1.6;color:#5B6678;margin:0 0 10px"><strong>Security tip:</strong> keep your password and verification codes private; they are only ever entered on the EWB Bank website. Questions about this message? Contact us at <a href="mailto:${esc(config.email.supportEmail)}" style="color:${NAVY}">${esc(config.email.supportEmail)}</a>.</p>` : ''}
<p style="font-size:12px;line-height:1.6;color:#7C8799;margin:0">Sent ${esc(now)}. EWB Bank is a financial technology platform. Account balances are ledger balances maintained by EWB Bank; see our <a href="${esc(config.appUrl)}/terms" style="color:#7C8799">Terms of Service</a> for details.</p>
</td></tr></table></td></tr></table></body></html>`;
}

const money = (minor, cur) => new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(Number(minor) / 100);
const hi = (d) => `Hello ${esc(d.firstName || 'there')},`;
const toText = (html) => html.replace(/<head>[\s\S]*?<\/head>/g, '').replace(/<span style="display:none[\s\S]*?<\/span>/g, '').replace(/<\/td><td[^>]*>/g, ': ').replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, '$2: $1').replace(/<\/(p|tr|h1|div)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\n{3,}/g, '\n\n').trim();

const T = {
  welcome: (d) => ({
    subject: 'Welcome to EWB Bank',
    heading: 'Your EWB Bank profile has been created',
    body: `<p>${hi(d)}</p><p>Thank you for registering. Your account is now pending review. We will notify you as soon as it is approved. In the meantime, please verify your email address.</p>`,
  }),
  email_verification: (d) => ({
    subject: 'Your EWB Bank verification code',
    heading: 'Verify your email address',
    body: `<p>${hi(d)}</p><p>Welcome to EWB Bank. Enter the code below on the verification page to confirm your email address and finish setting up your profile.</p>${codeBlock(d.code)}<p style="text-align:center;color:#5B6678;font-size:13.5px;margin:-6px 0 0">This code is valid for ${esc(d.minutes)} minutes.</p>${button(d.url, 'Verify my email', 'center')}<p style="font-size:13px;color:#5B6678;margin:0;text-align:center">Haven't created an EWB Bank profile? No action is needed.</p>`,
  }),
  login_notification: (d) => ({
    subject: 'New sign-in to your EWB Bank account',
    heading: 'You signed in to EWB Bank',
    body: `<p>${hi(d)}</p><p>We detected a sign-in to your account.</p>${detailTable([['Time (UTC)', d.time], ['Method', d.method], ['Device', d.device], ['IP address', d.ip]])}<p>If this was you, no action is needed. If not, reset your password immediately and review your active sessions in Security.</p>`,
  }),
  new_device_login: (d) => ({
    subject: 'Sign-in from a new device',
    heading: 'New device sign-in',
    body: `<p>${hi(d)}</p><p>Your account was accessed from a device we have not seen before.</p>${detailTable([['Time (UTC)', d.time], ['Device', d.device], ['IP address', d.ip]])}<p>If this was not you, please <a href="${esc(config.appUrl)}/forgot-password">reset your password</a> and revoke the session under Security.</p>`,
  }),
  password_reset: (d) => ({
    subject: 'Reset your EWB Bank password',
    heading: 'Password reset requested',
    body: `<p>${hi(d)}</p><p>We received a request to reset your password. The link expires in ${config.auth.resetTokenMinutes} minutes and works once. If you did not request this, you can ignore this email; your password will not change.</p>${button(d.url, 'Choose a new password')}`,
  }),
  password_changed: (d) => ({
    subject: 'Your EWB Bank password was changed',
    heading: 'Password changed',
    body: `<p>${hi(d)}</p><p>The password for your account was changed and all other sessions were signed out.</p>${detailTable([['Time (UTC)', d.time], ['IP address', d.ip]])}<p>If you did not do this, contact support immediately.</p>`,
  }),
  security_alert: (d) => ({
    subject: `Security alert: ${d.title}`,
    heading: d.title,
    body: `<p>${hi(d)}</p><p>${esc(d.message)}</p>${detailTable([['Time (UTC)', d.time], ['IP address', d.ip]])}<p>This notice is informational. It does not mean your account has been misused.</p>`,
  }),
  account_approved: (d) => ({
    subject: 'Your EWB Bank account has been approved',
    heading: 'Account approved',
    body: `<p>${hi(d)}</p><p>Your account has been reviewed and approved. You can now sign in and use your dashboard.</p>${button(`${config.appUrl}/login`, 'Sign in')}`,
  }),
  account_rejected: (d) => ({
    subject: 'Update on your EWB Bank application',
    heading: 'Account application update',
    body: `<p>${hi(d)}</p><p>We were unable to approve your account application at this time.</p>${d.reason ? `<p><strong>Reason:</strong> ${esc(d.reason)}</p>` : ''}<p>If you believe this is a mistake, please contact customer support.</p>`,
  }),
  account_status: (d) => ({
    subject: `Your account status changed to ${d.statusLabel}`,
    heading: 'Account status update',
    body: `<p>${hi(d)}</p><p>The status of your EWB Bank account is now <strong>${esc(d.statusLabel)}</strong>.</p>${d.reason ? `<p><strong>Note:</strong> ${esc(d.reason)}</p>` : ''}<p>If you have questions, please contact customer support.</p>`,
  }),
  identity_status: (d) => ({
    subject: `Identity verification: ${d.statusLabel}`,
    heading: `Identity verification ${d.statusLabel.toLowerCase()}`,
    body: `<p>${hi(d)}</p><p>Your identity verification status is now <strong>${esc(d.statusLabel)}</strong>.</p>${d.reason ? `<p><strong>Details:</strong> ${esc(d.reason)}</p>` : ''}<p>You can review the status any time in the Identity verification section of your dashboard.</p>`,
  }),
  ledger_adjustment: (d) => ({
    subject: `${d.direction === 'credit' ? 'Credit' : 'Debit'} posted to your account`,
    heading: `A ${d.direction} was posted to your account`,
    body: `<p>${hi(d)}</p><p>A ${esc(d.direction)} was recorded in your EWB Bank ledger.</p>${detailTable([['Amount', money(d.amount, d.currency)], ['Reference', d.reference], ['Account', d.accountMasked], ['Description', d.description], ['Posted (UTC)', d.time]])}`,
  }),
  transfer_receipt: (d) => ({
    subject: `Transfer ${d.role === 'sender' ? 'sent' : 'received'}`,
    heading: d.role === 'sender' ? 'Your transfer was completed' : 'You received a transfer',
    body: `<p>${hi(d)}</p>${detailTable([['Amount', money(d.amount, d.currency)], ['Reference', d.reference], ['Account', d.accountMasked], ['Posted (UTC)', d.time]])}`,
  }),
  withdrawal_received: (d) => ({
    subject: 'Withdrawal request received',
    heading: 'We received your withdrawal request',
    body: `<p>${hi(d)}</p><p>Your request has been recorded and requires additional account review. <strong>No funds have been sent.</strong> Please contact EWB Bank Customer Support for assistance with your request.</p>${detailTable([['Amount', money(d.amount, d.currency)], ['Reference', d.reference], ['Status', d.statusLabel]])}`,
  }),
  withdrawal_blocked: (d) => ({
    subject: 'Withdrawal request on hold',
    heading: 'Your withdrawal request is on hold',
    body: `<p>${hi(d)}</p><p>${esc(d.message)} <strong>No funds have been sent.</strong></p>${detailTable([['Amount', money(d.amount, d.currency)], ['Reference', d.reference], ['Status', d.statusLabel]])}${button(`${config.appUrl}/app/support`, 'Contact customer support')}`,
  }),
  withdrawal_update: (d) => ({
    subject: `Withdrawal request update: ${d.statusLabel}`,
    heading: 'Withdrawal request update',
    body: `<p>${hi(d)}</p><p>Your withdrawal request is now <strong>${esc(d.statusLabel)}</strong>. ${esc(d.message || '')}</p>${detailTable([['Amount', money(d.amount, d.currency)], ['Reference', d.reference]])}<p>This update does not mean funds were sent to an external bank account.</p>`,
  }),
  support_notification: (d) => ({
    subject: `[${d.reference}] ${d.subject}`,
    heading: d.heading,
    body: `<p>${hi(d)}</p><p>${esc(d.message)}</p>${detailTable([['Ticket', d.reference], ['Status', d.statusLabel]])}${button(`${config.appUrl}/app/support/${encodeURIComponent(d.ticketId)}`, 'View ticket')}`,
  }),
  admin_security_alert: (d) => ({
    subject: `[Admin alert] ${d.title}`,
    heading: d.title,
    body: `<p>${esc(d.message)}</p>${detailTable([['Severity', d.severity], ['Time (UTC)', d.time], ['Event ID', d.eventId]])}${button(`${config.appUrl}/admin/security`, 'Open security events')}`,
  }),
  staff_invite: (d) => ({
    subject: 'You have been added to EWB Bank administration',
    heading: 'Set up your administrator account',
    body: `<p>${hi(d)}</p><p>An administrator account with the role <strong>${esc(d.roleLabel)}</strong> was created for you. Choose a password to continue; you will then be required to enrol multi-factor authentication.</p>${button(d.url, 'Set password')}`,
  }),
};

export function renderTemplate(name, data) {
  const t = T[name];
  if (!t) throw new Error(`Unknown email template: ${name}`);
  const { subject, heading, body } = t(data);
  const html = layout({ preheader: subject, heading, bodyHtml: body, security: true });
  return { subject, html, text: toText(html) };
}
export const TEMPLATE_NAMES = Object.keys(T);
