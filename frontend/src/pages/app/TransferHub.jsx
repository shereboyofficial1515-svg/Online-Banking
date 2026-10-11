// Transfer area: three explicit options. Each opens its own workflow; none of them claims a result the backend has not confirmed.
//   To EWB  : existing internal transfer (backend validates the recipient, balance, verification and limits).
//   To Bank : the existing withdrawal REQUEST workflow (staff-reviewed). There is no external payment provider connected, so
//             this never says money has moved; the status shown is whatever the backend reports.
//   Save    : moves money between the customer's own accounts and a savings account. Management switches the feature on or off;
//             the backend enforces that switch, and this page only reflects it.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Card, ErrorState, PageHeader, SkeletonCard } from '../../components/ui/Feedback.jsx';
import { Button } from '../../components/ui/Controls.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { Transfers, Withdrawals } from './Money.jsx';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { api } from '../../lib/api.js';
import { usePrefs } from '../../lib/PreferencesProvider.jsx';

function OptionCard({ to, icon, title, desc, tag, tone }) {
  return (
    <Link to={to} className="transfer-card" aria-describedby={undefined}>
      <span className="tc-icon" aria-hidden="true"><Icon name={icon} size={26} /></span>
      <span className="tc-body"><strong>{title}</strong><span className="tc-desc">{desc}</span></span>
      <span className={`tc-tag tc-${tone}`}>{tag}</span>
      <Icon name="chevron-right" size={18} className="tc-go flip-rtl" />
    </Link>
  );
}

export function TransferHub() {
  const { t } = usePrefs();
  useDocumentTitle(t('transfer.title'));
  const features = useApi('/api/features');
  const savingsOn = features.data?.savings?.enabled === true;
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <PageHeader title={t('transfer.title')} subtitle={t('transfer.subtitle')} />
      <div className="transfer-cards" role="list">
        <div role="listitem"><OptionCard to="/app/transfers/ewb" icon="swap" title={t('transfer.ewb')} desc={t('transfer.ewb.desc')} tag={t('transfer.tag.ready')} tone="ready" /></div>
        <div role="listitem"><OptionCard to="/app/transfers/bank" icon="bank" title={t('transfer.bank')} desc={t('transfer.bank.desc')} tag={t('transfer.tag.review')} tone="review" /></div>
        <div role="listitem"><OptionCard to="/app/transfers/save" icon="wallet" title={t('transfer.save')} desc={t('transfer.save.desc')} tag={features.loading ? '…' : savingsOn ? t('transfer.tag.ready') : t('transfer.tag.off')} tone={savingsOn ? 'ready' : 'off'} /></div>
      </div>
    </div>
  );
}

export function BankTransfer() {
  const { t } = usePrefs();
  return (
    <div className="stack">
      <Link to="/app/transfers" className="settings-back"><Icon name="chevron-left" size={16} className="flip-rtl" /> {t('transfer.all')}</Link>
      <Alert tone="info" title={t('transfer.bank')}>{t('transfer.bank.notice')}</Alert>
      <Withdrawals />
    </div>
  );
}

export function SavePage() {
  const { t } = usePrefs();
  const toast = useToast();
  useDocumentTitle(t('save.title'));
  const features = useApi('/api/features');
  const accounts = useApi('/api/accounts', null, { enabled: features.data?.savings?.enabled === true });
  const [busy, setBusy] = useState(false);
  if (features.loading) return <SkeletonCard lines={3} />;
  if (features.error) return <ErrorState error={features.error} onRetry={features.refetch} />;

  if (!features.data?.savings?.enabled) {
    return (
      <div className="stack" style={{ maxWidth: 640 }}>
        <Link to="/app/transfers" className="settings-back"><Icon name="chevron-left" size={16} className="flip-rtl" /> {t('transfer.all')}</Link>
        <PageHeader title={t('save.title')} />
        <Card><div className="savings-off"><span className="tc-icon" aria-hidden="true"><Icon name="lock" size={26} /></span><p role="status">{t('save.unavailable')}</p></div></Card>
      </div>
    );
  }
  if (accounts.loading) return <SkeletonCard lines={3} />;
  if (accounts.error) return <ErrorState error={accounts.error} onRetry={accounts.refetch} />;
  const savings = (accounts.data?.accounts || []).filter((a) => a.type === 'savings' && a.status === 'active');
  const open = async () => {
    setBusy(true);
    try { await api.post('/api/accounts', { type: 'savings' }); toast.success(t('save.open')); accounts.refetch(); }
    catch (ex) { toast.error(ex.message); if (ex.code === 'SAVINGS_UNAVAILABLE') features.refetch(); } finally { setBusy(false); }
  };
  if (!savings.length) {
    return (
      <div className="stack" style={{ maxWidth: 640 }}>
        <Link to="/app/transfers" className="settings-back"><Icon name="chevron-left" size={16} className="flip-rtl" /> {t('transfer.all')}</Link>
        <PageHeader title={t('save.title')} subtitle={t('save.intro')} />
        <Card><p>{t('save.none')}</p><Button onClick={open} loading={busy} icon="plus">{t('save.open')}</Button></Card>
      </div>
    );
  }
  return <Transfers mode="save" savingsAccounts={savings} />;
}
