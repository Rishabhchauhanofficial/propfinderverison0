import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { admin, errorMessage, openPrivateFile } from '../api/client.js';
import { useAsync } from '../hooks/useUi.js';
import { useToast } from '../context/ToastContext.jsx';
import { DemoBadge, ErrorState, Modal, ReraBadge } from '../components/ui.jsx';
import { formatDate, formatINR, labelize } from '../utils/format.js';

const TABS = [
  ['overview', 'Overview'],
  ['rera', 'RERA queue'],
  ['reviews', 'Reviews'],
  ['reports', 'Reports'],
  ['listings', 'Listings'],
  ['users', 'Users'],
  ['ai', 'AI jobs'],
  ['integrations', 'Integrations'],
  ['analytics', 'Search analytics'],
  ['audit', 'Audit log'],
  ['messages', 'Support inbox'],
];

function useAct() {
  const toast = useToast();
  return async (fn, ok, after) => {
    try {
      await fn();
      if (ok) toast.show(ok, 'success');
      after?.();
    } catch (err) {
      toast.show(errorMessage(err), 'error');
    }
  };
}

function Overview() {
  const res = useAsync(admin.stats, []);
  if (res.status === 'error') return <ErrorState message={res.error} onRetry={res.reload} />;
  const s = res.data;
  if (!s) return <p className="muted">Loading…</p>;
  const cards = [
    ['Users', s.users], ['Listings', s.listings], ['Active', s.byStatus.active || 0], ['RERA to review', s.pendingRera, 'rera'],
    ['Reviews pending', s.pendingReviews, 'reviews'], ['Open reports', s.openReports, 'reports'], ['Possible duplicates', s.duplicates, 'listings'], ['Leads (30d)', s.leads30],
    ['Searches (30d)', s.searches30], ['Support messages', s.openMessages, 'messages'],
  ];
  return (
    <>
      <div className="stats-row stats-row--wrap">
        {cards.map(([l, v, tab]) => (
          <div key={l} className={`stat-card${tab && v ? ' stat-card--alert' : ''}`}>
            <span className="stat-card__label">{l}</span>
            <strong className="stat-card__value">{v}</strong>
            {tab && v > 0 && <Link className="tiny" to={`/admin?tab=${tab}`}>Review →</Link>}
          </div>
        ))}
      </div>
      <p className="small muted">Users by role: {Object.entries(s.byRole).map(([r, n]) => `${labelize(r)} ${n}`).join(' · ')}</p>
    </>
  );
}

function ReraReview({ record, onDone }) {
  const act = useAct();
  const [form, setForm] = useState({
    status: 'verified',
    statusNote: '',
    official: { projectName: record.official?.projectName || record.submitted?.projectName || '', promoterName: record.official?.promoterName || record.submitted?.promoterName || '', registrationStatus: record.official?.registrationStatus || '', registeredOn: '', validUntil: '', declaredCompletion: '', sourceUrl: record.official?.sourceUrl || '' },
  });
  const [check, setCheck] = useState(null);
  const o = form.official;
  const setO = (k, v) => setForm({ ...form, official: { ...o, [k]: v } });
  return (
    <div className="form-stack">
      <div className="callout small">
        <p><strong>{record.registrationNumber}</strong> · {record.authority || record.state}</p>
        <p>Lister submitted: project “{record.submitted?.projectName || '—'}”, promoter “{record.submitted?.promoterName || '—'}”{record.submitted?.possessionDate ? `, possession ${formatDate(record.submitted.possessionDate)}` : ''}.</p>
        <p>
          Open the official portal: <a href={record.officialUrl} target="_blank" rel="noopener noreferrer">{record.officialUrl || 'unknown authority'}</a>.{' '}
          <button type="button" className="link-btn" onClick={() => act(async () => setCheck(await admin.reraCheck(record._id)))}>Try automated check</button>
        </p>
        {check && <p className="muted">{check.message || JSON.stringify(check)}</p>}
        {record.evidence?.length > 0 && (
          <p>Evidence: {record.evidence.map((e) => <button key={e.url} type="button" className="link-btn" onClick={() => openPrivateFile(e.url)}>{e.name || 'file'}</button>)}</p>
        )}
      </div>
      <div className="form-grid">
        <label className="form-field"><span className="form-field__label">Project name (official)</span><input className="input" value={o.projectName} onChange={(e) => setO('projectName', e.target.value)} /></label>
        <label className="form-field"><span className="form-field__label">Promoter (official)</span><input className="input" value={o.promoterName} onChange={(e) => setO('promoterName', e.target.value)} /></label>
        <label className="form-field"><span className="form-field__label">Registration status shown</span><input className="input" value={o.registrationStatus} onChange={(e) => setO('registrationStatus', e.target.value)} placeholder="e.g. Registered / Lapsed" /></label>
        <label className="form-field"><span className="form-field__label">Official record URL</span><input className="input" value={o.sourceUrl} onChange={(e) => setO('sourceUrl', e.target.value)} placeholder="https://…" /></label>
        <label className="form-field"><span className="form-field__label">Registered on</span><input className="input" type="date" value={o.registeredOn} onChange={(e) => setO('registeredOn', e.target.value)} /></label>
        <label className="form-field"><span className="form-field__label">Valid until</span><input className="input" type="date" value={o.validUntil} onChange={(e) => setO('validUntil', e.target.value)} /></label>
        <label className="form-field"><span className="form-field__label">Declared completion</span><input className="input" type="date" value={o.declaredCompletion} onChange={(e) => setO('declaredCompletion', e.target.value)} /></label>
        <label className="form-field">
          <span className="form-field__label">Decision</span>
          <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            <option value="verified">Verified against official records</option>
            <option value="found-needs-review">Registration found, details need review</option>
            <option value="mismatch">Details do not match</option>
            <option value="not-found">Not found in the checked source</option>
            <option value="not-applicable">Not applicable (explain)</option>
            <option value="not-verified">Reset to not verified</option>
          </select>
        </label>
        <label className="form-field form-field--full"><span className="form-field__label">Note (shown publicly)</span><textarea className="input textarea" rows={2} value={form.statusNote} onChange={(e) => setForm({ ...form, statusNote: e.target.value })} /></label>
      </div>
      <p className="tiny muted">“Verified” requires the official URL and the names exactly as on the record. If the names differ from what the lister submitted, the status is set to “mismatch” automatically.</p>
      <button type="button" className="btn btn--primary" onClick={() => act(() => admin.reraReview(record._id, form), 'RERA review saved.', onDone)}>Save decision</button>
    </div>
  );
}

function ReraQueue() {
  const [status, setStatus] = useState('');
  const res = useAsync(() => admin.rera({ status }), [status]);
  const [open, setOpen] = useState(null);
  return (
    <>
      <div className="chip-row">
        {[['', 'Needs review'], ['verified', 'Verified'], ['mismatch', 'Mismatch'], ['not-found', 'Not found'], ['not-applicable', 'Not applicable']].map(([v, l]) => <button key={v || 'q'} type="button" className={`chip${status === v ? ' is-active' : ''}`} onClick={() => setStatus(v)}>{l}</button>)}
      </div>
      {res.status === 'error' && <ErrorState message={res.error} onRetry={res.reload} />}
      {res.data && !res.data.items.length && <p className="muted">Nothing in this queue.</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Registration</th><th>Listing / project</th><th>State</th><th>Status</th><th>Evidence</th><th>Updated</th><th /></tr></thead>
          <tbody>
            {res.data?.items.map((r) => (
              <tr key={r._id}>
                <td className="mono">{r.registrationNumber}</td>
                <td>{r.property ? <Link to={`/property/${r.property.slug || r.property._id}`}>{r.property.title}</Link> : 'Project record'} {r.property?.isDemo && <DemoBadge small />}</td>
                <td>{r.state}</td>
                <td><ReraBadge status={r.status} small /></td>
                <td>{r.evidence?.length || 0}</td>
                <td className="small">{formatDate(r.updatedAt)}</td>
                <td><button type="button" className="btn btn--outline btn--sm" onClick={() => setOpen(r)}>Review</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={Boolean(open)} title="RERA verification" onClose={() => setOpen(null)} size="lg">
        {open && <ReraReview record={open} onDone={() => { setOpen(null); res.reload(); }} />}
      </Modal>
    </>
  );
}

function ReviewsQueue() {
  const [status, setStatus] = useState('pending');
  const res = useAsync(() => admin.reviews({ status }), [status]);
  const act = useAct();
  const decide = (r, s) => {
    const note = s === 'published' ? '' : window.prompt(`Reason for ${s === 'rejected' ? 'rejecting' : 'hiding'} this review (shown to the author):`);
    if (s !== 'published' && !note) return;
    act(() => admin.moderateReview(r._id, { status: s, note }), `Review ${s}.`, res.reload);
  };
  return (
    <>
      <div className="chip-row">{[['pending', 'Pending'], ['reported', 'Reported (live)'], ['published', 'Published'], ['rejected', 'Rejected'], ['hidden', 'Hidden']].map(([v, l]) => <button key={v} type="button" className={`chip${status === v ? ' is-active' : ''}`} onClick={() => setStatus(v)}>{l}</button>)}</div>
      {res.data && !res.data.items.length && <p className="muted">Queue is empty.</p>}
      <ul className="review-list">
        {res.data?.items.map((r) => (
          <li key={r._id} className="review">
            <div className="review__head"><strong>{r.ratings.overall}★ {r.title}</strong> <span className="small muted">{r.targetType} · {r.author?.name} ({r.author?.email}) · account {formatDate(r.author?.createdAt)}</span></div>
            <p className="review__body">{r.body}</p>
            <div className="small">
              {r.autoFlags?.map((f) => <span key={f} className="badge badge--warn badge--sm">{f}</span>)}
              {r.reportsCount > 0 && <span className="badge badge--bad badge--sm">{r.reportsCount} report(s)</span>}
              <span className="muted"> · self-declared: {r.relationship}{r.verifiedRelationship ? ' (verified)' : ''}</span>
            </div>
            <div className="btn-row">
              {r.status !== 'published' && <button type="button" className="btn btn--primary btn--sm" onClick={() => decide(r, 'published')}>Publish</button>}
              <button type="button" className="btn btn--outline btn--sm" onClick={() => decide(r, 'rejected')}>Reject</button>
              {r.status === 'published' && <button type="button" className="btn btn--ghost btn--sm" onClick={() => decide(r, 'hidden')}>Hide</button>}
              {!r.verifiedRelationship && r.relationship !== 'other' && (
                <button type="button" className="btn btn--ghost btn--sm" title="Only after checking proof such as a rent agreement or sale deed" onClick={() => window.confirm('Mark the reviewer’s relationship as verified? Only do this after checking proof.') && act(() => admin.moderateReview(r._id, { status: r.status === 'pending' ? 'published' : r.status, note: 'Relationship verified', verifiedRelationship: true }), 'Relationship verified.', res.reload)}>Verify {r.relationship}</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function Reports() {
  const res = useAsync(() => admin.reports({}), []);
  const act = useAct();
  if (res.data && !res.data.items.length) return <p className="muted">No open reports.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>Target</th><th>Reason</th><th>Details</th><th>Reporter</th><th>Date</th><th /></tr></thead>
        <tbody>
          {res.data?.items.map((r) => (
            <tr key={r._id}>
              <td>{r.targetType}: {r.target?.href ? <Link to={r.target.href}>{r.target.title}</Link> : r.target?.title || 'removed'} <span className="tiny muted">({r.target?.status})</span></td>
              <td>{labelize(r.reason)}</td>
              <td className="small">{r.details || '—'}</td>
              <td className="small">{r.reporter?.name}</td>
              <td className="small">{formatDate(r.createdAt)}</td>
              <td className="nowrap">
                <button type="button" className="btn btn--outline btn--sm" onClick={() => { const resolution = window.prompt('Resolution note:'); if (resolution) act(() => admin.resolveReport(r._id, { status: 'resolved', resolution }), 'Resolved.', res.reload); }}>Resolve</button>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => act(() => admin.resolveReport(r._id, { status: 'dismissed', resolution: 'Dismissed' }), 'Dismissed.', res.reload)}>Dismiss</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tiny muted">To act on a review, use the Reviews tab; for a listing, the Listings tab.</p>
    </div>
  );
}

function Listings() {
  const [filter, setFilter] = useState({ q: '', duplicates: '', reported: '', status: '' });
  const res = useAsync(() => admin.listings(filter), [JSON.stringify(filter)]);
  const act = useAct();
  const [del, setDel] = useState(null);
  const [delForm, setDelForm] = useState({ confirm: '', reason: '' });
  const moderate = (p, status) => {
    const reason = status === 'active' ? 'Reinstated' : window.prompt(`Reason for setting "${p.title}" to ${status} (sent to the lister):`);
    if (!reason) return;
    act(() => admin.moderateListing(p._id, { status, reason }), `Listing ${status}.`, res.reload);
  };
  return (
    <>
      <div className="toolbar">
        <input className="input" placeholder="Search title, city, locality" onKeyDown={(e) => e.key === 'Enter' && setFilter({ ...filter, q: e.target.value })} />
        <label className="check"><input type="checkbox" onChange={(e) => setFilter({ ...filter, duplicates: e.target.checked ? '1' : '' })} /> Possible duplicates</label>
        <label className="check"><input type="checkbox" onChange={(e) => setFilter({ ...filter, reported: e.target.checked ? '1' : '' })} /> Reported</label>
        <select className="select select--sm" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
          <option value="">Any status</option>
          {['active', 'draft', 'paused', 'archived', 'sold', 'rented'].map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
        </select>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Listing</th><th>Lister</th><th>Price</th><th>Status</th><th>Flags</th><th /></tr></thead>
          <tbody>
            {res.data?.items.map((p) => (
              <tr key={p._id}>
                <td><Link to={`/property/${p.slug || p._id}`}>{p.title}</Link> {p.isDemo && <DemoBadge small />}<div className="tiny muted">{p.locality}, {p.city} · {p.views} views · {p.leadsCount} leads</div></td>
                <td className="small">{p.owner?.name}<div className="tiny muted">{p.owner?.role}</div></td>
                <td className="small">{formatINR(p.price, p.listingType)}</td>
                <td><span className={`status-pill status-pill--${p.status}`}>{labelize(p.status)}</span></td>
                <td className="small">
                  {p.possibleDuplicateOf && <div>Duplicate of <Link to={`/property/${p.possibleDuplicateOf.slug || p.possibleDuplicateOf._id}`}>{p.possibleDuplicateOf.title}</Link> <button type="button" className="link-btn tiny" onClick={() => act(() => admin.moderateListing(p._id, { clearDuplicate: true }), 'Flag cleared.', res.reload)}>Not a duplicate</button></div>}
                  {p.listingVerified && <span className="badge badge--good badge--sm">Checked</span>}
                  <ReraBadge status={p.rera?.status} small />
                </td>
                <td className="nowrap">
                  {p.status === 'active' ? <button type="button" className="btn btn--outline btn--sm" onClick={() => moderate(p, 'paused')}>Pause</button> : <button type="button" className="btn btn--outline btn--sm" onClick={() => moderate(p, 'active')}>Reinstate</button>}
                  <button type="button" className="btn btn--ghost btn--sm" title="Mark as checked after reviewing the lister's documents" onClick={() => act(() => admin.moderateListing(p._id, { listingVerified: !p.listingVerified, reason: 'Documents reviewed' }), p.listingVerified ? 'Check removed.' : 'Marked as checked.', res.reload)}>{p.listingVerified ? 'Uncheck' : 'Mark checked'}</button>
                  <button type="button" className="btn btn--danger btn--sm" onClick={() => { setDel(p); setDelForm({ confirm: '', reason: '' }); }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal
        open={Boolean(del)}
        title="Permanently delete listing"
        size="sm"
        onClose={() => setDel(null)}
        footer={<button type="button" className="btn btn--danger" disabled={delForm.confirm !== 'DELETE' || delForm.reason.trim().length < 5} onClick={() => act(() => admin.deleteListing(del._id, delForm), 'Listing deleted.', () => { setDel(null); res.reload(); })}>Delete forever</button>}
      >
        <p>This removes “{del?.title}” for everyone and cannot be undone. Prefer pausing or archiving.</p>
        <label className="form-field"><span className="form-field__label">Reason (audit log)</span><input className="input" value={delForm.reason} onChange={(e) => setDelForm({ ...delForm, reason: e.target.value })} /></label>
        <label className="form-field"><span className="form-field__label">Type DELETE to confirm</span><input className="input" value={delForm.confirm} onChange={(e) => setDelForm({ ...delForm, confirm: e.target.value })} /></label>
      </Modal>
    </>
  );
}

function Users() {
  const [q, setQ] = useState('');
  const res = useAsync(() => admin.users({ q }), [q]);
  const act = useAct();
  const change = (u, patch, label) => {
    const reason = window.prompt(`${label} — reason (audit log):`);
    if (!reason) return;
    if (!window.confirm(`${label} for ${u.email}?`)) return;
    act(() => admin.updateUser(u._id, { ...patch, reason, confirm: true }), 'Account updated.', res.reload);
  };
  return (
    <>
      <div className="toolbar"><input className="input" placeholder="Search name, email, company" onKeyDown={(e) => e.key === 'Enter' && setQ(e.target.value)} /></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Joined</th><th>Last login</th><th /></tr></thead>
          <tbody>
            {res.data?.items.map((u) => (
              <tr key={u._id}>
                <td>{u.name}<div className="tiny muted">{u.email}{u.company ? ` · ${u.company}` : ''}</div></td>
                <td>
                  <select className="select select--sm" value={u.role === 'user' ? 'buyer' : u.role} aria-label="Role" onChange={(e) => change(u, { role: e.target.value }, `Change role to ${e.target.value}`)}>
                    {['buyer', 'tenant', 'owner', 'agent', 'builder', 'admin'].map((r) => <option key={r} value={r}>{labelize(r)}</option>)}
                  </select>
                </td>
                <td><span className={`status-pill status-pill--${u.status === 'active' ? 'active' : 'archived'}`}>{labelize(u.status)}</span></td>
                <td className="small">{formatDate(u.createdAt)}</td>
                <td className="small">{u.lastLoginAt ? formatDate(u.lastLoginAt) : '—'}</td>
                <td>{u.status === 'active' ? <button type="button" className="btn btn--danger btn--sm" onClick={() => change(u, { status: 'suspended' }, 'Suspend account (their active listings will be paused)')}>Suspend</button> : <button type="button" className="btn btn--outline btn--sm" onClick={() => change(u, { status: 'active' }, 'Reactivate account')}>Reactivate</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function AiJobs() {
  const res = useAsync(() => admin.analysis({}), []);
  const act = useAct();
  return (
    <>
      <p className="small muted">Reports are cached and rebuilt automatically when the listing, comparables, RERA record or nearby data change. {res.data && `Status: ${Object.entries(res.data.byStatus).map(([k, v]) => `${k} ${v}`).join(' · ')}`}</p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Property</th><th>Status</th><th>Overall</th><th>Narrative</th><th>Nearby data</th><th>Took</th><th>Updated</th><th /></tr></thead>
          <tbody>
            {res.data?.items.map((j) => (
              <tr key={j._id}>
                <td>{j.property ? <Link to={`/property/${j.property.slug || j.property._id}`}>{j.property.title}</Link> : 'removed'}</td>
                <td>{j.status}{j.error && <div className="tiny muted">{j.error}</div>}</td>
                <td>{j.report?.overall?.value ?? '—'}</td>
                <td>{j.report?.narrative?.source}</td>
                <td>{j.report?.nearby?.status}</td>
                <td className="small">{j.durationMs} ms</td>
                <td className="small">{formatDate(j.updatedAt)}</td>
                <td>{j.property && <button type="button" className="btn btn--outline btn--sm" onClick={() => act(() => admin.rerunAnalysis(j.property._id), 'Re-run complete.', res.reload)}>Re-run</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Integrations() {
  const res = useAsync(admin.integrations, []);
  if (!res.data) return <p className="muted">Loading…</p>;
  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Service</th><th>Configuration</th><th>Note</th></tr></thead>
          <tbody>
            {Object.entries(res.data.configured).map(([k, v]) => (
              <tr key={k}><td>{labelize(k)}</td><td className="small mono">{JSON.stringify(Object.fromEntries(Object.entries(v).filter(([kk]) => kk !== 'note')))}</td><td className="small">{v.note || '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <h3 className="report__h">Last 24 hours</h3>
      {!res.data.last24h.length && <p className="muted small">No external calls recorded yet.</p>}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Service</th><th>Calls</th><th>Failures</th><th>Avg latency</th><th>Last result</th></tr></thead>
          <tbody>
            {res.data.last24h.map((r) => (
              <tr key={r.service}><td>{r.service}</td><td>{r.total}</td><td className={r.failures ? 'text-bad' : ''}>{r.failures}</td><td>{r.avgLatencyMs} ms</td><td className="small">{r.lastOk ? '✓' : '✗'} {r.lastMessage} · {formatDate(r.lastAt)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Analytics() {
  const res = useAsync(admin.searchAnalytics, []);
  if (!res.data) return <p className="muted">Loading…</p>;
  const d = res.data;
  const max = Math.max(1, ...d.byDay.map((x) => x.n));
  return (
    <>
      <p className="small muted">{d.note} Zero-result searches (30d): <strong>{d.zeroResults}</strong></p>
      <div className="spark" aria-label="Searches per day">{d.byDay.map((x) => <span key={x._id} title={`${x._id}: ${x.n}`} style={{ height: `${(x.n / max) * 100}%` }} />)}</div>
      <div className="two-col">
        <section className="panel"><h3 className="panel__title">Top cities</h3><ul className="link-list">{d.byCity.map((c) => <li key={c._id}>{labelize(c._id)} <span className="muted">{c.n}</span></li>)}</ul></section>
        <section className="panel"><h3 className="panel__title">Most used filters</h3><ul className="link-list">{d.byFilter.map((c) => <li key={c._id}>{c._id} <span className="muted">{c.n}</span></li>)}</ul></section>
      </div>
    </>
  );
}

function Audit() {
  const [action, setAction] = useState('');
  const res = useAsync(() => admin.auditLogs({ action }), [action]);
  return (
    <>
      <div className="toolbar"><input className="input" placeholder="Filter by action prefix, e.g. admin. or rera." onKeyDown={(e) => e.key === 'Enter' && setAction(e.target.value)} /></div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
          <tbody>
            {res.data?.items.map((l) => (
              <tr key={l._id}><td className="small nowrap">{new Date(l.createdAt).toLocaleString('en-IN')}</td><td className="small">{l.actor?.name || 'system'}<div className="tiny muted">{l.actor?.role}</div></td><td className="mono small">{l.action}</td><td className="small">{l.targetType} {l.targetId?.slice(-6)}</td><td className="small mono">{JSON.stringify(l.details)}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Messages() {
  const res = useAsync(admin.messages, []);
  const act = useAct();
  if (res.data && !res.data.items.length) return <p className="muted">Inbox is empty.</p>;
  return (
    <ul className="review-list">
      {res.data?.items.map((m) => (
        <li key={m._id} className="review">
          <div className="review__head"><strong>{labelize(m.topic)}</strong> <span className="small muted">{m.name} · <a href={`mailto:${m.email}`}>{m.email}</a> · {formatDate(m.createdAt)}</span></div>
          <p className="review__body">{m.message}</p>
          <button type="button" className="btn btn--outline btn--sm" onClick={() => act(() => admin.closeMessage(m._id), 'Closed.', res.reload)}>Mark handled</button>
        </li>
      ))}
    </ul>
  );
}

export default function AdminPage() {
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some(([k]) => k === sp.get('tab')) ? sp.get('tab') : 'overview';
  const C = { overview: Overview, rera: ReraQueue, reviews: ReviewsQueue, reports: Reports, listings: Listings, users: Users, ai: AiJobs, integrations: Integrations, analytics: Analytics, audit: Audit, messages: Messages }[tab];
  return (
    <div className="container section">
      <Helmet><title>Admin | PropFinder</title><meta name="robots" content="noindex" /></Helmet>
      <header className="page-head"><h1>Admin console</h1><p className="muted">Every moderation and account action is recorded in the audit log.</p></header>
      <div className="tabs tabs--scroll" role="tablist">
        {TABS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' is-active' : ''}`} onClick={() => setSp({ tab: k })}>{l}</button>)}
      </div>
      <div className="tab-panel"><C /></div>
    </div>
  );
}
