import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { errorMessage, forgotPassword, getMethodology, getReraAuthorities, resetPassword, sendContact } from '../api/client.js';
import { useAsync } from '../hooks/useUi.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useChat } from '../context/ChatContext.jsx';
import ChatPanel from '../components/chat/ChatPanel.jsx';
import { PanelSkeleton } from '../components/ui.jsx';

/* ---------------- assistant ---------------- */

export function AssistantPage() {
  const { pendingMessage, setPendingMessage } = useChat();
  return (
    <div className="container section assistant-page">
      <Helmet><title>AI property assistant | PropFinder</title></Helmet>
      <header className="page-head">
        <h1>AI property assistant</h1>
        <p className="muted">Search in plain language, compare shortlisted homes, check RERA status, ask about schools or metro near a property, or get listing help. Answers come from PropFinder records and cite their sources.</p>
      </header>
      <div className="assistant-layout">
        <div className="panel panel--flush">
          <ChatPanel variant="page" initialMessage={pendingMessage} onInitialConsumed={() => setPendingMessage('')} />
        </div>
        <aside className="panel assistant-tips">
          <h2 className="panel__title">Try asking</h2>
          <ul className="tight-list small">
            <li>“Find a 3 BHK flat in Gurgaon under ₹4 crore”</li>
            <li>“2 BHK for rent in Whitefield under 45k”</li>
            <li>“Which of these has better metro connectivity?” (after adding listings to Compare)</li>
            <li>“Is this project’s RERA registration verified?” (from a property page)</li>
            <li>“Calculate EMI at 8.5% for 20 years”</li>
            <li>“What should I verify before paying a booking amount?”</li>
            <li>Agents: “show my leads”, “matching buyers”</li>
          </ul>
          <p className="tiny muted">The assistant gives general information, not legal or financial advice. It will tell you when data is missing.</p>
        </aside>
      </div>
    </div>
  );
}

/* ---------------- password reset ---------------- */

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState({ status: 'idle', msg: '', devUrl: '' });
  return (
    <div className="auth-wrap">
      <Helmet><title>Reset password | PropFinder</title><meta name="robots" content="noindex" /></Helmet>
      <div className="auth-card">
        <h1 className="auth-card__title">Forgot your password?</h1>
        <p className="muted auth-card__sub">Enter your account email and we’ll send a reset link.</p>
        {state.status === 'done' ? (
          <div className="form-stack">
            <p className="alert alert--success">{state.msg}</p>
            {state.devUrl && (
              <p className="otp-demo">Email delivery isn’t configured in this environment. Development link: <Link to={state.devUrl.replace(/^https?:\/\/[^/]+/, '')}>reset password</Link></p>
            )}
          </div>
        ) : (
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setState({ status: 'busy', msg: '' });
              try {
                const r = await forgotPassword(email.trim());
                setState({ status: 'done', msg: r.message, devUrl: r.devResetUrl || '' });
              } catch (err) {
                setState({ status: 'error', msg: errorMessage(err) });
              }
            }}
          >
            <label className="form-field"><span className="form-field__label">Email</span><input className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            {state.status === 'error' && <p className="field-error">{state.msg}</p>}
            <button className="btn btn--primary btn--block" type="submit" disabled={state.status === 'busy'}>Send reset link</button>
          </form>
        )}
        <p className="auth-card__switch small"><Link to="/login">Back to sign in</Link></p>
      </div>
    </div>
  );
}

export function ResetPasswordPage() {
  const [sp] = useSearchParams();
  const { setSession } = useAuth();
  const [password, setPassword] = useState('');
  const [state, setState] = useState({ status: 'idle', msg: '' });
  return (
    <div className="auth-wrap">
      <Helmet><title>Choose a new password | PropFinder</title><meta name="robots" content="noindex" /></Helmet>
      <div className="auth-card">
        <h1 className="auth-card__title">Choose a new password</h1>
        {state.status === 'done' ? (
          <p className="alert alert--success">Password updated. <Link to="/dashboard">Continue</Link></p>
        ) : (
          <form
            className="form-stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setState({ status: 'busy', msg: '' });
              try {
                const r = await resetPassword({ email: sp.get('email'), token: sp.get('token'), password });
                setSession(r);
                setState({ status: 'done', msg: '' });
              } catch (err) {
                setState({ status: 'error', msg: errorMessage(err) });
              }
            }}
          >
            <label className="form-field">
              <span className="form-field__label">New password</span>
              <input className="input" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} />
              <span className="hint">At least 8 characters with a letter and a number.</span>
            </label>
            {state.status === 'error' && <p className="field-error">{state.msg}</p>}
            <button className="btn btn--primary btn--block" type="submit" disabled={state.status === 'busy'}>Update password</button>
          </form>
        )}
      </div>
    </div>
  );
}

/* ---------------- contact & support ---------------- */

export function ContactPage() {
  const { user } = useAuth();
  const [form, setForm] = useState({ name: user?.name || '', email: user?.email?.endsWith('.local') ? '' : user?.email || '', topic: 'general', message: '' });
  const [state, setState] = useState({ status: 'idle', msg: '' });
  return (
    <div className="container page-narrow section">
      <Helmet><title>Contact & support | PropFinder</title></Helmet>
      <header className="page-head">
        <h1>Contact & support</h1>
        <p className="muted">Questions about a listing, your account, RERA verification or a report? Send us a message. To report a specific listing or review, use the Report button on it.</p>
      </header>
      <div className="card card--pad">
        {state.status === 'done' ? (
          <p className="alert alert--success">{state.msg}</p>
        ) : (
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              setState({ status: 'busy', msg: '' });
              try {
                const r = await sendContact(form);
                setState({ status: 'done', msg: r.message });
              } catch (err) {
                setState({ status: 'error', msg: errorMessage(err) });
              }
            }}
          >
            <label className="form-field"><span className="form-field__label">Name</span><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label className="form-field"><span className="form-field__label">Email</span><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label className="form-field form-field--full">
              <span className="form-field__label">Topic</span>
              <select className="select" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })}>
                <option value="general">General question</option>
                <option value="listing">A listing</option>
                <option value="account">My account</option>
                <option value="rera">RERA verification</option>
                <option value="report">Report a problem</option>
                <option value="partnership">Partnerships / data</option>
              </select>
            </label>
            <label className="form-field form-field--full"><span className="form-field__label">Message</span><textarea className="input textarea" rows={6} required minLength={10} maxLength={4000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
            {state.status === 'error' && <p className="field-error form-field--full">{state.msg}</p>}
            <div className="form-field--full"><button className="btn btn--primary" type="submit" disabled={state.status === 'busy'}>Send message</button></div>
          </form>
        )}
      </div>
    </div>
  );
}

/* ---------------- methodology ---------------- */

export function MethodologyPage() {
  const res = useAsync(getMethodology, []);
  return (
    <div className="container page-narrow section">
      <Helmet><title>How PropFinder scores properties | Methodology</title><meta name="description" content="How PropFinder's AI Property Intelligence Report calculates location, connectivity, price and documentation scores, and what it does not claim." /></Helmet>
      <header className="page-head">
        <h1>How the AI Property Intelligence Report works</h1>
        <p className="intro">Scores are built from evidence we can show you. When evidence is missing, the score is left blank and confidence goes down — we never fill gaps with guesses.</p>
      </header>
      {res.status === 'loading' && <PanelSkeleton lines={6} />}
      {res.data && (
        <>
          <section className="panel">
            <h2 className="panel__title">Scores and default weights</h2>
            <table className="table">
              <thead><tr><th>Score</th><th>Weight in overall</th></tr></thead>
              <tbody>{Object.entries(res.data.scores).map(([k, s]) => <tr key={k}><td>{s.label}</td><td>{Math.round(s.weight * 100)}%</td></tr>)}</tbody>
            </table>
            <p className="small">The overall score is the weighted average of the scores that have data. If fewer than three scores (or less than 35% of the weight) have data, no overall score is given. Choosing priorities multiplies the relevant weights.</p>
          </section>
          <section className="panel">
            <h2 className="panel__title">Location, connectivity, amenities, education, healthcare</h2>
            <p className="small">Nearby facilities come from the configured map source (OpenStreetMap by default). Each factor is scored from straight-line distance bands, e.g. metro station:</p>
            <ul className="tight-list small">{res.data.distanceBands.metro.bands.map(([km, pts]) => <li key={km}>within {km} km → {pts} points</li>)}<li>farther / none found → {res.data.distanceBands.metro.beyond} points</li></ul>
            <p className="small">Components and weights:</p>
            <ul className="tight-list small">{Object.entries(res.data.components).map(([k, c]) => <li key={k}><strong>{k}</strong>: {Object.entries(c).map(([f, w]) => `${f} ${Math.round(w * 100)}%`).join(', ')}</li>)}</ul>
            <p className="small">Map data can miss facilities, so locality scores are never shown with “high” confidence. Presence of a school or hospital says nothing about its quality — we do not rate schools or infer safety, and never use demographics, religion or caste.</p>
            <p className="small">Employment-hub distance uses a hand-curated list of approximate hub locations: {res.data.hubs.slice(0, 6).join('; ')}…</p>
          </section>
          <section className="panel">
            <h2 className="panel__title">Price competitiveness & rental potential</h2>
            <p className="small">We compare asking price per sq ft with active PropFinder listings in widening tiers (same locality and type and similar size → same locality → within {res.data.comparables.cityRadiusKm} km → same city) and use the first tier with at least {res.data.comparables.minSample} listings. Within ±{res.data.comparables.fairBandPct}% of the median is “near market”. Confidence is high at {res.data.comparables.highConfidenceSample}+ comparables.</p>
            <p className="small">These are <strong>asking prices, not transaction prices</strong>. No historical price trends or appreciation forecasts are given because no licensed transaction-history source is configured.</p>
            <p className="small">Rental potential = gross yield from the median asking rent per sq ft of comparable rentals. Bands: {res.data.yieldBands.map(([y, s]) => `≥${y}% → ${s}`).join(', ')}.</p>
          </section>
          <section className="panel">
            <h2 className="panel__title">Documentation & verification</h2>
            <p className="small">A checklist of disclosures (photos, map pin, carpet area, description, documents) and verification (RERA registration verified against the official record; listing checked by PropFinder). RERA counts for 40% only where registration applies. This measures transparency — it is not a legal title check.</p>
          </section>
          <p className="disclaimer">Scoring version {res.data.version}. AI scores are estimates and are not guarantees of investment performance, property quality, legal title or future appreciation.</p>
        </>
      )}
    </div>
  );
}

/* ---------------- RERA info ---------------- */

export function ReraInfoPage() {
  const res = useAsync(getReraAuthorities, []);
  return (
    <div className="container page-narrow section">
      <Helmet><title>RERA verification & legal checklist | PropFinder</title><meta name="description" content="State RERA authorities, what PropFinder's RERA verification statuses mean, and the documents to check before buying property in India." /></Helmet>
      <header className="page-head">
        <h1>RERA verification & due diligence</h1>
        <p className="intro">Each state and union territory has its own Real Estate Regulatory Authority. PropFinder checks a listing’s registration against the authority for the property’s location.</p>
      </header>
      {res.data && (
        <>
          <section className="panel">
            <h2 className="panel__title">What our statuses mean</h2>
            <dl className="defs">{Object.entries(res.data.statuses).map(([k, v]) => <div key={k}><dt>{v}</dt></div>)}</dl>
            <p className="small">We never label a property “RERA approved”. “RERA registration verified” means a reviewer matched the number, project and promoter against the official record and recorded the source and date. A missing search result does not by itself prove a project is unlawful — exemptions apply and portals can be incomplete.</p>
            <p className="disclaimer">{res.data.disclaimer}</p>
          </section>
          <section className="panel">
            <h2 className="panel__title">Document checklist</h2>
            <table className="table">
              <thead><tr><th>Check</th><th>Who can help</th></tr></thead>
              <tbody>{res.data.checklist.map((c) => <tr key={c.item}><td>{c.item}</td><td className="muted">{c.who}</td></tr>)}</tbody>
            </table>
            <p className="small muted">General information only — get independent legal advice before paying any booking amount.</p>
          </section>
          <section className="panel">
            <h2 className="panel__title">State RERA authorities</h2>
            <ul className="link-list">{res.data.authorities.map((a) => <li key={a.code}><a href={a.url} target="_blank" rel="noopener noreferrer">{a.authority}</a> <span className="muted small">— {a.state}</span></li>)}</ul>
            <p className="tiny muted">Links point to each authority’s public portal. Portals change; if a link fails, search for the state authority directly.</p>
          </section>
        </>
      )}
    </div>
  );
}
