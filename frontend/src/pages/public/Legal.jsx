import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDocumentTitle } from '../../lib/hooks.js';
import { Button } from '../../components/ui/Controls.jsx';
import { Alert } from '../../components/ui/Feedback.jsx';
import Markdown from '../../components/Markdown.jsx';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.jsx';
import { useSite } from '../../lib/site.jsx';
import { LEGAL_FALLBACK } from '../../lib/legalDefaults.js';

const longDate = (ymd) => (ymd ? new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${ymd}T00:00:00Z`)) : '');

/** Presentational document shell, shared by the live pages and the admin preview. */
export function LegalDoc({ title, body, effectiveDate, version, preview = false }) {
  useDocumentTitle(preview ? '' : title);
  return (
    <article className="prose">
      <h1>{title}</h1>
      <p className="updated">{effectiveDate && <>Effective {longDate(effectiveDate)}</>}{version ? <> · Version {version}</> : null}</p>
      <Markdown source={body} />
    </article>
  );
}

/** A legal page loaded from the API. If the API is unreachable the built-in text is shown rather than an error. */
function LegalPage({ slug, extra }) {
  const fb = LEGAL_FALLBACK.docs[slug];
  const [doc, setDoc] = useState({ title: fb.title, body: fb.body, effectiveDate: LEGAL_FALLBACK.effectiveDate, version: null });
  useEffect(() => {
    let off = false;
    api.get(`/api/public/legal/${slug}`).then((d) => { if (!off && d?.body) setDoc(d); }).catch(() => {});
    return () => { off = true; };
  }, [slug]);
  return <><LegalDoc {...doc} />{extra}</>;
}

export const Privacy = () => <LegalPage slug="privacy" />;
export const Terms = () => <LegalPage slug="terms" />;
export const Cookies = () => <LegalPage slug="cookies" />;
export const Accessibility = () => <LegalPage slug="accessibility" />;
export function SecurityInfo() {
  const { user } = useAuth();
  return <LegalPage slug="security" extra={<div className="prose" style={{ paddingTop: 0 }}><Button to={user ? '/app/security' : '/login'} variant="secondary">Go to Security settings</Button></div>} />;
}

export function About() {
  const { config } = useSite();
  const a = config.about;
  useDocumentTitle(a.title);
  return (
    <article className="prose">
      <h1>{a.title}</h1>
      {a.intro && <p className="lead">{a.intro}</p>}
      <Markdown source={a.body} />
      <p style={{ marginTop: 24 }}><Button to="/contact" variant="secondary">Contact us</Button></p>
    </article>
  );
}

export function Contact() {
  const { config } = useSite();
  const { user } = useAuth();
  const c = config.contact;
  useDocumentTitle('Contact us');
  return (
    <article className="prose">
      <h1>Contact us</h1>
      <p className="lead">{config.home.contactSection.text}</p>
      <ul>
        {c.email && <li><strong>Email:</strong> <a href={`mailto:${c.email}`}>{c.email}</a></li>}
        {c.phone && <li><strong>Phone:</strong> {c.phone}</li>}
        {c.address && <li><strong>Address:</strong> {c.address}</li>}
        {c.hours && <li><strong>Hours:</strong> {c.hours}</li>}
        {!c.email && !c.phone && !c.address && <li>Customers can reach us from the support area of their account.</li>}
      </ul>
      <p><Button to={user ? '/app/support' : '/login'} variant="primary" icon="lifebuoy">Customer support</Button></p>
      <Alert tone="info" title="Stay safe">We will never ask for your password, one-time codes or full account numbers by email, phone or chat. <Link to="/security-info">Security information</Link></Alert>
    </article>
  );
}

export function NotFound() {
  useDocumentTitle('Page not found');
  return (
    <div className="prose center" style={{ paddingTop: 96 }}>
      <h1>Page not found</h1>
      <p className="muted">The page you are looking for does not exist or has moved.</p>
      <p><Button to="/" variant="primary">Back to home</Button></p>
    </div>
  );
}
