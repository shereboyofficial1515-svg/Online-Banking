import { useMemo } from 'react';
import Combobox from './ui/Combobox.jsx';
import Icon from './ui/Icon.jsx';
import { useToast } from './ui/Toast.jsx';
import { usePrefs } from '../lib/PreferencesProvider.jsx';
import { LANGUAGES, languageInfo, coverage } from '../lib/i18n.js';

/**
 * Searchable language picker (native name + English name). Choosing a language applies it at once and saves it: to the account
 * for signed-in customers, to this browser for visitors. It changes only the text and formats shown, never any stored value.
 * `compact` renders a small globe button (used in headers). Languages whose translations are still awaiting professional
 * review are labelled "Beta" with their coverage.
 */
export default function LanguageSelect({ compact = false, id }) {
  const { prefs, save, t } = usePrefs();
  const toast = useToast();
  const options = useMemo(() => LANGUAGES.map((l) => ({
    value: l.code, label: `${l.native} ${l.name}`, search: `${l.native} ${l.name} ${l.code} ${l.region}`,
    render: () => (
      <span className="lang-opt" lang={l.code} dir={l.dir}>
        <span className="lang-native">{l.native}</span>
        <span className="lang-name">{l.name}{l.review === 'pending' ? ` · ${Math.round(coverage(l.code) * 100)}%` : ''}</span>
        {l.review === 'pending' && <span className="lang-beta" title={t('lang.beta')}>Beta</span>}
      </span>
    ),
  })), [t]);
  const info = languageInfo(prefs.language);
  const choose = async (code) => {
    if (code === prefs.language) return;
    try { await save({ language: code }); } catch (e) { toast.error(e.message); }
  };
  return (
    <Combobox id={id} className={compact ? 'combo-compact' : ''} triggerClassName={compact ? 'icon-btn lang-trigger' : ''} label={compact ? t('lang.change') : t('lang.label')}
      searchLabel={t('lang.search')} emptyText={t('lang.none')} value={prefs.language} options={options} onChange={choose}
      renderSelected={() => (compact
        ? <span className="lang-compact"><Icon name="globe" size={18} /><span>{info.code.toUpperCase()}</span></span>
        : <span className="lang-opt"><span className="lang-native" lang={info.code} dir={info.dir}>{info.native}</span><span className="lang-name">{info.name}</span></span>)} />
  );
}
