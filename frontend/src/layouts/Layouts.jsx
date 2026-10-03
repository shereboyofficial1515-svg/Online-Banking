import { useState } from 'react';
import { Link, NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import Shell from './Shell.jsx';
import Logo from '../components/ui/Logo.jsx';
import Icon from '../components/ui/Icon.jsx';
import { Button } from '../components/ui/Controls.jsx';
import { Drawer } from '../components/ui/Overlay.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { useAuth } from '../lib/auth.jsx';
import { SkeletonCard } from '../components/ui/Feedback.jsx';

// ───────── customer & admin navigation definitions ─────────
const customerGroups = [
  { items: [
    { to: '/app', label: 'Overview', icon: 'home', end: true },
    { to: '/app/accounts', label: 'Accounts', icon: 'wallet' },
    { to: '/app/transactions', label: 'Transactions', icon: 'list' },
    { to: '/app/transfers', label: 'Transfers', icon: 'swap' },
    { to: '/app/withdrawals', label: 'Withdrawals', icon: 'upload' },
  ] },
  { label: 'Your profile', items: [
    { to: '/app/profile', label: 'Profile', icon: 'user' },
    { to: '/app/verification', label: 'Identity verification', icon: 'id' },
    { to: '/app/security', label: 'Security', icon: 'shield' },
    { to: '/app/notifications', label: 'Notifications', icon: 'bell' },
  ] },
  { label: 'Help', items: [
    { to: '/app/support', label: 'Customer support', icon: 'lifebuoy' },
    { to: '/app/settings', label: 'Settings', icon: 'settings' },
  ] },
];
const customerBottom = [
  { to: '/app', label: 'Overview', icon: 'home', end: true },
  { to: '/app/transactions', label: 'Transactions', short: 'Activity', icon: 'list' },
  { to: '/app/transfers', label: 'Transfers', short: 'Transfer', icon: 'swap' },
  { to: '/app/withdrawals', label: 'Withdrawals', short: 'Withdraw', icon: 'upload' },
];

const adminItems = [
  { to: '/admin', label: 'Dashboard', icon: 'chart', end: true, perm: 'dashboard.read' },
  { to: '/admin/customers', label: 'Customers', icon: 'users', perm: 'customers.read' },
  { to: '/admin/withdrawals', label: 'Withdrawals', icon: 'upload', perm: 'withdrawals.read' },
  { to: '/admin/ledger', label: 'Ledger', icon: 'bank', perm: 'ledger.read' },
  { to: '/admin/verification', label: 'Verification', icon: 'id', perm: 'verification.review' },
  { to: '/admin/support', label: 'Support', icon: 'lifebuoy', perm: 'support.read' },
  { to: '/admin/security', label: 'Security events', icon: 'shield', perm: 'security.read' },
  { to: '/admin/audit', label: 'Audit log', icon: 'clipboard', perm: 'audit.read' },
  { to: '/admin/staff', label: 'Staff', icon: 'key', perm: 'staff.manage' },
  { to: '/admin/security-center', label: 'My security', icon: 'lock' },
];

export function Gate({ children, staff = false }) {
  const { loading, user, mfaEnrollmentRequired } = useAuth();
  const loc = useLocation();
  if (loading) return <div style={{ maxWidth: 560, margin: '20vh auto', padding: 16 }}><SkeletonCard lines={3} /></div>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (staff && !user.isStaff) return <Navigate to="/app" replace />;
  if (!staff && user.isStaff) return <Navigate to="/admin" replace />;
  if (staff && mfaEnrollmentRequired && loc.pathname !== '/admin/security-center') return <Navigate to="/admin/security-center" replace />;
  return children;
}

export function CustomerShell() {
  return <Shell mode="customer" groups={customerGroups} bottomItems={customerBottom} footerNote="EWB Bank internal software ledger. Balances are not bank deposits." />;
}

export function AdminShell() {
  const { can, mfaEnrollmentRequired } = useAuth();
  const items = adminItems.filter((i) => !i.perm || can(i.perm));
  const limited = mfaEnrollmentRequired ? items.filter((i) => i.to === '/admin/security-center') : items;
  const bottom = limited.filter((i) => i.to !== '/admin/security-center').slice(0, 4);
  return <Shell mode="admin" groups={[{ label: 'Administration', items: limited }]} bottomItems={bottom} footerNote="Staff console. All actions are recorded in the append-only audit log." />;
}

// ───────── public site ─────────
const pubLinks = [['/#services', 'Services'], ['/#security', 'Security'], ['/#digital', 'Digital banking'], ['/#faq', 'FAQ'], ['/#contact', 'Contact']];

export function PublicLayout() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <>
      <a href="#main" className="skip-link">Skip to main content</a>
      <header className="pub-header">
        <div className="pub-nav">
          <Logo />
          <nav className="pub-links" aria-label="Main">{pubLinks.map(([to, l]) => <a key={to} href={to}>{l}</a>)}</nav>
          <div className="pub-cta">
            {user ? <Button to={user.isStaff ? '/admin' : '/app'} size="sm">Open dashboard</Button> : (<><Button to="/login" variant="ghost" size="sm" className="hide-mobile">Sign in</Button><Button to="/register" size="sm">Open an account</Button></>)}
            <button type="button" className="icon-btn pub-burger" onClick={() => setOpen(true)} aria-label="Open menu" aria-haspopup="dialog"><Icon name="menu" /></button>
          </div>
        </div>
      </header>
      <Drawer open={open} onClose={() => setOpen(false)} title="Menu">
        <nav aria-label="Mobile" onClick={() => setOpen(false)}>
          {pubLinks.map(([to, l]) => <a key={to} href={to} className="nav-item">{l}</a>)}
          <Link to="/login" className="nav-item">Sign in</Link>
          <Link to="/security-info" className="nav-item">Security information</Link>
          <Link to="/accessibility" className="nav-item">Accessibility</Link>
        </nav>
      </Drawer>
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}><ErrorBoundary resetKey={useLocation().pathname}><Outlet /></ErrorBoundary></main>
      <footer className="pub-footer">
        <div className="footer-inner">
          <div><Logo light /><p style={{ marginTop: 14, maxWidth: 340 }}>Modern digital banking software with a security-first design.</p></div>
          <div className="footer-grid">
            <div><h3>Banking</h3><a href="/#services">Services</a><a href="/#digital">Digital banking</a><Link to="/register">Open an account</Link><Link to="/login">Sign in</Link></div>
            <div><h3>Security</h3><Link to="/security-info">Security information</Link><Link to="/accessibility">Accessibility</Link><a href="/#faq">FAQ</a></div>
            <div><h3>Legal</h3><Link to="/privacy">Privacy Policy</Link><Link to="/terms">Terms of Service</Link></div>
            <div><h3>Contact</h3><a href="/#contact">Customer support</a><Link to="/app/support">Open a request</Link></div>
          </div>
          <p className="legal-note footer-inner" style={{ gridColumn: '1 / -1' }}>
            EWB Bank is an independent software project and is not affiliated with any other financial institution. The platform currently operates an internal software ledger:
            balances are ledger records, not deposits, and no regulated banking, payment or card services are provided. EWB Bank is not currently a licensed bank and deposits are not insured.
            Regulated services will be offered only after the required licences, partner agreements and compliance programmes are in place.
          </p>
        </div>
      </footer>
    </>
  );
}

export function AuthLayout({ children, wide, title, brandPoints = true }) {
  return (
    <div className="auth">
      <aside className="auth-brand" aria-hidden={false}>
        <Logo light />
        <div>
          <h2>Banking built around your security.</h2>
          <p>Manage your accounts with passkey sign-in, multi-factor authentication and complete transparency over every session.</p>
          {brandPoints && (
            <ul className="auth-points">
              <li><Icon name="shield-check" /> Passkeys and authenticator-app MFA</li>
              <li><Icon name="clipboard" /> Every ledger movement is recorded and auditable</li>
              <li><Icon name="lock" /> Your data is encrypted in transit and at rest</li>
            </ul>
          )}
        </div>
        <p className="small">© {new Date().getFullYear()} EWB Bank. Internal software ledger — not a licensed depository institution.</p>
      </aside>
      <main id="main" className="auth-panel">
        <div className={`auth-top ${wide ? 'wide' : ''}`}><span className="hide-desktop"><Logo /></span><Link to="/" className="small">← Back to website</Link></div>
        <div className={`auth-card ${wide ? 'wide' : ''}`}>{title && <h1>{title}</h1>}{children}</div>
      </main>
    </div>
  );
}

export { Outlet, NavLink };
