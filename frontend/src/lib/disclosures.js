// Single source of truth for the regulatory disclosure shown to customers. Keep it factual: it must never imply a banking
// licence, deposit insurance or a completed banking partnership that does not exist. If the facts change (e.g. a licensed
// partner goes live), update this one file, the backend email footer (backend/src/emails/templates.js) and the Terms page.
export const DISCLOSURE =
  'EWB Bank is a financial technology platform and does not currently hold a banking licence. Account balances are maintained by EWB Bank and are not insured deposits. Banking services will be provided through a licensed banking partner when they become available.';

export const DASHBOARD_NOTE = 'Balances reflect the transactions recorded on your account. Withdrawal requests show their real status and can go through a security check before they are processed.';
