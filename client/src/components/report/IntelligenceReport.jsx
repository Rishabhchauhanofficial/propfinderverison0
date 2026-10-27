import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getReport, errorMessage } from '../../api/client.js';
import { ScoreGauge, FairnessBadge, SourceTag } from '../AiBadge.jsx';
import { ConfidencePill, PanelSkeleton } from '../ui.jsx';
import NearbyMap, { CATEGORY_COLORS } from '../NearbyMap.jsx';
import { formatDate, formatINR } from '../../utils/format.js';
import { PRIORITIES } from '../../utils/constants.js';

const GROUPS = [
  ['transport', 'Transport', ['metro', 'railway', 'bus_stop', 'airport', 'major_road']],
  ['education', 'Education', ['school', 'college']],
  ['healthcare', 'Healthcare', ['hospital', 'clinic', 'pharmacy']],
  ['daily', 'Daily needs', ['supermarket', 'market', 'bank', 'atm', 'fuel', 'ev_charging']],
  ['shopping', 'Shopping', ['mall']],
  ['lifestyle', 'Lifestyle', ['park', 'gym', 'restaurant']],
];

function ScoreRow({ s }) {
  const [open, setOpen] = useState(false);
  const pct = s.value ?? 0;
  return (
    <li className={`score-row${s.value === null ? ' is-null' : ''}`}>
      <button type="button" className="score-row__head" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="score-row__label">{s.label}</span>
        <span className="score-row__bar" aria-hidden="true">
          <span style={{ width: `${pct}%` }} className={pct >= 70 ? 'good' : pct >= 45 ? 'warn' : 'bad'} />
        </span>
        <span className="score-row__value">{s.notApplicable ? 'N/A' : s.value === null ? '—' : s.value}</span>
        <ConfidencePill level={s.notApplicable ? null : s.confidence} />
        <span className="score-row__caret" aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="score-row__body">
          <p>{s.explanation}</p>
          {s.inputs?.length > 0 && (
            <table className="mini-table">
              <tbody>
                {s.inputs.map((i, k) => (
                  <tr key={k}>
                    <th scope="row">{i.factor}</th>
                    <td>{i.value}</td>
                    {i.points !== undefined && <td className="muted">{i.points} pts</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s.method && <p className="small muted"><strong>Method:</strong> {s.method}</p>}
        </div>
      )}
    </li>
  );
}

function NearbySection({ nearby, center }) {
  const [enabled, setEnabled] = useState(() => new Set(['metro', 'school', 'hospital', 'supermarket']));
  const toggle = (keys) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      const allOn = keys.every((k) => next.has(k));
      keys.forEach((k) => (allOn ? next.delete(k) : next.add(k)));
      return next;
    });

  if (nearby.status === 'pending') {
    return (
      <div className="nearby-loading" role="status">
        <span className="radar" aria-hidden="true" />
        <div>
          <strong>Fetching nearby facilities…</strong>
          <p className="small muted">{nearby.message} The report updates automatically.</p>
        </div>
      </div>
    );
  }
  if (!nearby.categories) {
    return <p className="alert alert--info">{nearby.message || 'Nearby-facility data is unavailable for this listing.'}</p>;
  }

  return (
    <>
      <div className="chip-row" role="group" aria-label="Show on map">
        {GROUPS.map(([g, label, keys]) => {
          const on = keys.some((k) => enabled.has(k));
          return (
            <button key={g} type="button" className={`chip${on ? ' is-active' : ''}`} aria-pressed={on} onClick={() => toggle(keys)}>
              <span className="dot" style={{ background: CATEGORY_COLORS[g] }} aria-hidden="true" /> {label}
            </button>
          );
        })}
      </div>
      {center && <NearbyMap center={center} categories={nearby.categories} meta={nearby.meta} enabled={enabled} />}
      <div className="nearby-grid">
        {GROUPS.map(([g, label, keys]) => (
          <div key={g} className="nearby-group">
            <h4><span className="dot" style={{ background: CATEGORY_COLORS[g] }} aria-hidden="true" /> {label}</h4>
            {keys.map((k) => {
              const c = nearby.categories[k];
              const m = nearby.meta?.[k];
              if (!c || !m) return null;
              return (
                <div key={k} className="nearby-cat">
                  <div className="nearby-cat__head">
                    <span>{m.label}</span>
                    <span className="muted small">{c.count ? `${c.count} within ${m.radiusKm} km` : `none within ${m.radiusKm} km`}</span>
                  </div>
                  <ul>
                    {c.nearest.slice(0, 3).map((p) => (
                      <li key={p.id}>
                        <span>{p.name}</span>
                        <span className="muted">
                          {p.distanceKm} km{p.roadDistanceKm != null ? ` · ${p.roadDistanceKm} km by road` : ''}
                          {p.driveMinutes != null ? ` · ~${p.driveMinutes} min` : ''}
                          {p.rating ? ` · ${p.rating}★ (${p.ratingCount}, ${p.ratingSource})` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <p className="tiny muted">
        Distances are <strong>straight-line</strong>
        {nearby.routed ? '; road distance and drive time are shown where routing returned a result' : ' — no routing service is configured, so travel times are not shown'}. Data:{' '}
        {nearby.attribution?.url ? <a href={nearby.attribution.url} target="_blank" rel="noopener noreferrer">{nearby.attribution.text}</a> : nearby.attribution?.text}
        {nearby.fetchedAt ? `, fetched ${formatDate(nearby.fetchedAt)}` : ''}. Presence of a facility does not tell us its quality.
      </p>
    </>
  );
}

/** Full AI Property Intelligence Report for a listing. */
export default function IntelligenceReport({ propertyId, property }) {
  const [priorities, setPriorities] = useState([]);
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const polls = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let timer;
    const load = (quiet) => {
      if (!quiet) setState((s) => ({ ...s, status: s.data ? 'refreshing' : 'loading' }));
      getReport(propertyId, { priorities: priorities.join(',') })
        .then((data) => {
          if (cancelled) return;
          setState({ status: 'ready', data, error: '' });
          // Poll while locality data is still being fetched in the background.
          if (data.nearby?.status === 'pending' && polls.current < 12) {
            polls.current += 1;
            timer = setTimeout(() => load(true), 8000);
          }
        })
        .catch((err) => !cancelled && setState({ status: 'error', data: null, error: errorMessage(err, 'Could not load the analysis.') }));
    };
    load(false);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [propertyId, priorities]);

  const { data } = state;
  const overall = data?.personalized?.overall || data?.overall;
  const center = useMemo(() => (property?.location?.lat != null ? { lat: Number(property.location.lat), lng: Number(property.location.lng) } : null), [property]);

  if (state.status === 'loading') {
    return (
      <section className="panel report" aria-busy="true">
        <div className="report__loading">
          <span className="ai-orb" aria-hidden="true" />
          <div>
            <strong>Building the property intelligence report…</strong>
            <p className="small muted">Checking nearby facilities, comparable listings and RERA records.</p>
          </div>
        </div>
        <PanelSkeleton lines={5} />
      </section>
    );
  }
  if (state.status === 'error') return <section className="panel"><p className="alert alert--error">{state.error}</p></section>;

  const pos = data.price.position;
  const comps = data.price.comparables;

  return (
    <section className="panel report" id="ai-report" aria-labelledby="report-title">
      <header className="panel__head">
        <h2 id="report-title">AI Property Intelligence Report</h2>
        <SourceTag source={data.narrative.source} />
      </header>

      <div className="report__top">
        <ScoreGauge score={overall?.value} label={overall?.value != null ? `${overall.label} · ${overall.confidence} confidence` : 'Insufficient data'} size="lg" />
        <div className="report__summary">
          <p className="report__text">{data.narrative.summary}</p>
          <p className="small muted">{overall?.explanation}</p>
          <div className="prio">
            <span className="small">Weight for my priorities:</span>
            {PRIORITIES.map((p) => {
              const on = priorities.includes(p.value);
              return (
                <button key={p.value} type="button" title={p.hint} className={`chip chip--sm${on ? ' is-active' : ''}`} aria-pressed={on} onClick={() => setPriorities((prev) => (on ? prev.filter((x) => x !== p.value) : [...prev, p.value]))}>
                  {p.label}
                </button>
              );
            })}
            {state.status === 'refreshing' && <span className="tiny muted">Updating…</span>}
          </div>
        </div>
      </div>

      <div className="pros-cons">
        <div>
          <h3 className="pc-title pc-title--pro">Strengths found</h3>
          <ul className="pros">{data.narrative.pros.length ? data.narrative.pros.map((x, i) => <li key={i}>{x}</li>) : <li className="muted">None identified from the available data</li>}</ul>
        </div>
        <div>
          <h3 className="pc-title pc-title--con">Weaknesses found</h3>
          <ul className="cons">{data.narrative.cons.length ? data.narrative.cons.map((x, i) => <li key={i}>{x}</li>) : <li className="muted">None identified from the available data</li>}</ul>
        </div>
      </div>
      {data.narrative.watchouts?.length > 0 && (
        <div className="watchouts">
          <h3 className="pc-title">Check before you decide</h3>
          <ul>{data.narrative.watchouts.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}

      <h3 className="report__h">Suitability scores</h3>
      <ul className="score-list">{data.scores.map((s) => <ScoreRow key={s.key} s={s} />)}</ul>
      <p className="tiny muted">Tap a score to see how it was calculated. <Link to="/methodology">Full methodology</Link></p>

      <h3 className="report__h">Price vs comparable listings</h3>
      <div className="price-pos">
        <FairnessBadge verdict={pos.verdict} />
        {pos.verdict !== 'insufficient-data' ? (
          <>
            <div className="price-scale" aria-hidden="true">
              <span className="price-scale__band" />
              <span className="price-scale__marker" style={{ left: `${Math.max(2, Math.min(98, 50 + pos.deltaPct * 1.5))}%` }} />
            </div>
            <p className="small">
              This listing asks <strong>₹{pos.thisPerSqft.toLocaleString('en-IN')}/sq ft</strong>; the median of {pos.sampleSize} comparable listings is <strong>₹{pos.medianPerSqft.toLocaleString('en-IN')}/sq ft</strong> ({pos.deltaPct > 0 ? '+' : ''}{pos.deltaPct}%). Comparable set: {comps.scope?.toLowerCase()}
              {comps.period ? `, posted ${formatDate(comps.period.from)} – ${formatDate(comps.period.to)}` : ''}.
              {comps.demoCount ? ` ${comps.demoCount} of them are demo listings.` : ''}
            </p>
          </>
        ) : (
          <p className="small">Only {pos.sampleSize} comparable active listing(s) were found — too few for a fair price comparison. Check recent registered sale prices or ask a local valuer.</p>
        )}
        <p className="tiny muted">Based on asking prices of active PropFinder listings, not completed transactions.</p>
      </div>
      {comps.items?.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Comparable</th>
                <th>Price</th>
                <th>Area</th>
                <th>₹/sq ft</th>
                <th>Distance</th>
              </tr>
            </thead>
            <tbody>
              {comps.items.map((c) => (
                <tr key={c.id}>
                  <td><Link to={`/property/${c.slug || c.id}`}>{c.title}</Link>{c.isDemo ? <span className="tiny muted"> (demo)</span> : null}</td>
                  <td>{formatINR(c.price)}</td>
                  <td>{c.areaSqft} sq ft</td>
                  <td>₹{c.perSqft.toLocaleString('en-IN')}</td>
                  <td>{c.distanceKm != null ? `${c.distanceKm} km` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.rental?.applicable && (
        <>
          <h3 className="report__h">Rental potential</h3>
          {data.rental.grossYieldPct != null ? (
            <p className="small">
              Estimated rent <strong>{formatINR(data.rental.estimateMonthly)}/month</strong> (range {formatINR(data.rental.rangeMonthly[0])}–{formatINR(data.rental.rangeMonthly[1])}) from {data.rental.sampleSize} comparable rental listings → gross yield ≈ <strong>{data.rental.grossYieldPct}%</strong>. {data.rental.note}
            </p>
          ) : (
            <p className="small muted">{data.rental.note}</p>
          )}
        </>
      )}

      <h3 className="report__h">Location & connectivity</h3>
      {data.employmentHub && (
        <p className="small">Nearest major employment hub (approximate): <strong>{data.employmentHub.name}</strong>, {data.employmentHub.distanceKm} km straight-line.</p>
      )}
      <NearbySection nearby={data.nearby} center={center} />

      <details className="report__more">
        <summary>Data limitations ({data.limitations.length})</summary>
        <ul>{data.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul>
      </details>
      <p className="disclaimer">{data.disclaimer} Generated {formatDate(data.generatedAt)}{data.cached ? ' (cached)' : ''}.</p>
    </section>
  );
}
