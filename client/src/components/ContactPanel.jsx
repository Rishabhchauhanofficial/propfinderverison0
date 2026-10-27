import { useState } from 'react';
import { Link } from 'react-router-dom';
import { contactLister, errorMessage, requestVisit } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { labelize } from '../utils/format.js';

/** Enquiry, phone reveal (creates a lead) and site-visit request. */
export default function ContactPanel({ property }) {
  const { user } = useAuth();
  const owner = property.owner || {};
  const [tab, setTab] = useState('enquire');
  const [form, setForm] = useState({ message: `Hi, I'm interested in "${property.title}". Is it still available?`, budgetMax: '', purpose: '' });
  const [visit, setVisit] = useState({ when: '', note: '' });
  const [state, setState] = useState({ status: 'idle', msg: '', phone: null });
  const initial = (owner.company || owner.name || 'O').trim().charAt(0).toUpperCase();
  const redirect = `/login?redirect=${encodeURIComponent(window.location.pathname)}`;

  if (property.isOwner) {
    return (
      <div className="owner-box" id="contact">
        <strong>This is your listing</strong>
        <p className="small muted">Enquiries and visit requests appear in your dashboard.</p>
        <Link className="btn btn--outline btn--block" to="/dashboard?tab=leads">Open leads</Link>
      </div>
    );
  }

  async function enquire(e, source = 'contact-form') {
    e?.preventDefault();
    setState({ status: 'busy', msg: '', phone: null });
    try {
      const r = await contactLister(property.id || property._id, {
        message: source === 'phone-reveal' ? '' : form.message,
        source,
        requirements: { budgetMax: form.budgetMax ? Number(form.budgetMax) : null, purpose: form.purpose },
      });
      setState({ status: 'done', msg: r.message, phone: r.phone });
    } catch (err) {
      setState({ status: 'error', msg: errorMessage(err), phone: null });
    }
  }

  async function scheduleVisit(e) {
    e.preventDefault();
    if (!visit.when) return setState({ status: 'error', msg: 'Pick a date and time.' });
    setState({ status: 'busy', msg: '' });
    try {
      const r = await requestVisit({ propertyId: property.id || property._id, scheduledAt: new Date(visit.when).toISOString(), note: visit.note });
      setState({ status: 'done', msg: r.message });
    } catch (err) {
      setState({ status: 'error', msg: errorMessage(err) });
    }
  }

  const min = new Date(Date.now() + 60 * 60000).toISOString().slice(0, 16);

  return (
    <div className="owner-box" id="contact">
      <div className="owner-box__head">
        <span className="avatar avatar--lg" aria-hidden="true">{initial}</span>
        <div>
          <strong>{owner.company || owner.name || 'Lister'}</strong>
          <div className="muted small">{labelize(owner.role || property.postedByRole) || 'Owner'}</div>
        </div>
      </div>

      {property.status !== 'active' ? (
        <p className="muted">This listing is {property.status}; contact is closed.</p>
      ) : !user ? (
        <>
          <p className="small">Sign in to contact the lister or request a site visit. Your number is shared only with this lister.</p>
          <Link className="btn btn--primary btn--block" to={redirect}>Sign in to contact</Link>
        </>
      ) : state.status === 'done' ? (
        <div className="alert alert--success">
          <p>{state.msg}</p>
          {state.phone && <a className="btn btn--primary btn--block" href={`tel:${state.phone.replace(/\s+/g, '')}`}>Call {state.phone}</a>}
        </div>
      ) : (
        <>
          <div className="seg seg--block seg--sm" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'enquire'} className={`seg__btn${tab === 'enquire' ? ' is-active' : ''}`} onClick={() => setTab('enquire')}>Enquire</button>
            <button type="button" role="tab" aria-selected={tab === 'visit'} className={`seg__btn${tab === 'visit' ? ' is-active' : ''}`} onClick={() => setTab('visit')}>Site visit</button>
          </div>
          {tab === 'enquire' ? (
            <form className="form-stack" onSubmit={enquire}>
              <textarea className="input textarea" rows={3} maxLength={2000} aria-label="Message" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
              <div className="sidebar__row">
                <input className="input" type="number" min="0" placeholder="Budget (₹, optional)" aria-label="Budget" value={form.budgetMax} onChange={(e) => setForm({ ...form, budgetMax: e.target.value })} />
                <select className="select" aria-label="Purpose" value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })}>
                  <option value="">Purpose</option>
                  <option value="self-use">Self use</option>
                  <option value="investment">Investment</option>
                  <option value="rental">Rental income</option>
                </select>
              </div>
              <button className="btn btn--primary btn--block" type="submit" disabled={state.status === 'busy'}>{state.status === 'busy' ? 'Sending…' : 'Send enquiry'}</button>
              {property.contactPreference !== 'chat' && (
                <button type="button" className="btn btn--outline btn--block" onClick={() => enquire(null, 'phone-reveal')} disabled={state.status === 'busy'}>Show phone number</button>
              )}
            </form>
          ) : (
            <form className="form-stack" onSubmit={scheduleVisit}>
              <label className="form-field">
                <span className="form-field__label">Preferred date & time</span>
                <input className="input" type="datetime-local" min={min} value={visit.when} onChange={(e) => setVisit({ ...visit, when: e.target.value })} required />
              </label>
              <input className="input" placeholder="Note (optional)" maxLength={300} value={visit.note} onChange={(e) => setVisit({ ...visit, note: e.target.value })} />
              <button className="btn btn--primary btn--block" type="submit" disabled={state.status === 'busy'}>{state.status === 'busy' ? 'Sending…' : 'Request visit'}</button>
            </form>
          )}
          {state.status === 'error' && <p className="field-error">{state.msg}</p>}
        </>
      )}

      <p className="owner-box__note">Never pay a token or booking amount before you have seen the property and verified the documents.</p>
    </div>
  );
}
