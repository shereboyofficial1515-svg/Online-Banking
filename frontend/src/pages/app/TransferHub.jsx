// Transfer area: three explicit options. Each opens its own workflow; none of them claims a result the backend has not confirmed.
//   To EWB  : existing internal transfer (backend validates the recipient, balance, verification and limits).
//   To Bank : the other-bank details form. No external payment provider is connected, so after the maintenance check the backend answers
//             "not available yet"; nothing is debited, recorded or described as sent.
//   Save    : moves money between the customer's own accounts and a savings account. Management switches the feature on or off;
//             the backend enforces that switch, and this page only reflects it.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Card, ErrorState, PageHeader, SkeletonCard } from '../../components/ui/Feedback.jsx';
import { Button } from '../../components/ui/Controls.jsx';
import Icon from '../../components/ui/Icon.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { Transfers } from './Money.jsx';
import MaintenanceNotice from '../../components/MaintenanceNotice.jsx';
import { Field, Input, Select } from '../../components/ui/Controls.jsx';
import { money } from '../../lib/format.js';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { api, fieldErrors } from '../../lib/api.js';
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
  const transfersOn = features.data?.transfers?.enabled === true;
  const transferTag = features.loading ? '…' : transfersOn ? t('transfer.tag.ready') : t('transfer.tag.maint');
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <PageHeader title={t('transfer.title')} subtitle={t('transfer.subtitle')} />
      <div className="transfer-cards" role="list">
        <div role="listitem"><OptionCard to="/app/transfers/ewb" icon="swap" title={t('transfer.ewb')} desc={t('transfer.ewb.desc')} tag={transferTag} tone={transfersOn ? 'ready' : 'off'} /></div>
        <div role="listitem"><OptionCard to="/app/transfers/bank" icon="bank" title={t('transfer.bank')} desc={t('transfer.bank.desc')} tag={transferTag} tone={transfersOn ? 'ready' : 'off'} /></div>
        <div role="listitem"><OptionCard to="/app/transfers/save" icon="wallet" title={t('transfer.save')} desc={t('transfer.save.desc')} tag={features.loading ? '…' : savingsOn ? t('transfer.tag.ready') : t('transfer.tag.off')} tone={savingsOn ? 'ready' : 'off'} /></div>
      </div>
    </div>
  );
}

export function BankTransfer() {
  const { t } = usePrefs();
  useDocumentTitle(t('transfer.bank'));
  const features = useApi('/api/features');
  const acc = useApi('/api/accounts');
  const [f, setF] = useState({ fromAccountId: '', bankName: '', accountName: '', accountNumber: '', amount: '' });
  const [fe, setFe] = useState({});
  const [busy, setBusy] = useState(false);
  const [maint, setMaint] = useState(null);
  const [notice, setNotice] = useState(null);
  if (acc.loading) return <SkeletonCard lines={4} />;
  if (acc.error) return <ErrorState error={acc.error} onRetry={acc.refetch} />;
  const sources = (acc.data?.accounts || []).filter((a) => a.status === 'active' && a.type !== 'savings');
  const from = sources.find((a) => a.id === (f.fromAccountId || sources[0]?.id));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault(); setNotice(null);
    const v = {};
    if (f.bankName.trim().length < 2) v.bankName = t('form.invalid');
    if (f.accountName.trim().length < 2) v.accountName = t('form.invalid');
    if (!/^\d{6,20}$/.test(f.accountNumber.trim())) v.accountNumber = t('form.invalid');
    if (!/^\d{1,9}(\.\d{1,2})?$/.test(f.amount) || Number(f.amount) <= 0) v.amount = t('form.invalid');
    setFe(v);
    if (Object.keys(v).length || !from) return;
    // Only now, when the customer tries to proceed, does the maintenance state show (the server enforces it regardless).
    if (features.data && features.data.transfers?.enabled === false) { setMaint({ email: features.data.supportEmail }); return; }
    setBusy(true);
    try {
      await api.post('/api/transactions/external-transfers', { fromAccountId: from.id, bankName: f.bankName, accountName: f.accountName, accountNumber: f.accountNumber.trim(), amount: f.amount });
    } catch (ex) {
      if (ex.code === 'TRANSFERS_UNAVAILABLE') setMaint({ email: ex.details?.supportEmail ?? features.data?.supportEmail ?? null });
      else { setFe(fieldErrors(ex)); setNotice(ex.message); }
    } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <Link to="/app/transfers" className="settings-back"><Icon name="chevron-left" size={16} className="flip-rtl" /> {t('transfer.all')}</Link>
      <PageHeader title={t('transfer.bank')} subtitle={t('bank.intro')} />
      {maint && <MaintenanceNotice email={maint.email} onClose={() => setMaint(null)} />}
      {notice && <Alert tone="info">{notice}</Alert>}
      <Card>
        <form onSubmit={submit} noValidate>
          <Field label={t('transfer.from')} required>{(p) => <Select {...p} value={from?.id || ''} onChange={set('fromAccountId')} disabled={!sources.length}>{sources.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.accountNumber.slice(-4)}) — {money(a.availableBalance, a.currency)}</option>)}</Select>}</Field>
          <Field label={t('bank.name')} error={fe.bankName} required>{(p) => <Input {...p} autoComplete="off" value={f.bankName} onChange={set('bankName')} />}</Field>
          <Field label={t('bank.holder')} error={fe.accountName} required>{(p) => <Input {...p} autoComplete="off" value={f.accountName} onChange={set('accountName')} />}</Field>
          <Field label={t('bank.number')} error={fe.accountNumber} required>{(p) => <Input {...p} dir="ltr" inputMode="numeric" autoComplete="off" value={f.accountNumber} onChange={set('accountNumber')} />}</Field>
          <Field label={`${t('transfer.amount')} (${from?.currency ?? 'USD'})`} error={fe.amount} required>{(p) => <Input {...p} dir="ltr" inputMode="decimal" autoComplete="off" placeholder="0.00" value={f.amount} onChange={set('amount')} />}</Field>
          <Button type="submit" size="lg" icon="send" loading={busy} disabled={!from} style={{ width: '100%' }}>{t('bank.continue')}</Button>
        </form>
      </Card>
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
