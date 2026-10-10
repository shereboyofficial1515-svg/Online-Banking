import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/Controls.jsx';
import { Alert, Badge, Card, EmptyState, ErrorState, PageHeader, SkeletonCard, SkeletonRows } from '../../components/ui/Feedback.jsx';
import { ConfirmDialog, Modal } from '../../components/ui/Overlay.jsx';
import Icon from '../../components/ui/Icon.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useApi, useDocumentTitle } from '../../lib/hooks.js';
import { api, apiUrl, fieldErrors } from '../../lib/api.js';
import { dateTime, relativeTime, titleCase } from '../../lib/format.js';

export const CATEGORIES = [['account', 'Account'], ['transactions', 'Transactions'], ['withdrawals', 'Withdrawals'], ['verification', 'Identity verification'], ['security', 'Security'], ['technical', 'Technical issue'], ['other', 'Something else']];

/** Attachment picker used by both customer and staff replies. */
export function Attachments({ files, setFiles }) {
  const ref = useRef(null);
  const toast = useToast();
  const pick = (e) => {
    const picked = [...e.target.files]; e.target.value = '';
    const next = [...files, ...picked].slice(0, 3);
    if (next.some((f) => f.size > 5 * 1024 * 1024)) { toast.error('Each file must be 5 MB or smaller.'); return; }
    setFiles(next);
  };
  return (
    <div className="stack-sm" style={{ marginBottom: 16 }}>
      <input ref={ref} className="file-input" type="file" multiple accept="image/png,image/jpeg,image/webp,application/pdf" onChange={pick} aria-label="Attach files" />
      <div className="row"><Button variant="secondary" size="sm" icon="paperclip" onClick={() => ref.current.click()} disabled={files.length >= 3}>Attach files</Button><span className="muted small">JPEG, PNG, WebP or PDF · up to 3 files, 5 MB each</span></div>
      {files.length > 0 && <div className="chips">{files.map((f, i) => <span key={i} className="chip"><Icon name="file" size={14} />{f.name}<button type="button" className="icon-btn" style={{ width: 22, height: 22 }} aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button></span>)}</div>}
    </div>
  );
}

export function SupportList() {
  useDocumentTitle('Customer support');
  const { data, loading, error, refetch } = useApi('/api/support');
  const nav = useNavigate();
  return (
    <div className="stack">
      <PageHeader title="Customer support" subtitle="Get help with your account, transactions or withdrawal requests." actions={<Button to="/app/support/new" icon="plus">New request</Button>} />
      {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <Card pad={false} className="card-flush">
          <DataTable rows={data.tickets} caption="Your support requests" onRowClick={(t) => nav(`/app/support/${t.id}`)} columns={[
            { key: 'reference', header: 'Reference', render: (t) => <span className="mono">{t.reference}</span> },
            { key: 'subject', header: 'Subject', render: (t) => <strong>{t.subject}</strong> },
            { key: 'category', header: 'Category', render: (t) => titleCase(t.category) },
            { key: 'status', header: 'Status', render: (t) => <Badge status={t.status} /> },
            { key: 'updatedAt', header: 'Updated', render: (t) => relativeTime(t.updatedAt) },
          ]} empty={<EmptyState icon="lifebuoy" title="No support requests" action={<Button to="/app/support/new">Open a request</Button>}>Need help? Open a request and we’ll get back to you.</EmptyState>} />
        </Card>
      )}
    </div>
  );
}

export function NewTicket() {
  useDocumentTitle('New support request');
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ category: 'account', subject: '', message: '' });
  const [files, setFiles] = useState([]);
  const [fe, setFe] = useState({});
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr(null); setFe({});
    const fd = new FormData(); Object.entries(f).forEach(([k, v]) => fd.append(k, v)); files.forEach((x) => fd.append('attachments', x));
    try { const r = await api.upload('/api/support', fd); toast.success('Request submitted.'); nav(`/app/support/${r.ticket.id}`); }
    catch (ex) { setErr(ex); setFe(fieldErrors(ex)); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ maxWidth: 720 }}>
      <PageHeader title="New support request" actions={<Button to="/app/support" variant="secondary" icon="chevron-left">Back</Button>} />
      <Alert tone="info">Never include your password or one-time codes in a message. We will never ask for them.</Alert>
      {err && !Object.keys(fe).length && <Alert tone="danger">{err.message}</Alert>}
      <Card>
        <form onSubmit={submit} noValidate>
          <Field label="Category" error={fe.category} required>{(p) => <Select {...p} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
          <Field label="Subject" error={fe.subject} required>{(p) => <Input {...p} maxLength={120} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />}</Field>
          <Field label="How can we help?" error={fe.message} hint="Include references (for example a transaction reference) if you have them." required>{(p) => <Textarea {...p} maxLength={5000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />}</Field>
          <Attachments files={files} setFiles={setFiles} />
          <Button type="submit" loading={busy} size="lg">Submit request</Button>
        </form>
      </Card>
    </div>
  );
}

export function Thread({ messages, base }) {
  return (
    <div className="thread" role="log" aria-label="Conversation">
      {messages.map((m) => (
        <div key={m.id} className={`msg ${m.authorType} ${m.internal ? 'internal' : ''}`}>
          <div className="msg-meta"><strong>{m.staffName || m.author}</strong>{m.internal && ' · Internal note'} · {dateTime(m.createdAt)}</div>
          <p>{m.body}</p>
          {m.attachments?.length > 0 && <div className="chips" style={{ marginTop: 8 }}>{m.attachments.map((a) => <a key={a.id} className="chip" href={apiUrl(`${base}/attachments/${a.id}`)} download><Icon name="paperclip" size={14} />{a.filename}</a>)}</div>}
        </div>
      ))}
    </div>
  );
}

export function SupportTicket() {
  const { id } = useParams();
  const toast = useToast();
  const { data, loading, error, refetch, reload } = useApi(`/api/support/${id}`);
  const [message, setMessage] = useState('');
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [fe, setFe] = useState({});
  const [closing, setClosing] = useState(false);
  useDocumentTitle('Support request');
  if (loading) return <SkeletonCard lines={5} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const t = data.ticket;
  const send = async (e) => {
    e.preventDefault(); setBusy(true); setFe({});
    const fd = new FormData(); fd.append('message', message); files.forEach((x) => fd.append('attachments', x));
    try { await api.upload(`/api/support/${id}/replies`, fd); setMessage(''); setFiles([]); reload(); } catch (ex) { setFe(fieldErrors(ex)); toast.error(ex.message); } finally { setBusy(false); }
  };
  return (
    <div className="stack" style={{ maxWidth: 820 }}>
      <PageHeader title={t.subject} subtitle={<><span className="mono">{t.reference}</span> · {titleCase(t.category)} · opened {dateTime(t.createdAt)}</>} actions={<><Badge status={t.status} /><Button to="/app/support" variant="secondary" size="sm" icon="chevron-left">All requests</Button></>} />
      <Card><Thread messages={t.messages} base="/api/support" /></Card>
      {t.status === 'closed' ? <Alert tone="info">This request is closed. <Link to="/app/support/new">Open a new request</Link> if you need more help.</Alert> : (
        <Card title="Reply">
          <form onSubmit={send} noValidate>
            <Field label="Your message" error={fe.message} required>{(p) => <Textarea {...p} style={{ minHeight: 100 }} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />}</Field>
            <Attachments files={files} setFiles={setFiles} />
            <div className="row"><Button type="submit" loading={busy} icon="send">Send reply</Button><Button type="button" variant="ghost" onClick={() => setClosing(true)}>Close request</Button></div>
          </form>
        </Card>
      )}
      <ConfirmDialog open={closing} onClose={() => setClosing(false)} title="Close this request?" message="You can open a new request at any time if you need more help." confirmLabel="Close request" onConfirm={async () => { await api.post(`/api/support/${id}/close`); toast.success('Request closed.'); reload(); }} />
    </div>
  );
}

export { Modal };
