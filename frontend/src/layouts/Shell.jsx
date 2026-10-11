import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate, Link } from 'react-router-dom';
import Logo from '../components/ui/Logo.jsx';
import Icon from '../components/ui/Icon.jsx';
import { Drawer } from '../components/ui/Overlay.jsx';
import ErrorBoundary from '../components/ErrorBoundary.jsx';
import { useAuth } from '../lib/auth.jsx';
import { api } from '../lib/api.js';
import { initials } from '../lib/format.js';
import { useEnter } from '../lib/motion.js';
import ThemeSwitcher from '../components/ThemeSwitcher.jsx';
import { usePrefs } from '../lib/PreferencesProvider.jsx';
import { Alert } from '../components/ui/Feedback.jsx';
import { Button } from '../components/ui/Controls.jsx';
import Avatar from '../components/Avatar.jsx';
import LogoutDialog from '../components/LogoutDialog.jsx';
import { DASHBOARD_NOTE } from '../lib/disclosures.js';

function NavList({ groups, onNavigate, badges }) {
  return groups.map((g) => (
    <div key={g.label || 'main'}>
      {g.label && <div className="nav-group-label">{g.label}</div>}
      {g.items.map((it) => (
        <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={onNavigate}>
          <Icon name={it.icon} size={20} /><span>{it.label}</span>
          {badges?.[it.to] > 0 && <span className="nav-badge" aria-label={`${badges[it.to]} unread`}>{badges[it.to]}</span>}
        </NavLink>
      ))}
    </div>
  ));
}

function UserMenu({ mode }) {
  const { user, logout } = useAuth();
  const { t } = usePrefs();
  const [open, setOpen] = useState(false);
  const [confirmOut, setConfirmOut] = useState(false);
  const ref = useRef(null);
  const nav = useNavigate();
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button type="button" className="icon-btn" style={{ width: 44 }} aria-haspopup="menu" aria-expanded={open} aria-label={t('menu.account')} onClick={() => setOpen((o) => !o)}>
        <Avatar />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head"><strong>{user.firstName} {user.lastName}</strong><span>{user.email}</span></div>
          {mode === 'customer' && <Link to="/app/settings/profile" role="menuitem" onClick={() => setOpen(false)}><Icon name="user" size={18} /> {t('menu.profile')}</Link>}
          <Link to={mode === 'customer' ? '/app/security' : '/admin/security-center'} role="menuitem" onClick={() => setOpen(false)}><Icon name="shield" size={18} /> {t('menu.security')}</Link>
          {mode === 'customer' && <Link to="/app/settings/display" role="menuitem" onClick={() => setOpen(false)}><Icon name="globe" size={18} /> {t('menu.language')}</Link>}
          <button type="button" role="menuitem" onClick={() => { setOpen(false); setConfirmOut(true); }}><Icon name="logout" size={18} /> {t('menu.logout')}</button>
        </div>
      )}
      <LogoutDialog open={confirmOut} onClose={() => setConfirmOut(false)} onConfirm={async () => { await logout(); setConfirmOut(false); nav('/login', { replace: true }); }} />
    </div>
  );
}

/**
 * Responsive application frame. Desktop: persistent sidebar. Phones/tablets: top bar with a hamburger for secondary
 * pages, plus a bottom tab bar for the four most-used destinations.
 */
export default function Shell({ mode, groups, bottomItems, footerNote }) {
  const { user } = useAuth();
  const { version, t } = usePrefs();
  const loc = useLocation();
  const [drawer, setDrawer] = useState(false);
  const [unread, setUnread] = useState(0);
  const main = useRef(null);
  const all = groups.flatMap((g) => g.items);
  const current = all.filter((i) => (i.end ? loc.pathname === i.to : loc.pathname.startsWith(i.to))).sort((a, b) => b.to.length - a.to.length)[0];

  useEffect(() => { setDrawer(false); main.current?.focus({ preventScroll: true }); window.scrollTo(0, 0); }, [loc.pathname]);
  useEnter(main, [loc.pathname]);

  useEffect(() => {
    if (mode !== 'customer') return undefined;
    let stop = false;
    const load = () => api.get('/api/notifications', { limit: 1 }).then((r) => !stop && setUnread(r.unread)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener('ewb:notifications-changed', load);
    return () => { stop = true; clearInterval(t); window.removeEventListener('ewb:notifications-changed', load); };
  }, [mode, loc.pathname]);

  const badges = { '/app/notifications': unread };
  return (
    <div className="shell">
      <a href="#main" className="skip-link">Skip to main content</a>
      <aside className="sidebar" aria-label="Primary">
        <Logo to={mode === 'customer' ? '/app' : '/admin'} light />
        <nav aria-label={mode === 'customer' ? 'Banking navigation' : 'Administration navigation'}><NavList groups={groups} badges={badges} /></nav>
        <div className="sidebar-foot">{footerNote}</div>
      </aside>
      <div className="shell-main">
        <header className="topbar">
          <button type="button" className="icon-btn hamburger" onClick={() => setDrawer(true)} aria-label="Open menu" aria-haspopup="dialog"><Icon name="menu" /></button>
          <Logo to={mode === 'customer' ? '/app' : '/admin'} compact />
          <span className="topbar-title">{current?.label}</span>
          <span className="topbar-spacer" />
          <ThemeSwitcher />
          {mode === 'customer' && (
            <Link to="/app/notifications" className="icon-btn bell" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
              <Icon name="bell" />{unread > 0 && <span className="bell-dot" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
            </Link>
          )}
          <UserMenu mode={mode} />
        </header>
        <main id="main" ref={main} tabIndex={-1} className="content" style={{ outline: 'none' }}>
          {mode === 'customer' && user.phoneRequired && loc.pathname !== '/app/settings/profile' && (
            <Alert tone="info" title={t('banner.phone.title')} action={<Button size="sm" to="/app/settings/profile">{t('banner.phone.action')}</Button>}>{t('banner.phone.text')}</Alert>
          )}
          <ErrorBoundary resetKey={loc.pathname}><Outlet key={version} /></ErrorBoundary>
          {mode === 'customer' && (
            <p className="disclosure">{DASHBOARD_NOTE} <Link to="/terms">Terms of Service</Link></p>
          )}
        </main>
        <nav className="bottom-nav" aria-label="Quick navigation">
          {bottomItems.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `bottom-item ${isActive ? 'active' : ''}`}><Icon name={it.icon} size={22} /><span>{it.short || it.label}</span></NavLink>
          ))}
          <button type="button" className={`bottom-item ${drawer ? 'active' : ''}`} onClick={() => setDrawer(true)} aria-haspopup="dialog"><Icon name="menu" size={22} /><span>More</span></button>
        </nav>
      </div>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title={<span className="drawer-who"><Avatar size={36} /><span>{user.firstName} {user.lastName}</span></span>}>
        <nav aria-label="All pages"><NavList groups={groups} badges={badges} onNavigate={() => setDrawer(false)} /></nav>
      </Drawer>
    </div>
  );
}
