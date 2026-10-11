// Admin: management-controlled feature switches. The backend enforces them; this page only changes the stored setting.
import { useState } from 'react';
import { Button } from '../../components/ui/Controls.jsx';
import { Alert, Badge, Card, ErrorState, PageHeader, SkeletonCard } from '../../components/ui/Feedback.jsx';
import ReasonDialog from '../../components/ReasonDialog.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { api } from '../../lib/api.js';
import { dateTime } from '../../lib/format.js';

export function AdminFeatures() {
  useDocumentTitle('Features');
  const toast = useToast();
  const { data, loading, error, refetch, reload } = useApi('/api/admin/features/savings');
  const [open, setOpen] = useState(false);
  if (loading) return <SkeletonCard lines={4} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const on = data.enabled;
  const run = async ({ reason }) => {
    await api.put('/api/admin/features/savings', { enabled: !on, reason });
    toast.success(on ? 'Savings is now unavailable to customers.' : 'Savings is now available to customers.');
    reload();
  };
  return (
    <div className="stack" style={{ maxWidth: 760 }}>
      <PageHeader title="Features" subtitle="Switch customer features on or off without a new deployment. Every change is recorded in the audit log." />
      <Card title="Savings feature availability" action={<Badge tone={on ? 'success' : 'neutral'}>{on ? 'Enabled' : 'Disabled'}</Badge>}>
        <p>While disabled, customers cannot open savings accounts or move money into savings, and they see: <em>“Savings is not available at the moment. Please check back later for updates.”</em></p>
        <ul className="muted small">
          <li>Existing savings accounts and their history are never changed or deleted by this switch.</li>
          <li>Money can still be moved <em>out of</em> an existing savings account, and normal transfers are unaffected.</li>
          <li>The setting is enforced by the server, so it cannot be bypassed from the website or the API.</li>
        </ul>
        <p className="muted small">{data.configured ? <>Last changed {dateTime(data.updatedAt)}{data.updatedBy ? ` by ${data.updatedBy}` : ''}.</> : 'Never enabled: savings has stayed off since launch.'}</p>
        {!on && <Alert tone="warning">Turning savings on makes it available to every customer immediately.</Alert>}
        <Button variant={on ? 'secondary' : 'primary'} onClick={() => setOpen(true)}>{on ? 'Disable savings' : 'Enable savings'}</Button>
      </Card>
      <ReasonDialog open={open} onClose={() => setOpen(false)} title={on ? 'Disable savings?' : 'Enable savings?'} confirmLabel={on ? 'Disable' : 'Enable'} onSubmit={run}
        description={on ? 'Customers will no longer be able to open savings accounts or deposit into savings.' : 'Customers will be able to open savings accounts and move money into savings.'} />
    </div>
  );
}
