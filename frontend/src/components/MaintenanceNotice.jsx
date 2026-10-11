import { Link } from 'react-router-dom';
import Icon from './ui/Icon.jsx';
import { Button } from './ui/Controls.jsx';
import { usePrefs } from '../lib/PreferencesProvider.jsx';

/**
 * Shown only when a customer actually tries to go ahead with a transfer while the backend has transfers in maintenance.
 * `email` is the customer-support address the server has configured; if there is none, no address is invented.
 */
export default function MaintenanceNotice({ email, onClose }) {
  const { t } = usePrefs();
  return (
    <section className="maint" role="alert" aria-labelledby="maint-title">
      <span className="maint-icon" aria-hidden="true"><Icon name="alert" size={26} /></span>
      <div className="maint-body">
        <h2 id="maint-title">{t('maint.title')}</h2>
        <p>{t('maint.text')}</p>
        <p className="maint-contact">
          {email
            ? <>{t('maint.contact')} <a href={`mailto:${email}`} dir="ltr">{email}</a></>
            : <><Link to="/app/support">{t('nav.support')}</Link>. {t('maint.noEmail')}</>}
        </p>
        {onClose && <Button variant="secondary" size="sm" onClick={onClose}>{t('common.close')}</Button>}
      </div>
    </section>
  );
}
