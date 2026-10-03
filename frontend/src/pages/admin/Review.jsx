import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, Field, Input, Select, Textarea } from '../../components/ui/Controls.jsx';
import { Alert, Badge, Card, EmptyState, ErrorState, KeyValue, PageHeader, Pagination, SkeletonCard, SkeletonRows } from '../../components/ui/Feedback.jsx';
import DataTable from '../../components/ui/DataTable.jsx';
import { Modal } from '../../components/ui/Overlay.jsx';
import ReasonDialog from '../../components/ReasonDialog.jsx';
import { Thread, Attachments } from '../app/Support.jsx';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../lib/auth.jsx';
import { useApi, useDebounced, useDocumentTitle } from '../../lib/hooks.js';
import { api, fieldErrors } from '../../lib/api.js';
import { dateTime, relativeTime, titleCase } from '../../lib/format.js';

const LIMIT = 20;

// ───────── Identity verification review ─────────
export function AdminVerification() {
  useDocumentTitle('Verification queue');
  const nav = useNavigate();
  const [status, setStatus] = useState('manual_review');
  const { data, loading, error, refetch } = useApi('/api/admin/verification', { status });
  return (
    <div className="stack">
      <PageHeader title="Identity verification" subtitle="Review documents submitted by customers." />
      <Card><Field label="Status">{(p) => <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['manual_review', 'verification_required', 'pending', 'verified', 'failed', 'expired'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}</Field></Card>
      {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <Card pad={false} className="card-flush">
          <DataTable rows={data.items} caption="Verification queue" onRowClick={(v) => nav(`/admin/verification/${v.id}`)} columns={[
            { key: 'customer', header: 'Customer', render: (v) => <span><strong>{v.customer}</strong><br /><span className="muted small">{v.email}</span></span> },
            { key: 'provider', header: 'Provider', render: (v) => titleCase(v.provider) }, { key: 'status', header: 'Status', render: (v) => <Badge status={v.status} /> }, { key: 'updatedAt', header: 'Updated', render: (v) => relativeTime(v.updatedAt) },
          ]} empty={<EmptyState icon="id" title="Nothing to review" />} />
        </Card>
      )}
    </div>
  );
}

export function AdminVerificationDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { data, loading, error, refetch, reload } = useApi(`/api/admin/verification/${id}`);
  const [decision, setDecision] = useState(null);
  useDocumentTitle('Verification review');
  if (loading) return <SkeletonCard lines={5} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const v = data.verification;
  const reviewable = ['manual_review', 'pending', 'failed'].includes(v.status);
  return (
    <div className="stack">
      <PageHeader title={v.customer} subtitle={<>{v.email} · <Badge status={v.status} /></>} actions={<Button to="/admin/verification" variant="secondary" icon="chevron-left">Queue</Button>} />
      <Alert tone="info">Viewing a document is recorded in the audit log. Do not download or share these files.</Alert>
      <Card title="Submitted documents" data-animate>
        {v.documents.length ? (
          <div className="grid grid-2">{v.documents.map((d) => (
            <figure key={d.id} style={{ margin: 0 }}>
              <figcaption className="muted small" style={{ marginBottom: 6 }}><strong>{titleCase(d.kind)}</strong> · {Math.round(d.size / 1024)} KB · {dateTime(d.uploadedAt)}</figcaption>
              {d.mime === 'application/pdf' ? <a className="btn btn-secondary btn-sm" href={`/api/admin/verification/documents/${d.id}`} target="_blank" rel="noreferrer noopener">Open PDF</a>
                : <img src={`/api/admin/verification/documents/${d.id}`} alt={`${titleCase(d.kind)} submitted by ${v.customer}`} style={{ borderRadius: 12, border: '1px solid var(--line)', maxHeight: 360, width: '100%', objectFit: 'contain', background: 'var(--navy-50)' }} />}
            </figure>))}</div>
        ) : <EmptyState icon="file" title="No documents">{v.provider === 'manual' ? 'The customer has not uploaded any documents yet.' : 'This verification is handled by an external provider.'}</EmptyState>}
      </Card>
      <Card title="Details" data-animate><KeyValue items={[{ label: 'Customer', value: <Link to={`/admin/customers/${v.userId}`}>{v.customer}</Link> }, { label: 'Provider', value: titleCase(v.provider) }, { label: 'Status', value: <Badge status={v.status} /> }, { label: 'Last review note', value: v.reason }, { label: 'Updated', value: dateTime(v.updatedAt) }]} /></Card>
      {reviewable && <Card title="Decision" data-animate><div className="row"><Button onClick={() => setDecision('verified')} disabled={v.status === 'pending'}>Mark as verified</Button><Button variant="secondary" onClick={() => setDecision('verification_required')}>Request resubmission</Button><Button variant="danger" onClick={() => setDecision('failed')}>Mark as failed</Button></div></Card>}
      <ReasonDialog open={!!decision} onClose={() => setDecision(null)} title={`Set status: ${titleCase(decision || '')}`} confirmLabel="Save decision" tone={decision === 'failed' ? 'danger' : 'primary'}
        description="The customer is notified by email with this reason." onSubmit={async ({ reason }) => { await api.post(`/api/admin/verification/${id}/review`, { decision, reason }); toast.success('Decision recorded.'); reload(); }} />
    </div>
  );
}

// ───────── Support ─────────
export function AdminSupport() {
  useDocumentTitle('Support requests');
  const nav = useNavigate();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, loading, error, refetch } = useApi('/api/admin/support', { status, q: dq });
  return (
    <div className="stack">
      <PageHeader title="Support requests" />
      <Card><form className="filters" role="search" onSubmit={(e) => e.preventDefault()} style={{ marginBottom: 0 }}>
        <Field label="Search">{(p) => <Input {...p} type="search" placeholder="Reference, subject or email" value={q} onChange={(e) => setQ(e.target.value)} />}</Field>
        <Field label="Status">{(p) => <Select {...p} value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['open', 'in_progress', 'waiting_for_customer', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}</Field>
      </form></Card>
      {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <Card pad={false} className="card-flush"><DataTable rows={data.tickets} caption="Support requests" onRowClick={(t) => nav(`/admin/support/${t.id}`)} columns={[
          { key: 'reference', header: 'Reference', render: (t) => <span className="mono">{t.reference}</span> }, { key: 'subject', header: 'Subject', render: (t) => <strong>{t.subject}</strong> },
          { key: 'customer', header: 'Customer', render: (t) => t.customer.email }, { key: 'category', header: 'Category', render: (t) => titleCase(t.category) },
          { key: 'status', header: 'Status', render: (t) => <Badge status={t.status} /> }, { key: 'updatedAt', header: 'Updated', render: (t) => relativeTime(t.updatedAt) },
        ]} empty={<EmptyState icon="lifebuoy" title="No requests" />} /></Card>
      )}
    </div>
  );
}

export function AdminTicket() {
  const { id } = useParams();
  const { can, user } = useAuth();
  const toast = useToast();
  const { data, loading, error, refetch, reload } = useApi(`/api/admin/support/${id}`);
  const [message, setMessage] = useState('');
  const [internal, setInternal] = useState(false);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  useDocumentTitle('Support request');
  if (loading) return <SkeletonCard lines={5} />;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const t = data.ticket;
  const send = async (e) => {
    e.preventDefault(); setBusy(true);
    const fd = new FormData(); fd.append('message', message); fd.append('internal', String(internal)); files.forEach((x) => fd.append('attachments', x));
    try { await api.upload(`/api/admin/support/${id}/replies`, fd); setMessage(''); setFiles([]); setInternal(false); reload(); } catch (ex) { toast.error(ex.message); } finally { setBusy(false); }
  };
  const setStatus = async (status) => { try { await api.post(`/api/admin/support/${id}/status`, { status }); reload(); } catch (ex) { toast.error(ex.message); } };
  const assignMe = async () => { try { await api.post(`/api/admin/support/${id}/assign`, { assigneeId: user.id }); toast.success('Assigned to you.'); reload(); } catch (ex) { toast.error(ex.message); } };
  return (
    <div className="stack" style={{ maxWidth: 900 }}>
      <PageHeader title={t.subject} subtitle={<><span className="mono">{t.reference}</span> · <Link to={`/admin/customers/${t.customer.id}`}>{t.customer.name}</Link> · {titleCase(t.category)}</>} actions={<><Badge status={t.status} /><Button to="/admin/support" variant="secondary" size="sm" icon="chevron-left">All requests</Button></>} />
      {can('support.manage') && <Card><div className="row"><Field label="Status" className="" ><Select value={t.status} onChange={(e) => setStatus(e.target.value)}>{['open', 'in_progress', 'waiting_for_customer', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select></Field><Button size="sm" variant="secondary" onClick={assignMe} disabled={t.assignedTo === user.id}>{t.assignedTo === user.id ? 'Assigned to you' : 'Assign to me'}</Button></div></Card>}
      <Card><Thread messages={t.messages} base="/api/admin/support" /></Card>
      {can('support.manage') && (
        <Card title="Reply">
          <form onSubmit={send}>
            <Field label={internal ? 'Internal note (not visible to the customer)' : 'Message to customer'} required>{(p) => <Textarea {...p} style={{ minHeight: 100 }} maxLength={5000} value={message} onChange={(e) => setMessage(e.target.value)} />}</Field>
            <label className="checkbox"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /><span>Internal note only</span></label>
            <Attachments files={files} setFiles={setFiles} />
            <Button type="submit" loading={busy} icon="send" disabled={message.trim().length < 2}>{internal ? 'Add internal note' : 'Send reply'}</Button>
          </form>
        </Card>
      )}
    </div>
  );
}

// ───────── Security events ─────────
export function AdminSecurity() {
  useDocumentTitle('Security events');
  const { can } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState('open');
  const [severity, setSeverity] = useState('');
  const [offset, setOffset] = useState(0);
  const { data, loading, error, refetch, reload } = useApi('/api/admin/security-events', { status, severity, limit: LIMIT, offset });
  const [target, setTarget] = useState(null);
  const [next, setNext] = useState('investigating');
  return (
    <div className="stack">
      <PageHeader title="Security events" subtitle="Signals for investigation. A rule firing is not proof of wrongdoing — avoid treating customers as suspects." />
      <Card><form className="filters" onSubmit={(e) => e.preventDefault()} style={{ marginBottom: 0 }}>
        <Field label="Status">{(p) => <Select {...p} value={status} onChange={(e) => { setStatus(e.target.value); setOffset(0); }}><option value="">All</option>{['open', 'investigating', 'resolved', 'dismissed'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}</Field>
        <Field label="Severity">{(p) => <Select {...p} value={severity} onChange={(e) => { setSeverity(e.target.value); setOffset(0); }}><option value="">All</option>{['high', 'medium', 'low', 'info'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}</Field>
      </form></Card>
      {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <Card pad={false} className="card-flush">
          <DataTable rows={data.items} caption="Security events" columns={[
            { key: 'created_at', header: 'When', render: (e) => <span title={dateTime(e.created_at)}>{relativeTime(e.created_at)}</span> },
            { key: 'severity', header: 'Severity', render: (e) => <Badge status={e.severity} /> },
            { key: 'summary', header: 'Event', render: (e) => <span><strong>{e.summary}</strong><br /><span className="muted small mono">{e.type}</span></span> },
            { key: 'user_email', header: 'Customer', render: (e) => (e.user_id ? <Link to={`/admin/customers/${e.user_id}`}>{e.user_email}</Link> : '—') },
            { key: 'status', header: 'Status', render: (e) => <Badge status={e.status} /> },
            { key: 'act', header: '', className: 'num', render: (e) => can('security.manage') && <Button size="sm" variant="secondary" onClick={() => { setTarget(e); setNext(e.status === 'open' ? 'investigating' : 'resolved'); }}>Update</Button> },
          ]} empty={<EmptyState icon="shield" title="No events match" />} />
          <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
        </Card>
      )}
      <ReasonDialog open={!!target} onClose={() => setTarget(null)} title="Update security event" minReason={0} confirmLabel="Save" reasonLabel="Resolution note (optional)"
        onSubmit={async ({ reason }) => { await api.patch(`/api/admin/security-events/${target.id}`, { status: next, note: reason || undefined }); toast.success('Event updated.'); reload(); }}>
        <p className="muted small">{target?.summary}</p>
        <Field label="New status">{(p) => <Select {...p} value={next} onChange={(e) => setNext(e.target.value)}>{['open', 'investigating', 'resolved', 'dismissed'].map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}</Select>}</Field>
      </ReasonDialog>
    </div>
  );
}

// ───────── Audit log ─────────
export function AdminAudit() {
  useDocumentTitle('Audit log');
  const [action, setAction] = useState('');
  const [offset, setOffset] = useState(0);
  const [detail, setDetail] = useState(null);
  const da = useDebounced(action);
  const { data, loading, error, refetch } = useApi('/api/audit', { action: da, limit: LIMIT, offset });
  return (
    <div className="stack">
      <PageHeader title="Audit log" subtitle="Append-only record of privileged and sensitive actions. Entries cannot be edited or deleted." />
      <Card><form className="filters" role="search" onSubmit={(e) => e.preventDefault()} style={{ marginBottom: 0 }}><Field label="Filter by action">{(p) => <Input {...p} type="search" placeholder="e.g. ledger.credit, customer.lock" value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }} />}</Field></form></Card>
      {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <Card pad={false} className="card-flush">
          <DataTable rows={data.items} caption="Audit log" onRowClick={setDetail} columns={[
            { key: 'created_at', header: 'When', render: (a) => dateTime(a.created_at) }, { key: 'action', header: 'Action', render: (a) => <span className="mono">{a.action}</span> },
            { key: 'actor', header: 'Actor', render: (a) => <span>{a.actor_email || 'System'}<br /><span className="muted small">{a.actor_role}</span></span> },
            { key: 'target', header: 'Target', render: (a) => <span className="mono small">{a.target_type}{a.target_id ? `:${String(a.target_id).slice(0, 8)}` : ''}</span> },
            { key: 'reason', header: 'Reason', render: (a) => a.reason || '—' },
          ]} empty={<EmptyState icon="clipboard" title="No entries" />} />
          <Pagination total={data.total} limit={LIMIT} offset={offset} onChange={setOffset} />
        </Card>
      )}
      <Modal open={!!detail} onClose={() => setDetail(null)} title="Audit entry" size="lg">
        {detail && (<>
          <KeyValue items={[{ label: 'Action', value: <span className="mono">{detail.action}</span> }, { label: 'Actor', value: `${detail.actor_email || 'System'} (${detail.actor_role || '—'})` }, { label: 'When', value: dateTime(detail.created_at) },
            { label: 'Target', value: `${detail.target_type || '—'} ${detail.target_id || ''}` }, { label: 'Account', value: detail.account_id }, { label: 'Reason', value: detail.reason }, { label: 'IP address', value: detail.ip }, { label: 'Device / session', value: `${detail.device_id || '—'} / ${detail.session_id || '—'}` }, { label: 'User agent', value: detail.user_agent }]} />
          <div className="grid grid-2" style={{ marginTop: 12 }}>
            <div><h3 style={{ fontSize: '.9rem' }}>Previous state</h3><pre className="codes" style={{ display: 'block', overflow: 'auto', fontSize: '.8rem' }}>{JSON.stringify(detail.previous_state, null, 2) ?? '—'}</pre></div>
            <div><h3 style={{ fontSize: '.9rem' }}>New state</h3><pre className="codes" style={{ display: 'block', overflow: 'auto', fontSize: '.8rem' }}>{JSON.stringify(detail.new_state, null, 2) ?? '—'}</pre></div>
          </div>
        </>)}
      </Modal>
    </div>
  );
}

// ───────── Staff ─────────
const ROLE_OPTIONS = [['super_admin', 'Super Admin'], ['compliance_admin', 'Compliance/Admin'], ['support_agent', 'Support Agent'], ['finance_operator', 'Finance Operator'], ['security_admin', 'Security Administrator']];

export function AdminStaff() {
  useDocumentTitle('Staff');
  const toast = useToast();
  const { user } = useAuth();
  const { data, loading, error, refetch, reload } = useApi('/api/admin/staff');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ email: '', firstName: '', lastName: '', role: 'support_agent' });
  const [fe, setFe] = useState({});
  const [busy, setBusy] = useState(false);
  const create = async (e) => {
    e.preventDefault(); setBusy(true); setFe({});
    try { await api.post('/api/admin/staff', f); toast.success('Invitation sent. They must set a password and enrol MFA.'); setOpen(false); setF({ email: '', firstName: '', lastName: '', role: 'support_agent' }); reload(); }
    catch (ex) { setFe(fieldErrors(ex)); if (!Object.keys(fieldErrors(ex)).length) toast.error(ex.message); } finally { setBusy(false); }
  };
  const update = async (id, body) => { try { await api.patch(`/api/admin/staff/${id}`, body); toast.success('Staff member updated. Their sessions were ended.'); reload(); } catch (ex) { toast.error(ex.message); } };
  return (
    <div className="stack">
      <PageHeader title="Staff" subtitle="Role-based access. Role changes end the member’s sessions immediately." actions={<Button icon="plus" onClick={() => setOpen(true)}>Invite staff</Button>} />
      {loading ? <SkeletonRows /> : error ? <ErrorState error={error} onRetry={refetch} /> : (
        <Card pad={false} className="card-flush"><DataTable rows={data.staff} caption="Staff" columns={[
          { key: 'name', header: 'Name', render: (s) => <span><strong>{s.firstName} {s.lastName}</strong><br /><span className="muted small">{s.email}</span></span> },
          { key: 'role', header: 'Role', render: (s) => s.id === user.id ? s.roleLabel : <Select aria-label={`Role for ${s.email}`} value={s.role} onChange={(e) => update(s.id, { role: e.target.value })}>{ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select> },
          { key: 'mfa', header: 'MFA', render: (s) => <Badge tone={s.mfaEnabled ? 'success' : 'warning'}>{s.mfaEnabled ? 'Enabled' : 'Not enrolled'}</Badge> },
          { key: 'status', header: 'Status', render: (s) => <Badge status={s.status} /> },
          { key: 'lastLoginAt', header: 'Last sign-in', render: (s) => (s.lastLoginAt ? relativeTime(s.lastLoginAt) : 'Never') },
          { key: 'act', header: '', className: 'num', render: (s) => s.id !== user.id && <Button size="sm" variant="ghost" onClick={() => update(s.id, { status: s.status === 'active' ? 'suspended' : 'active' })}>{s.status === 'active' ? 'Suspend' : 'Reactivate'}</Button> },
        ]} /></Card>
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Invite a staff member" footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" form="staff-form" loading={busy}>Send invitation</Button></>}>
        <form id="staff-form" onSubmit={create} noValidate>
          <Alert tone="info">They receive a link to choose their own password. You never see or set their credentials. MFA is mandatory at first sign-in.</Alert>
          <div className="form-grid">
            <Field label="First name" error={fe.firstName} required>{(p) => <Input {...p} value={f.firstName} onChange={(e) => setF({ ...f, firstName: e.target.value })} />}</Field>
            <Field label="Last name" error={fe.lastName} required>{(p) => <Input {...p} value={f.lastName} onChange={(e) => setF({ ...f, lastName: e.target.value })} />}</Field>
            <Field label="Work email" error={fe.email} required className="span-2">{(p) => <Input {...p} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />}</Field>
            <Field label="Role" error={fe.role} required className="span-2">{(p) => <Select {...p} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
          </div>
        </form>
      </Modal>
    </div>
  );
}
