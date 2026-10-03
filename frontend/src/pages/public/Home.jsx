import { useRef } from 'react';
import Icon from '../../components/ui/Icon.jsx';
import { Button } from '../../components/ui/Controls.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useEnter } from '../../lib/motion.js';
import { useDocumentTitle } from '../../lib/hooks.js';

const services = [
  ['wallet', 'Everyday accounts', 'Open a checking account and track balances, activity and statements-ready transaction history in one place.'],
  ['swap', 'Account-to-account transfers', 'Move value between EWB accounts instantly, with a unique reference and a notification for both parties.'],
  ['upload', 'Withdrawal requests', 'Submit a withdrawal request and follow its review status. Requests are processed by our team; nothing is sent automatically.'],
  ['id', 'Identity verification', 'Complete verification once and unlock transfers. Documents are stored privately and reviewed by compliance staff.'],
  ['bell', 'Alerts and notifications', 'Choose which updates you receive. Security notices are always on so you can spot unexpected activity quickly.'],
  ['lifebuoy', 'Customer support', 'Open a request, attach documents and follow the conversation with a dedicated support team.'],
];
const features = [
  ['fingerprint', 'Passkey sign-in', 'Use your fingerprint, face or device PIN. Your biometric never leaves your device.'],
  ['shield-check', 'Multi-factor authentication', 'Add an authenticator app and single-use recovery codes to protect your profile.'],
  ['device', 'Session and device control', 'See where you are signed in and end any session in one tap.'],
  ['clipboard', 'Auditable ledger', 'Ledger entries are append-only. Corrections are made with new, traceable entries.'],
  ['lock', 'Privacy by design', 'We collect only what is needed and keep verification files in private storage.'],
  ['zap', 'Fast on every screen', 'A responsive experience for phones, tablets and desktops with accessible controls.'],
];
const faqs = [
  ['Is EWB Bank a licensed bank? Are deposits insured?', 'No. EWB Bank currently operates an internal software ledger. We are not a licensed depository institution and balances are not insured deposits. We will only offer regulated banking services after the necessary licences, banking-partner agreements and compliance programmes are in place, and we will update this page when that happens.'],
  ['What do the balances in my account represent?', 'They are entries in EWB Bank’s internal ledger. Balances are always calculated from immutable ledger entries, never edited directly.'],
  ['Can I withdraw money to my external bank account?', 'Not automatically. You can submit a withdrawal request, which our customer support and review teams handle. The status shown always reflects what has actually happened; we never show a transfer as sent unless it was.'],
  ['How does passkey sign-in work?', 'Your device creates a cryptographic key pair. We store only the public key. Fingerprint or face checks happen on your device, and we never receive biometric data.'],
  ['How do you verify my identity?', 'You upload an ID document and selfie, or complete a check with a verification provider once one is connected. We keep only the minimum information required and notify you of the outcome by email.'],
  ['What should I do if I notice unusual activity?', 'Change your password, end other sessions from the Security page, and contact customer support. We will never ask for your password or one-time codes.'],
];

export default function Home() {
  useDocumentTitle('');
  const root = useRef(null);
  const { user, config } = useAuth();
  useEnter(root, []);
  const email = config?.supportEmail;
  return (
    <div ref={root}>
      <section className="hero">
        <div className="hero-inner">
          <div>
            <span className="eyebrow" data-animate><Icon name="shield-check" size={16} /> Security-first digital banking</span>
            <h1 data-animate>Banking that keeps you in control.</h1>
            <p className="lead" data-animate>EWB Bank brings your accounts, transfers and support into one calm, secure place — with passkeys, multi-factor authentication and a fully auditable ledger.</p>
            <div className="hero-actions" data-animate>
              {user ? <Button to={user.isStaff ? '/admin' : '/app'} size="lg" variant="accent">Open dashboard</Button> : (<><Button to="/register" size="lg" variant="accent">Open an account</Button><Button to="/login" size="lg" variant="secondary">Sign in</Button></>)}
            </div>
          </div>
          <aside className="hero-card" data-animate aria-label="How your account is protected">
            <h2 style={{ color: '#fff', fontSize: '1rem', marginBottom: 6 }}>How your profile is protected</h2>
            {[['Passkey or password sign-in', 'Strong'], ['Authenticator-app MFA', 'Available'], ['New-device alerts', 'Always on'], ['Append-only audit trail', 'Always on']].map(([a, b]) => (
              <div key={a} className="mini"><span><Icon name="check" size={16} style={{ display: 'inline', verticalAlign: '-3px', color: '#5FD3BC' }} /> {a}</span><strong>{b}</strong></div>
            ))}
          </aside>
        </div>
      </section>

      <section className="section" id="about">
        <div className="section-inner split">
          <div><div className="section-head"><h2>A modern bank experience, built carefully</h2><p>EWB Bank is designed for people who want clarity: clear balances, clear history, and clear explanations when something needs review. Every number you see comes from our ledger, and every sensitive action is recorded.</p></div></div>
          <ul className="ticks">
            {['Balances derived from immutable ledger entries', 'Plain-language status for every request', 'No hidden fees on this platform — what you see is what is recorded', 'Honest disclosures about what EWB Bank is and is not'].map((t) => <li key={t}><Icon name="check-circle" /><span>{t}</span></li>)}
          </ul>
        </div>
      </section>

      <section className="section alt" id="services">
        <div className="section-inner">
          <div className="section-head"><h2>Banking services</h2><p>Everything you need to manage your accounts day to day.</p></div>
          <div className="grid grid-3">
            {services.map(([ic, t, d]) => <article key={t} className="feature"><div className="ic"><Icon name={ic} /></div><h3>{t}</h3><p>{d}</p></article>)}
          </div>
        </div>
      </section>

      <section className="section" id="security">
        <div className="section-inner split">
          <div>
            <div className="section-head"><h2>Security you can see and control</h2><p>Protection is not an afterthought. Every layer, from sign-in to the database, is designed to limit what can go wrong and to make anything unusual visible.</p></div>
            <ul className="ticks">
              {['Passkeys (WebAuthn) and TOTP multi-factor authentication', 'Short-lived sessions, rotating tokens and device management', 'Account lock-outs after repeated failed attempts', 'Strict access control: you can only ever see your own records', 'Security alerts by email for new devices and password changes'].map((t) => <li key={t}><Icon name="check-circle" /><span>{t}</span></li>)}
            </ul>
            <Button to="/security-info" variant="secondary" style={{ marginTop: 12 }}>Read our security information</Button>
          </div>
          <div className="grid grid-2">
            {features.slice(0, 4).map(([ic, t, d]) => <article key={t} className="feature"><div className="ic"><Icon name={ic} /></div><h3>{t}</h3><p>{d}</p></article>)}
          </div>
        </div>
      </section>

      <section className="section alt" id="digital">
        <div className="section-inner">
          <div className="section-head"><h2>Digital banking, designed for every screen</h2><p>A touch-friendly experience on your phone with a bottom navigation bar, and a full-featured dashboard on larger screens.</p></div>
          <div className="grid grid-3">
            {features.map(([ic, t, d]) => <article key={t} className="feature"><div className="ic"><Icon name={ic} /></div><h3>{t}</h3><p>{d}</p></article>)}
          </div>
        </div>
      </section>

      <section className="section" id="faq">
        <div className="section-inner" style={{ maxWidth: 820 }}>
          <div className="section-head"><h2>Frequently asked questions</h2></div>
          <div className="faq">{faqs.map(([q, a]) => <details key={q}><summary>{q}</summary><div className="ans">{a}</div></details>)}</div>
        </div>
      </section>

      <section className="section alt" id="contact">
        <div className="section-inner split">
          <div className="section-head" style={{ marginBottom: 0 }}>
            <h2>Contact us</h2>
            <p>Customers can open and track requests from their dashboard. For general questions, reach our team by email and we will reply as soon as we can.</p>
            <div className="row" style={{ marginTop: 16 }}>
              {email && <Button href={`mailto:${email}`} variant="secondary" icon="mail">{email}</Button>}
              <Button to={user ? '/app/support' : '/login'} variant="primary" icon="lifebuoy">Customer support</Button>
            </div>
          </div>
          <div className="notice"><strong>Important:</strong> EWB Bank will never ask for your password, one-time codes or full account numbers by email, phone or chat. EWB Bank operates an internal software ledger and is not currently a licensed or insured depository institution.</div>
        </div>
      </section>
    </div>
  );
}
