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
  const [open, setOpen] = useState(false);
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
      <button type="button" className="icon-btn" style={{ width: 44 }} aria-haspopup="menu" aria-expanded={open} aria-label="Account menu" onClick={() => setOpen((o) => !o)}>
        <span className="avatar">{initials(user)}</span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head"><strong>{user.firstName} {user.lastName}</strong><span>{user.email}</span></div>
          {mode === 'customer' && <Link to="/app/profile" role="menuitem" onClick={() => setOpen(false)}><Icon name="user" size={18} /> Profile</Link>}
          <Link to={mode === 'customer' ? '/app/security' : '/admin/security-center'} role="menuitem" onClick={() => setOpen(false)}><Icon name="shield" size={18} /> Security</Link>
          <button type="button" role="menuitem" onClick={async () => { await logout(); nav('/login'); }}><Icon name="logout" size={18} /> Sign out</button>
        </div>
      )}
    </div>
  );
}

/**
 * Responsive application frame. Desktop: persistent sidebar. Phones/tablets: top bar with a hamburger for secondary
 * pages, plus a bottom tab bar for the four most-used destinations.
 */
export default function Shell({ mode, groups, bottomItems, footerNote }) {
  const { user } = useAuth();
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
          {mode === 'customer' && (
            <Link to="/app/notifications" className="icon-btn bell" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
              <Icon name="bell" />{unread > 0 && <span className="bell-dot" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
            </Link>
          )}
          <UserMenu mode={mode} />
        </header>
        <main id="main" ref={main} tabIndex={-1} className="content" style={{ outline: 'none' }}>
          <ErrorBoundary resetKey={loc.pathname}><Outlet /></ErrorBoundary>
          {mode === 'customer' && (
            <p className="disclosure">
              Balances shown are records in EWB Bank’s internal software ledger and are not bank deposits. EWB Bank is not currently a licensed or insured depository institution.
              Withdrawal requests are reviewed by customer support; no external transfers are performed automatically.
            </p>
          )}
        </main>
        <nav className="bottom-nav" aria-label="Quick navigation">
          {bottomItems.map((it) => (
            <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `bottom-item ${isActive ? 'active' : ''}`}><Icon name={it.icon} size={22} /><span>{it.short || it.label}</span></NavLink>
          ))}
          <button type="button" className={`bottom-item ${drawer ? 'active' : ''}`} onClick={() => setDrawer(true)} aria-haspopup="dialog"><Icon name="menu" size={22} /><span>More</span></button>
        </nav>
      </div>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title={`${user.firstName} ${user.lastName}`}>
        <nav aria-label="All pages"><NavList groups={groups} badges={badges} onNavigate={() => setDrawer(false)} /></nav>
      </Drawer>
    </div>
  );
}
