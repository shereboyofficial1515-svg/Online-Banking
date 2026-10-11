import Icon from './ui/Icon.jsx';
import { usePrefs } from '../lib/PreferencesProvider.jsx';

const OPTIONS = [['light', 'sun', 'Light theme'], ['dark', 'moon', 'Dark theme'], ['system', 'monitor', 'Match my device']];

/** Visible light / dark / system selector. Reused in the public header, auth screens and both application shells. */
export default function ThemeSwitcher({ className = '' }) {
  const { prefs, setTheme } = usePrefs();
  return (
    <div className={`theme-switcher ${className}`} role="radiogroup" aria-label="Colour theme">
      {OPTIONS.map(([value, icon, label]) => (
        <button key={value} type="button" role="radio" aria-checked={prefs.theme === value} aria-label={label} title={label}
          className={`theme-btn ${prefs.theme === value ? 'on' : ''}`} onClick={() => setTheme(value)}>
          <Icon name={icon} size={16} />
        </button>
      ))}
    </div>
  );
}
