import { passwordChecks } from '../../lib/format.js';
import Icon from './Icon.jsx';

export default function PasswordStrength({ password, email }) {
  const checks = passwordChecks(password, email);
  const score = checks.filter((c) => c.ok).length;
  const label = score <= 2 ? 'Weak' : score <= 4 ? 'Fair' : score === 5 ? 'Good' : 'Strong';
  return (
    <div className="pw-strength" aria-live="polite">
      <div className="pw-bar" role="img" aria-label={`Password strength: ${password ? label : 'not entered'}`}>
        {checks.map((c, i) => <span key={c.id} className={i < score ? `on s${Math.min(score, 6)}` : ''} />)}
      </div>
      <ul className="pw-list">
        {checks.map((c) => <li key={c.id} className={c.ok ? 'ok' : ''}><Icon name={c.ok ? 'check' : 'x'} size={13} /> {c.label}<span className="sr-only">{c.ok ? ' (met)' : ' (not met)'}</span></li>)}
      </ul>
    </div>
  );
}
