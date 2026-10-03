// Role -> permission matrix. This is the single source of truth and is enforced by backend
// middleware (middleware/authorize.js). The frontend receives a copy purely to hide UI; it is never trusted.
export const ROLES = {
  customer: 'Customer',
  super_admin: 'Super Admin',
  compliance_admin: 'Compliance Admin',
  support_agent: 'Support Agent',
  finance_operator: 'Finance Operator',
  security_admin: 'Security Administrator',
};
export const STAFF_ROLES = Object.keys(ROLES).filter((r) => r !== 'customer');

const ALL = [
  'dashboard.read', 'customers.read', 'customers.status', 'accounts.review', 'sessions.reset', 'verification.review',
  'withdrawals.read', 'withdrawals.note', 'withdrawals.review', 'withdrawals.decide', 'ledger.read', 'ledger.adjust', 'ledger.reverse',
  'support.read', 'support.manage', 'security.read', 'security.manage', 'audit.read', 'staff.manage',
];

export const ROLE_PERMISSIONS = {
  super_admin: ALL,
  compliance_admin: ['dashboard.read', 'customers.read', 'accounts.review', 'verification.review', 'withdrawals.read', 'withdrawals.note', 'withdrawals.review', 'audit.read', 'support.read'],
  support_agent: ['dashboard.read', 'customers.read', 'support.read', 'support.manage', 'withdrawals.read', 'withdrawals.note'],
  finance_operator: ['dashboard.read', 'customers.read', 'ledger.read', 'ledger.adjust', 'ledger.reverse', 'withdrawals.read', 'withdrawals.note', 'withdrawals.decide'],
  security_admin: ['dashboard.read', 'customers.read', 'customers.status', 'sessions.reset', 'security.read', 'security.manage', 'audit.read'],
  customer: [],
};

export const can = (role, permission) => (ROLE_PERMISSIONS[role] || []).includes(permission);
export const permissionsFor = (role) => ROLE_PERMISSIONS[role] || [];
