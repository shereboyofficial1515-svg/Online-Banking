// Admin: management-controlled feature switches. The backend enforces them; this page only changes the stored setting.
import { useState } from 'react';
import { Button } from '../../components/ui/Controls.jsx';
import { Alert, Badge, Card, ErrorState, PageHeader, SkeletonCard } from '../../components/ui/Feedback.jsx';
import ReasonDialog from '../../components/ReasonDialog.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';

function FeatureCard({ name, title, offText, notes, enableWarn }) {
  const toast = useToast();
  const { data, loading, error, refetch, reload } = useApi(`/api/admin/features/${name}`);
  const [open, setOpen] = useState(false);
  if (loading) return <SkeletonCard lines={4} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const on = data.enabled;
  const run = async ({ reason }) => {
    await api.put(`/api/admin/features/${name}`, { enabled: !on, reason });
    toast.success(on ? `${title}: switched off.` : `${title}: switched on.`);
    reload();
  };
  return (
    <>
      <Card title={title} action={<Badge tone={on ? 'success' : 'neutral'}>{on ? 'Available to customers' : 'Unavailable'}</Badge>}>
        <p>{offText}</p>
        <ul className="muted small">{notes.map((n) => <li key={n}>{n}</li>)}</ul>
        <p className="muted small">{data.configured ? <>Last changed {dateTime(data.updatedAt)}{data.updatedBy ? ` by ${data.updatedBy}` : ''}.</> : 'Never switched on: unavailable since launch.'}</p>
        {!on && <Alert tone="warning">{enableWarn}</Alert>}
        <Button variant={on ? 'secondary' : 'primary'} onClick={() => setOpen(true)}>{on ? `Switch off ${title.toLowerCase()}` : `Switch on ${title.toLowerCase()}`}</Button>
      </Card>
      <ReasonDialog open={open} onClose={() => setOpen(false)} title={on ? `Switch off ${title.toLowerCase()}?` : `Switch on ${title.toLowerCase()}?`} confirmLabel={on ? 'Switch off' : 'Switch on'} onSubmit={run}
        description={on ? 'Customers will immediately see the unavailable state and the server will refuse the related requests.' : 'The related requests will be accepted immediately.'} />
    </>
  );
}

export function AdminFeatures() {
  useDocumentTitle('Features');
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <PageHeader title="Features" subtitle="Switch customer services on or off without a new deployment. Every change needs a reason and is recorded in the audit log." />
      <FeatureCard name="transfers" title="Transfers" offText="While unavailable, To EWB and To Bank open normally but, when a customer tries to go ahead, they see the maintenance message with the support address. The server refuses the request: nothing is debited or recorded."
        notes={['Applies to To EWB (internal transfers) and To Bank (other banks).', 'Existing balances and history are not affected.', 'The support address shown comes from the server setting SUPPORT_EMAIL.']}
        enableWarn="Turning transfers on lets customers send money immediately." />
      <FeatureCard name="savings" title="Savings" offText="While unavailable, customers cannot open savings accounts or move money into savings, and the Save button shows: “Savings is currently unavailable. Please check back later.”"
        notes={['Existing savings accounts and their history are never changed or deleted by this switch.', 'Money can still be moved out of an existing savings account.', 'The server enforces the setting, so it cannot be bypassed from the website or the API.']}
        enableWarn="Turning savings on makes it available to every customer immediately." />
    </div>
  );
}
