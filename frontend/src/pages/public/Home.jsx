import { useRef, useState } from 'react';
import Icon from '../../components/ui/Icon.jsx';
import { Button } from '../../components/ui/Controls.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useSite } from '../../lib/site.jsx';
import { useEnter } from '../../lib/motion.js';
import { useDocumentTitle } from '../../lib/hooks.js';

/** A configured link: in-site paths use the router, https links open normally. */
export function LinkButton({ to, ...rest }) {
  return /^https?:/i.test(to) ? <Button href={to} rel="noopener noreferrer" {...rest} /> : <Button to={to} {...rest} />;
}

/**
 * Hero background: the administrator's uploaded image when one is published, otherwise the bundled, licensed photograph
 * (responsive WebP with a JPEG fallback). If the image fails to load the navy background and overlay remain, so text stays readable.
 */
function HeroMedia({ src, alt }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <div className="hero-media" aria-hidden={alt ? undefined : true}>
      {src ? <img src={src} alt={alt} decoding="async" fetchpriority="high" onError={() => setFailed(true)} /> : (
        <picture>
          <source type="image/webp" srcSet="/images/hero-640.webp 640w, /images/hero-1280.webp 1280w, /images/hero-1920.webp 1920w" sizes="100vw" />
          <img src="/images/hero-1280.jpg" srcSet="/images/hero-1280.jpg 1280w, /images/hero-1920.jpg 1920w" sizes="100vw" alt={alt} width="1920" height="900" decoding="async" fetchpriority="high" onError={() => setFailed(true)} />
        </picture>
      )}
      <div className="hero-overlay" />
    </div>
  );
}

const Ticks = ({ items }) => <ul className="ticks">{items.map((t) => <li key={t}><Icon name="check-circle" /><span>{t}</span></li>)}</ul>;
const Cards = ({ items, cols = 3 }) => <div className={`grid grid-${cols}`}>{items.map((c) => <article key={c.title} className="feature"><div className="ic"><Icon name={c.icon} /></div><h3>{c.title}</h3><p>{c.text}</p></article>)}</div>;

export default function Home() {
  useDocumentTitle('');
  const root = useRef(null);
  const { user } = useAuth();
  const { config, assetUrl } = useSite();
  const h = config.home;
  useEnter(root, []);
  const email = config.contact.email;
  return (
    <div ref={root}>
      <section className="hero">
        <HeroMedia src={assetUrl(h.heroImageAssetId)} alt="" />
        <div className="hero-inner">
          <div>
            {h.eyebrow && <span className="eyebrow" data-animate><Icon name="shield-check" size={16} /> {h.eyebrow}</span>}
            <h1 data-animate>{h.headline}</h1>
            <p className="lead" data-animate>{h.description}</p>
            <div className="hero-actions" data-animate>
              {user ? <Button to={user.isStaff ? '/admin' : '/app'} size="lg" variant="accent">Open dashboard</Button> : (
                <>
                  <LinkButton to={h.primaryButton.to} size="lg" variant="accent">{h.primaryButton.label}</LinkButton>
                  {h.secondaryButton.label && h.secondaryButton.to && <LinkButton to={h.secondaryButton.to} size="lg" variant="secondary">{h.secondaryButton.label}</LinkButton>}
                </>
              )}
            </div>
          </div>
          {h.protections.length > 0 && (
            <aside className="hero-card" data-animate aria-label="How your account is protected">
              <h2 style={{ color: '#fff', fontSize: '1rem', marginBottom: 6 }}>How your profile is protected</h2>
              {h.protections.map((p) => (
                <div key={p.label} className="mini"><span><Icon name="check" size={16} style={{ display: 'inline', verticalAlign: '-3px', color: '#5FD3BC' }} /> {p.label}</span><strong>{p.value}</strong></div>
              ))}
            </aside>
          )}
        </div>
      </section>

      <section className="section" id="about">
        <div className="section-inner split">
          <div><div className="section-head"><h2>{h.about.title}</h2><p>{h.about.text}</p></div></div>
          <Ticks items={h.about.points} />
        </div>
      </section>

      {h.services.items.length > 0 && (
        <section className="section alt" id="services">
          <div className="section-inner">
            <div className="section-head"><h2>{h.services.title}</h2><p>{h.services.intro}</p></div>
            <Cards items={h.services.items} />
          </div>
        </section>
      )}

      <section className="section" id="security">
        <div className="section-inner split">
          <div>
            <div className="section-head"><h2>{h.security.title}</h2><p>{h.security.intro}</p></div>
            <Ticks items={h.security.points} />
            <Button to="/security-info" variant="secondary" style={{ marginTop: 12 }}>Read our security information</Button>
          </div>
          <Cards items={h.digital.items.slice(0, 4)} cols={2} />
        </div>
      </section>

      {h.digital.items.length > 0 && (
        <section className="section alt" id="digital">
          <div className="section-inner">
            <div className="section-head"><h2>{h.digital.title}</h2><p>{h.digital.intro}</p></div>
            <Cards items={h.digital.items} />
          </div>
        </section>
      )}

      {h.faq.items.length > 0 && (
        <section className="section" id="faq">
          <div className="section-inner" style={{ maxWidth: 820 }}>
            <div className="section-head"><h2>{h.faq.title}</h2></div>
            <div className="faq">{h.faq.items.map((f) => <details key={f.q}><summary>{f.q}</summary><div className="ans">{f.a}</div></details>)}</div>
          </div>
        </section>
      )}

      <section className="section alt" id="contact">
        <div className="section-inner split">
          <div className="section-head" style={{ marginBottom: 0 }}>
            <h2>{h.contactSection.title}</h2>
            <p>{h.contactSection.text}</p>
            <div className="row" style={{ marginTop: 16 }}>
              {email && <Button href={`mailto:${email}`} variant="secondary" icon="mail">{email}</Button>}
              <Button to={user ? '/app/support' : '/login'} variant="primary" icon="lifebuoy">Customer support</Button>
            </div>
          </div>
          <div className="notice"><strong>Stay safe:</strong> {config.brand.siteName} will never ask for your password, one-time codes or full account numbers by email, phone or chat.</div>
        </div>
      </section>
    </div>
  );
}
