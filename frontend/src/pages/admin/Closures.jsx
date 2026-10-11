// Admin: account-closure requests raised from customer settings. Completing one marks the account closed (history is kept).
import { useState } from 'react';
import { Button, Field, Textarea } from '../../components/ui/Controls.jsx';
import { Alert, Card, EmptyState, ErrorState, PageHeader, SkeletonRows } from '../../components/ui/Feedback.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { Modal } from '../../components/ui/Overlay.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { api } from '../../lib/api.js';
import { relativeTime } from '../../lib/format.js';

export function AdminClosures() {
  useDocumentTitle('Account closures');
  const toast = useToast();
  const { data, loading, error, refetch, reload } = useApi('/api/admin/account-closures');
  const [sel, setSel] = useState(null);
  const [decision, setDecision] = useState('complete');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async () => {
    setBusy(true);
    try { await api.post(`/api/admin/account-closures/${sel.id}`, { decision, ...(note ? { note } : {}) }); toast.success(decision === 'complete' ? 'Account closed.' : 'Request declined.'); setSel(null); setNote(''); reload(); }
    catch (ex) { toast.error(ex.message); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <PageHeader title="Account closures" subtitle="Requests from customers. An account can only be closed when its balance is zero and nothing is on hold." />
      {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <Card pad={false} className="card-flush">
          <DataTable rows={data.items} caption="Closure requests" empty={<EmptyState icon="wallet" title="No closure requests" />} columns={[
            { key: 'customer', header: 'Customer', render: (r) => <span><strong>{r.customer}</strong><br /><span className="muted small">{r.email}</span></span> },
            { key: 'account', header: 'Account', render: (r) => <span>{r.accountName}<br /><span className="mono small">{r.accountNumber}</span></span> },
            { key: 'reason', header: 'Reason', render: (r) => r.reason || '—' },
            { key: 'createdAt', header: 'Requested', render: (r) => relativeTime(r.createdAt) },
            { key: 'act', header: '', className: 'num', render: (r) => <Button size="sm" variant="secondary" onClick={() => { setSel(r); setDecision('complete'); }}>Review</Button> },
          ]} />
        </Card>
      )}
      <Modal open={!!sel} onClose={() => setSel(null)} title="Review closure request" footer={<><Button variant="ghost" onClick={() => setSel(null)}>Cancel</Button><Button onClick={decide} loading={busy} variant={decision === 'complete' ? 'primary' : 'secondary'}>{decision === 'complete' ? 'Close account' : 'Decline request'}</Button></>}>
        {sel && (<>
          <p><strong>{sel.customer}</strong> · {sel.accountName} · <span className="mono">{sel.accountNumber}</span></p>
          <Alert tone="info">Closing marks the account closed. Transaction history stays on record. The balance is re-checked and must be zero.</Alert>
          <fieldset className="choices"><legend>Decision</legend>
            <div className="choice-grid">{[['complete', 'Close the account'], ['decline', 'Decline the request']].map(([v, l]) => <label key={v} className={`choice ${decision === v ? 'on' : ''}`}><input type="radio" name="decision" checked={decision === v} onChange={() => setDecision(v)} /><span><strong>{l}</strong></span></label>)}</div>
          </fieldset>
          <Field label={decision === 'decline' ? 'Message to the customer (shown in their notification)' : 'Internal note (optional)'}>{(a) => <Textarea {...a} rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </>)}
      </Modal>
    </div>
  );
}
