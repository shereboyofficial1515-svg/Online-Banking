import { useState } from 'react';
import { Link, NavLink, Outlet, Navigate, useLocation } from 'react-router-dom';
import Shell from './Shell.jsx';
import Logo from '../components/ui/Logo.jsx';
import Icon from '../components/ui/Icon.jsx';
import { Button } from '../components/ui/Controls.jsx';
import { Drawer } from '../components/ui/Overlay.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { useAuth } from '../lib/auth.jsx';
import { SkeletonCard, ErrorState } from '../components/ui/Feedback.jsx';
import ThemeSwitcher from '../components/ThemeSwitcher.jsx';
import LanguageSelect from '../components/LanguageSelect.jsx';
import PinSetup from '../components/PinSetup.jsx';
import { usePrefs } from '../lib/PreferencesProvider.jsx';
import { useSite } from '../lib/site.jsx';

// ───────── customer & admin navigation definitions ─────────
// Customer labels come from the translation catalog so they follow the customer's language.
const customerGroups = (t) => [
  { items: [
    { to: '/app', label: t('nav.overview'), icon: 'home', end: true },
    { to: '/app/accounts', label: t('nav.accounts'), icon: 'wallet' },
    { to: '/app/transactions', label: t('nav.transactions'), icon: 'list' },
    { to: '/app/transfers', label: t('nav.transfers'), icon: 'swap' },
  ] },
  { label: t('nav.group.profile'), items: [
    { to: '/app/verification', label: t('nav.identity'), icon: 'id' },
    { to: '/app/security', label: t('nav.security'), icon: 'shield' },
    { to: '/app/notifications', label: t('nav.notifications'), icon: 'bell' },
  ] },
  { label: t('nav.group.help'), items: [
    { to: '/app/support', label: t('nav.support'), icon: 'lifebuoy' },
    { to: '/app/settings', label: t('nav.settings'), icon: 'settings' },
  ] },
];
const customerBottom = (t) => [
  { to: '/app', label: t('nav.overview'), icon: 'home', end: true },
  { to: '/app/transactions', label: t('nav.transactions'), short: t('nav.activity'), icon: 'list' },
  { to: '/app/transfers', label: t('nav.transfers'), short: t('nav.transfer'), icon: 'swap' },
  { to: '/app/accounts', label: t('nav.accounts'), icon: 'wallet' },
];

const adminItems = [
  { to: '/admin', label: 'Dashboard', icon: 'chart', end: true, perm: 'dashboard.read' },
  { to: '/admin/customers', label: 'Customers', icon: 'users', perm: 'customers.read' },
  { to: '/admin/withdrawals', label: 'Withdrawals', icon: 'upload', perm: 'withdrawals.read' },
  { to: '/admin/ledger', label: 'Ledger', icon: 'bank', perm: 'ledger.read' },
  { to: '/admin/verification', label: 'Verification', icon: 'id', perm: 'verification.review' },
  { to: '/admin/closures', label: 'Account closures', icon: 'wallet', perm: 'accounts.review' },
  { to: '/admin/support', label: 'Support', icon: 'lifebuoy', perm: 'support.read' },
  { to: '/admin/security', label: 'Security events', icon: 'shield', perm: 'security.read' },
  { to: '/admin/audit', label: 'Audit log', icon: 'clipboard', perm: 'audit.read' },
  { to: '/admin/staff', label: 'Staff', icon: 'key', perm: 'staff.manage' },
  { to: '/admin/website', label: 'Website', icon: 'globe', perm: 'site.manage' },
  { to: '/admin/features', label: 'Features', icon: 'check-circle', perm: 'features.manage' },
  { to: '/admin/legal', label: 'Legal documents', icon: 'file', perm: 'legal.edit' },
  { to: '/admin/security-center', label: 'My security', icon: 'lock' },
];

export function Gate({ children, staff = false }) {
  const { loading, user, mfaEnrollmentRequired, unreachable, reload, locked } = useAuth();
  const loc = useLocation();
  if (loading) return <div style={{ maxWidth: 560, margin: '20vh auto', padding: 16 }}><SkeletonCard lines={3} /></div>;
  if (unreachable) return <div style={{ maxWidth: 560, margin: '16vh auto', padding: 16 }}><ErrorState error={unreachable} onRetry={reload} /></div>;
  if (locked && !user) return null; // the lock screen is showing; never redirect a locked session to the login page
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  if (staff && !user.isStaff) return <Navigate to="/app" replace />;
  if (!staff && user.isStaff) return <Navigate to="/admin" replace />;
  if (!staff && !user.pinSet) return <PinSetup />; // customers must set a session PIN before using the app (the server refuses banking requests until they do)
  if (staff && mfaEnrollmentRequired && loc.pathname !== '/admin/security-center') return <Navigate to="/admin/security-center" replace />;
  return children;
}

export function CustomerShell() {
  const { t } = usePrefs();
  return <Shell mode="customer" groups={customerGroups(t)} bottomItems={customerBottom(t)} footerNote="Secure digital banking." />;
}

export function AdminShell() {
  const { can, mfaEnrollmentRequired } = useAuth();
  const items = adminItems.filter((i) => !i.perm || can(i.perm));
  const limited = mfaEnrollmentRequired ? items.filter((i) => i.to === '/admin/security-center') : items;
  const bottom = limited.filter((i) => i.to !== '/admin/security-center').slice(0, 4);
  return <Shell mode="admin" groups={[{ label: 'Administration', items: limited }]} bottomItems={bottom} footerNote="Staff console. All actions are recorded in the append-only audit log." />;
}

// ───────── public site ─────────
const pubLinks = (t) => [['/#services', t('pub.services')], ['/#security', t('pub.security')], ['/#digital', t('pub.digital')], ['/#faq', t('pub.faq')], ['/#contact', t('pub.contact')]];

export function PublicLayout() {
  const { user } = useAuth();
  const { config } = useSite();
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  return (
    <>
      <a href="#main" className="skip-link">Skip to main content</a>
      <header className="pub-header">
        <div className="pub-nav">
          <Logo />
          <nav className="pub-links" aria-label="Main">{pubLinks(t).map(([to, l]) => <a key={to} href={to}>{l}</a>)}</nav>
          <div className="pub-cta">
            <LanguageSelect compact />
            <ThemeSwitcher />
            {user ? <Button to={user.isStaff ? '/admin' : '/app'} size="sm" className="hide-xs">{t('pub.dashboard')}</Button> : (<><Button to="/login" variant="ghost" size="sm" className="hide-mobile">{t('pub.signin')}</Button><Button to="/register" size="sm" className="hide-xs">{t('pub.openAccount')}</Button></>)}
            <button type="button" className="icon-btn pub-burger" onClick={() => setOpen(true)} aria-label={t('pub.menu')} aria-haspopup="dialog"><Icon name="menu" /></button>
          </div>
        </div>
      </header>
      <Drawer open={open} onClose={() => setOpen(false)} title={t('pub.menu')}>
        <nav aria-label="Mobile" onClick={() => setOpen(false)}>
          {pubLinks(t).map(([to, l]) => <a key={to} href={to} className="nav-item">{l}</a>)}
          {user ? <Link to={user.isStaff ? '/admin' : '/app'} className="nav-item">{t('pub.dashboard')}</Link> : (<><Link to="/login" className="nav-item">{t('pub.signin')}</Link><Link to="/register" className="nav-item">{t('pub.openAccount')}</Link></>)}
          <Link to="/security-info" className="nav-item">Security information</Link>
          <Link to="/about" className="nav-item">{t('pub.about')}</Link>
          <Link to="/contact" className="nav-item">Contact</Link>
          <Link to="/accessibility" className="nav-item">Accessibility</Link>
        </nav>
      </Drawer>
      <main id="main" tabIndex={-1} style={{ outline: 'none' }}><ErrorBoundary resetKey={useLocation().pathname}><Outlet /></ErrorBoundary></main>
      <footer className="pub-footer">
        <div className="footer-inner">
          <div>
            <Logo light /><p style={{ marginTop: 14, maxWidth: 340 }}>{config.footer.text}</p>
            {config.social.length > 0 && <p className="footer-social">{config.social.map((x) => <a key={x.url} href={x.url} rel="noopener noreferrer" target="_blank">{x.label}</a>)}</p>}
          </div>
          <div className="footer-grid">
            <div><h3>Banking</h3><a href="/#services">Services</a><a href="/#digital">Digital banking</a><Link to="/register">Open an account</Link><Link to="/login">Sign in</Link></div>
            <div><h3>Company</h3><Link to="/about">About us</Link><Link to="/security-info">Security information</Link><Link to="/accessibility">Accessibility</Link><a href="/#faq">FAQ</a></div>
            <div><h3>Legal</h3><Link to="/privacy">Privacy Policy</Link><Link to="/terms">Terms of Service</Link><Link to="/cookies">Cookie Policy</Link></div>
            <div><h3>Contact</h3><Link to="/contact">Contact us</Link>{config.contact.email && <a href={`mailto:${config.contact.email}`}>{config.contact.email}</a>}<Link to="/app/support">Open a request</Link></div>
          </div>
          <p className="legal-note footer-inner" style={{ gridColumn: '1 / -1' }}>
            © {new Date().getFullYear()} {config.brand.siteName}. All rights reserved.
          </p>
        </div>
      </footer>
    </>
  );
}

export function AuthLayout({ children, wide, title, brandPoints = true }) {
  const { t } = usePrefs();
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
              <li><Icon name="clipboard" /> Every transaction is recorded permanently and can be traced</li>
              <li><Icon name="lock" /> Your data is encrypted in transit and at rest</li>
            </ul>
          )}
        </div>
        <p className="small">© {new Date().getFullYear()} EWB Bank. All rights reserved.</p>
      </aside>
      <main id="main" className="auth-panel">
        <div className={`auth-top ${wide ? 'wide' : ''}`}><span className="hide-desktop"><Logo /></span><span className="row" style={{ gap: 14 }}><LanguageSelect compact /><ThemeSwitcher /><Link to="/" className="small">{t('pub.back')}</Link></span></div>
        <div className={`auth-card ${wide ? 'wide' : ''}`}>{title && <h1>{title}</h1>}{children}</div>
      </main>
    </div>
  );
}

export { Outlet, NavLink };
