import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { createProject, deleteProperty, errorMessage, listLeads, listVisits, myProjects, myProperties, setPropertyStatus, updateLead, updateVisit } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsync } from '../hooks/useUi.js';
import { DemoBadge, EmptyState, ErrorState, ReraBadge } from '../components/ui.jsx';
import { formatArea, formatDate, formatINR, labelize, propertyId, propertyPath } from '../utils/format.js';
import { LISTER_ROLES } from '../utils/constants.js';

const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'site-visit', 'negotiation', 'won', 'lost'];

function Listings() {
  const res = useAsync(myProperties, []);
  const toast = useToast();
  const [busyId, setBusyId] = useState(null);
  const items = useMemo(() => res.data?.items || [], [res.data]);
  const counts = useMemo(() => Object.fromEntries(['active', 'draft', 'paused', 'archived', 'sold', 'rented'].map((s) => [s, items.filter((p) => p.status === s).length])), [items]);

  async function act(item, status) {
    setBusyId(propertyId(item));
    try {
      await setPropertyStatus(propertyId(item), status);
      toast.show(`Listing ${status === 'active' ? 'published' : status}.`, 'success');
      res.reload();
    } catch (err) {
      toast.show(errorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(item) {
    if (!window.confirm(`Delete "${item.title}" permanently? Consider archiving instead — this cannot be undone.`)) return;
    setBusyId(propertyId(item));
    try {
      await deleteProperty(propertyId(item));
      res.reload();
    } catch (err) {
      toast.show(errorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  }

  if (res.status === 'loading') return <p className="muted">Loading your listings…</p>;
  if (res.status === 'error') return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!items.length) return <EmptyState icon="🏠" title="You have not posted anything yet" action={<Link to="/post" className="btn btn--primary">Post your first property</Link>}>Reach buyers and tenants and get an AI report on every listing.</EmptyState>;

  return (
    <>
      <div className="chip-row">{Object.entries(counts).filter(([, n]) => n).map(([s, n]) => <span key={s} className="chip chip--static">{labelize(s)} · {n}</span>)}</div>
      <ul className="listing-list">
        {items.map((item) => {
          const id = propertyId(item);
          const busy = busyId === id;
          return (
            <li key={id} className="listing-row">
              <Link to={propertyPath(item)} className="listing-row__thumb" aria-label={item.title}>{item.images?.[0] ? <img src={item.images[0]} alt="" loading="lazy" /> : <span>No photo</span>}</Link>
              <div className="listing-row__info">
                <Link to={propertyPath(item)} className="listing-row__title">{item.title}</Link>
                <div className="muted small">{[item.locality, item.city].filter(Boolean).join(', ')}{item.areaSqft ? ` · ${formatArea(item.areaSqft)}` : ''}</div>
                <div className="listing-row__meta">
                  <strong>{formatINR(item.price, item.listingType)}</strong>
                  <span className={`status-pill status-pill--${item.status}`}>{labelize(item.status)}</span>
                  <ReraBadge status={item.rera?.status} small />
                  {item.isDemo && <DemoBadge small />}
                  {item.possibleDuplicateOf && <span className="badge badge--warn badge--sm">Possible duplicate — under review</span>}
                  <span className="muted small">{item.views ?? 0} views · {item.leads} leads · {item.saves} saves</span>
                  <span className="muted small">Updated {formatDate(item.updatedAt)}</span>
                </div>
              </div>
              <div className="listing-row__actions">
                <Link to={`/property/${id}/edit`} className="btn btn--outline btn--sm">Edit</Link>
                {item.status !== 'active' && !['sold', 'rented'].includes(item.status) && <button type="button" className="btn btn--primary btn--sm" disabled={busy} onClick={() => act(item, 'active')}>Publish</button>}
                {item.status === 'active' && <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => act(item, 'paused')}>Pause</button>}
                {item.status === 'active' && <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={() => act(item, item.listingType === 'rent' ? 'rented' : 'sold')}>Mark {item.listingType === 'rent' ? 'rented' : 'sold'}</button>}
                {item.status !== 'archived' && <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => act(item, 'archived')}>Archive</button>}
                <button type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => remove(item)}>Delete</button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function LeadRow({ lead, onChanged }) {
  const toast = useToast();
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  async function patch(data) {
    try {
      await updateLead(lead._id, data);
      onChanged();
    } catch (err) {
      toast.show(errorMessage(err), 'error');
    }
  }
  return (
    <li className="lead">
      <div className="lead__main">
        <div>
          <strong>{lead.name}</strong> <span className="muted small">· {formatDate(lead.createdAt)} · via {labelize(lead.source)}</span>
          <div className="small">
            {lead.property ? <Link to={`/property/${lead.property.slug || lead.property._id}`}>{lead.property.title}</Link> : 'Listing removed'}
          </div>
          {lead.message && <p className="small lead__msg">“{lead.message}”</p>}
          <div className="small muted">
            {lead.phone && <a href={`tel:${lead.phone.replace(/\s+/g, '')}`}>{lead.phone}</a>}
            {lead.email && <> · <a href={`mailto:${lead.email}`}>{lead.email}</a></>}
            {lead.requirements?.budgetMax ? ` · budget ${formatINR(lead.requirements.budgetMax)}` : ''}
            {lead.requirements?.purpose ? ` · ${labelize(lead.requirements.purpose)}` : ''}
          </div>
        </div>
        <div className="lead__controls">
          <select className="select select--sm" aria-label="Lead status" value={lead.status} onChange={(e) => patch({ status: e.target.value })}>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
          </select>
          <input className="input input--sm" type="date" aria-label="Follow-up date" value={lead.followUpAt ? String(lead.followUpAt).slice(0, 10) : ''} onChange={(e) => patch({ followUpAt: e.target.value || null })} />
          <button type="button" className="link-btn small" onClick={() => setOpen((o) => !o)}>Notes ({lead.notes?.length || 0})</button>
        </div>
      </div>
      {open && (
        <div className="lead__notes">
          <ul>{(lead.notes || []).map((n, i) => <li key={i} className="small"><span className="muted">{formatDate(n.at)}:</span> {n.body}</li>)}</ul>
          <form className="geo-row" onSubmit={(e) => { e.preventDefault(); if (note.trim()) { patch({ note }); setNote(''); } }}>
            <input className="input" placeholder="Add a private note" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn btn--outline btn--sm" type="submit">Add</button>
          </form>
        </div>
      )}
    </li>
  );
}

function Leads() {
  const [status, setStatus] = useState('');
  const res = useAsync(() => listLeads({ status, limit: 100 }), [status]);
  if (res.status === 'error') return <ErrorState message={res.error} onRetry={res.reload} />;
  const by = res.data?.byStatus || {};
  return (
    <>
      <div className="pipeline">
        <button type="button" className={`pipeline__step${!status ? ' is-active' : ''}`} onClick={() => setStatus('')}>All <strong>{Object.values(by).reduce((a, b) => a + b, 0)}</strong></button>
        {LEAD_STATUSES.map((s) => (
          <button key={s} type="button" className={`pipeline__step${status === s ? ' is-active' : ''}`} onClick={() => setStatus(s)}>{labelize(s)} <strong>{by[s] || 0}</strong></button>
        ))}
      </div>
      {res.status === 'loading' && <p className="muted">Loading leads…</p>}
      {res.data && !res.data.items.length && <EmptyState icon="📭" title="No leads here yet">Enquiries, phone reveals and visit requests from buyers appear here. Only you can see leads on your listings.</EmptyState>}
      <ul className="lead-list">{res.data?.items.map((l) => <LeadRow key={l._id} lead={l} onChanged={res.reload} />)}</ul>
    </>
  );
}

function Visits() {
  const res = useAsync(() => listVisits(), []);
  const toast = useToast();
  async function set(id, status) {
    try {
      await updateVisit(id, { status });
      res.reload();
    } catch (err) {
      toast.show(errorMessage(err), 'error');
    }
  }
  if (res.status === 'loading') return <p className="muted">Loading visits…</p>;
  if (res.status === 'error') return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!res.data.items.length) return <EmptyState icon="📅" title="No site visits requested">Buyers can request visits from your listing page or through the AI assistant.</EmptyState>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>When</th><th>Property</th><th>Visitor</th><th>Note</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {res.data.items.map((v) => (
            <tr key={v._id}>
              <td>{new Date(v.scheduledAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
              <td>{v.property ? <Link to={`/property/${v.property.slug || v.property._id}`}>{v.property.title}</Link> : '—'}</td>
              <td>{v.requester?.name}{v.requester?.phone ? <div className="small muted">{v.requester.phone}</div> : null}</td>
              <td className="small">{v.note || '—'}</td>
              <td><span className={`status-pill status-pill--${v.status}`}>{labelize(v.status)}</span></td>
              <td className="nowrap">
                {v.status === 'requested' && <button type="button" className="btn btn--primary btn--sm" onClick={() => set(v._id, 'confirmed')}>Confirm</button>}
                {v.status === 'confirmed' && <button type="button" className="btn btn--outline btn--sm" onClick={() => set(v._id, 'completed')}>Mark done</button>}
                {['requested', 'confirmed'].includes(v.status) && <button type="button" className="btn btn--ghost btn--sm" onClick={() => set(v._id, 'cancelled')}>Cancel</button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Analytics() {
  const res = useAsync(myProperties, []);
  if (res.status !== 'ready') return <p className="muted">Loading…</p>;
  const items = res.data.items.filter((p) => p.status !== 'draft');
  const totals = items.reduce((a, p) => ({ views: a.views + (p.views || 0), leads: a.leads + (p.leads || 0), saves: a.saves + (p.saves || 0) }), { views: 0, leads: 0, saves: 0 });
  const max = Math.max(1, ...items.map((p) => p.views || 0));
  return (
    <>
      <div className="stats-row">
        <div className="stat-card"><span className="stat-card__label">Total views</span><strong className="stat-card__value">{totals.views.toLocaleString('en-IN')}</strong></div>
        <div className="stat-card"><span className="stat-card__label">Leads</span><strong className="stat-card__value">{totals.leads}</strong></div>
        <div className="stat-card"><span className="stat-card__label">Shortlisted</span><strong className="stat-card__value">{totals.saves}</strong></div>
        <div className="stat-card"><span className="stat-card__label">Views → lead</span><strong className="stat-card__value">{totals.views ? `${((totals.leads / totals.views) * 100).toFixed(1)}%` : '—'}</strong></div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Listing</th><th>Views</th><th>Leads</th><th>Saves</th><th>Status</th></tr></thead>
          <tbody>
            {items.map((p) => (
              <tr key={propertyId(p)}>
                <td><Link to={propertyPath(p)}>{p.title}</Link></td>
                <td><span className="bar-cell"><span style={{ width: `${((p.views || 0) / max) * 100}%` }} />{p.views || 0}</span></td>
                <td>{p.leads}</td>
                <td>{p.saves}</td>
                <td>{labelize(p.status)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="tiny muted">Views exclude your own visits. Counts are from PropFinder only.</p>
    </>
  );
}

function Projects() {
  const res = useAsync(myProjects, []);
  const toast = useToast();
  const [form, setForm] = useState({ name: '', city: '', locality: '', status: 'under-construction', possessionDate: '', totalUnits: '', configurations: '', reraNumber: '', description: '' });
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await createProject({ ...form, configurations: form.configurations.split(',').map((s) => s.trim()).filter(Boolean), rera: { number: form.reraNumber } });
      toast.show('Project created. Link unit listings to it from the listing form.', 'success');
      setForm({ ...form, name: '', reraNumber: '', description: '' });
      res.reload();
    } catch (err) {
      toast.show(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="two-col">
      <section className="panel">
        <h2 className="panel__title">My projects</h2>
        {res.data?.items?.length ? (
          <ul className="link-list">{res.data.items.map((p) => <li key={p._id}><Link to={`/projects/${p.slug}`}>{p.name}</Link> <span className="muted small">— {p.locality}, {p.city} · {labelize(p.status)}</span> <ReraBadge status={p.rera?.status} small /></li>)}</ul>
        ) : <p className="muted">No projects yet.</p>}
      </section>
      <form className="panel form-stack" onSubmit={submit}>
        <h2 className="panel__title">Add a project</h2>
        <input className="input" required placeholder="Project name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="sidebar__row">
          <input className="input" required placeholder="City" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
          <input className="input" required placeholder="Locality" value={form.locality} onChange={(e) => setForm({ ...form, locality: e.target.value })} />
        </div>
        <div className="sidebar__row">
          <select className="select" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {['pre-launch', 'under-construction', 'ready', 'completed'].map((s) => <option key={s} value={s}>{labelize(s)}</option>)}
          </select>
          <input className="input" type="date" aria-label="Possession date" value={form.possessionDate} onChange={(e) => setForm({ ...form, possessionDate: e.target.value })} />
        </div>
        <input className="input" placeholder="Configurations, e.g. 2 BHK, 3 BHK" value={form.configurations} onChange={(e) => setForm({ ...form, configurations: e.target.value })} />
        <input className="input" placeholder="RERA registration number" value={form.reraNumber} onChange={(e) => setForm({ ...form, reraNumber: e.target.value })} />
        <textarea className="input textarea" rows={3} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <button className="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Create project'}</button>
      </form>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const isLister = LISTER_ROLES.includes(user?.role) || user?.role === 'user';

  if (!isLister) {
    return (
      <div className="container section">
        <Helmet><title>My activity | PropFinder</title><meta name="robots" content="noindex" /></Helmet>
        <header className="page-head"><h1>Welcome back, {user?.name}</h1><p className="muted">Your {user?.role} account.</p></header>
        <div className="quick-grid">
          <Link className="quick-card" to="/saved?tab=favorites"><span>♡</span><strong>Shortlist</strong><span className="small muted">Saved properties</span></Link>
          <Link className="quick-card" to="/saved?tab=searches"><span>☆</span><strong>Saved searches</strong><span className="small muted">Alerts for new matches</span></Link>
          <Link className="quick-card" to="/saved?tab=enquiries"><span>📅</span><strong>Enquiries & visits</strong><span className="small muted">Track your requests</span></Link>
          <Link className="quick-card" to="/compare"><span>⇄</span><strong>Compare</strong><span className="small muted">Side-by-side with AI</span></Link>
          <Link className="quick-card" to="/assistant"><span>💬</span><strong>AI assistant</strong><span className="small muted">Ask in plain language</span></Link>
          <Link className="quick-card" to="/profile"><span>⚙️</span><strong>Want to list?</strong><span className="small muted">Switch to owner / agent</span></Link>
        </div>
      </div>
    );
  }

  const tabs = [['listings', 'Listings'], ['leads', 'Leads'], ['visits', 'Site visits'], ['analytics', 'Performance'], ...(user.role === 'builder' || user.role === 'admin' ? [['projects', 'Projects']] : [])];
  const tab = tabs.some(([k]) => k === sp.get('tab')) ? sp.get('tab') : 'listings';

  return (
    <div className="container section">
      <Helmet><title>Dashboard | PropFinder</title><meta name="robots" content="noindex" /></Helmet>
      <header className="page-head page-head--row">
        <div>
          <h1>{user.role === 'builder' ? 'Builder dashboard' : user.role === 'agent' ? 'Agent dashboard' : 'Owner dashboard'}</h1>
          <p className="muted">Welcome back{user?.name ? `, ${user.name}` : ''}.</p>
        </div>
        <div className="btn-row">
          <Link to="/assistant" className="btn btn--outline">💬 Ask AI about my leads</Link>
          <Link to="/post" className="btn btn--primary">Post property</Link>
        </div>
      </header>
      <div className="tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={`tab${tab === k ? ' is-active' : ''}`} onClick={() => setSp({ tab: k })}>{l}</button>)}
      </div>
      <div className="tab-panel">
        {tab === 'listings' && <Listings />}
        {tab === 'leads' && <Leads />}
        {tab === 'visits' && <Visits />}
        {tab === 'analytics' && <Analytics />}
        {tab === 'projects' && <Projects />}
      </div>
    </div>
  );
}
