import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { createReview, deleteReview, errorMessage, listReviews, replyToReview, updateReview } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Stars } from './ui.jsx';
import ReportDialog from './ReportDialog.jsx';
import { formatDate } from '../utils/format.js';

const DIMENSIONS = [
  ['overall', 'Overall experience'],
  ['construction', 'Construction quality'],
  ['amenities', 'Amenities'],
  ['maintenance', 'Maintenance'],
  ['location', 'Location'],
  ['connectivity', 'Connectivity'],
  ['valueForMoney', 'Value for money'],
];

const RELATIONSHIPS = [
  ['resident', 'I live / lived here'],
  ['tenant', 'I rent / rented here'],
  ['owner', 'I own a unit here'],
  ['visitor', 'I visited'],
  ['other', 'Other'],
];

function StarInput({ value, onChange, label }) {
  return (
    <div className="star-input" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`} className={n <= (value || 0) ? 'is-on' : ''} onClick={() => onChange(value === n ? null : n)}>
          ★
        </button>
      ))}
    </div>
  );
}

function ReviewForm({ targetType, targetId, existing, onSaved, onCancel }) {
  const [ratings, setRatings] = useState(existing?.ratings || {});
  const [title, setTitle] = useState(existing?.title || '');
  const [body, setBody] = useState(existing?.body || '');
  const [relationship, setRelationship] = useState(existing?.relationship || 'other');
  const [state, setState] = useState({ busy: false, error: '' });
  const toast = useToast();

  async function submit(e) {
    e.preventDefault();
    if (!ratings.overall) return setState({ busy: false, error: 'Give an overall rating.' });
    if (body.trim().length < 30) return setState({ busy: false, error: 'Please write at least 30 characters.' });
    setState({ busy: true, error: '' });
    try {
      const payload = { targetType, targetId, ratings, title, body, relationship };
      const r = existing ? await updateReview(existing.id, payload) : await createReview(payload);
      toast.show(r.message || (r.review?.status === 'pending' ? 'Saved — awaiting moderation.' : 'Review saved.'), 'success');
      onSaved();
    } catch (err) {
      setState({ busy: false, error: errorMessage(err) });
    }
  }

  return (
    <form className="review-form" onSubmit={submit}>
      <div className="review-form__ratings">
        {DIMENSIONS.map(([k, l]) => (
          <div key={k} className="review-form__rating">
            <span className={k === 'overall' ? 'strong' : ''}>{l}{k === 'overall' ? ' *' : ''}</span>
            <StarInput value={ratings[k]} label={l} onChange={(v) => setRatings((r) => ({ ...r, [k]: v }))} />
          </div>
        ))}
      </div>
      <label className="form-field">
        <span className="form-field__label">Your connection</span>
        <select className="select" value={relationship} onChange={(e) => setRelationship(e.target.value)}>
          {RELATIONSHIPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <span className="hint">Shown as self-declared unless PropFinder verifies it.</span>
      </label>
      <label className="form-field">
        <span className="form-field__label">Title (optional)</span>
        <input className="input" maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="form-field">
        <span className="form-field__label">Your experience *</span>
        <textarea className="input textarea" rows={5} maxLength={4000} value={body} onChange={(e) => setBody(e.target.value)} placeholder="What was it like to live here? Maintenance, water, power, neighbours, commute…" />
        <span className="hint">{body.trim().length}/30 characters minimum. No phone numbers or personal details.</span>
      </label>
      {state.error && <p className="field-error">{state.error}</p>}
      <div className="btn-row">
        <button className="btn btn--primary" type="submit" disabled={state.busy}>{state.busy ? 'Saving…' : existing ? 'Update review' : 'Submit review'}</button>
        {onCancel && <button className="btn btn--ghost" type="button" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}

function ReviewItem({ r, canReply, onChanged }) {
  const [report, setReport] = useState(false);
  const [reply, setReply] = useState('');
  const [replying, setReplying] = useState(false);
  const toast = useToast();
  const rel = RELATIONSHIPS.find(([v]) => v === r.relationship)?.[1];

  async function sendReply(e) {
    e.preventDefault();
    try {
      await replyToReview(r.id, reply);
      setReply('');
      setReplying(false);
      onChanged();
    } catch (err) {
      toast.show(errorMessage(err), 'error');
    }
  }

  return (
    <li className="review">
      <div className="review__head">
        <Stars value={r.ratings.overall} />
        {r.title && <strong>{r.title}</strong>}
      </div>
      <div className="review__meta small muted">
        {r.author.name} · {formatDate(r.createdAt)}
        {r.editedAt ? ' · edited' : ''}
        {rel && ` · ${rel}`}
        {r.relationshipVerified ? <span className="badge badge--good badge--sm">Verified {r.relationship}</span> : rel ? <span className="tiny"> (self-declared)</span> : null}
        {r.status === 'pending' && <span className="badge badge--warn badge--sm">Awaiting moderation</span>}
      </div>
      <p className="review__body">{r.body}</p>
      <div className="review__dims small muted">
        {DIMENSIONS.slice(1).filter(([k]) => r.ratings[k]).map(([k, l]) => <span key={k}>{l}: {r.ratings[k]}★</span>)}
      </div>
      {r.replies?.map((x) => (
        <div key={x.id} className="review__reply">
          <strong className="small">{x.authorName} <span className="muted">({x.authorRole})</span></strong>
          <p className="small">{x.body}</p>
        </div>
      ))}
      <div className="review__actions">
        {!r.mine && <button type="button" className="link-btn small" onClick={() => setReport(true)}>Report</button>}
        {canReply && !r.mine && <button type="button" className="link-btn small" onClick={() => setReplying((v) => !v)}>Reply</button>}
      </div>
      {replying && (
        <form className="review__reply-form" onSubmit={sendReply}>
          <textarea className="input textarea" rows={2} maxLength={2000} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply publicly (you cannot delete reviews)" />
          <button className="btn btn--outline btn--sm" type="submit" disabled={reply.trim().length < 5}>Post reply</button>
        </form>
      )}
      <ReportDialog open={report} onClose={() => setReport(false)} targetType="review" targetId={r.id} />
    </li>
  );
}

/** Reviews for a property, project, developer or locality ("City|Locality"). */
export default function Reviews({ targetType, targetId, title = 'Reviews & ratings', canReply = false }) {
  const { user } = useAuth();
  const [sort, setSort] = useState('newest');
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const [writing, setWriting] = useState(false);
  const [key, setKey] = useState(0);
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    listReviews({ targetType, targetId, sort })
      .then((data) => !cancelled && setState({ status: 'ready', data, error: '' }))
      .catch((err) => !cancelled && setState({ status: 'error', data: null, error: errorMessage(err) }));
    return () => {
      cancelled = true;
    };
  }, [targetType, targetId, sort, key]);

  const refresh = () => {
    setWriting(false);
    setKey((k) => k + 1);
  };

  const data = state.data;
  const summary = data?.summary;
  const max = summary ? Math.max(1, ...summary.distribution.map((d) => d.count)) : 1;

  return (
    <section className="panel" id="reviews" aria-labelledby={`reviews-${targetType}`}>
      <header className="panel__head">
        <h2 id={`reviews-${targetType}`}>{title}</h2>
        {summary?.count > 0 && <span className="muted small">{summary.count} published</span>}
      </header>

      {state.status === 'loading' && <p className="muted">Loading reviews…</p>}
      {state.status === 'error' && <p className="alert alert--error">{state.error}</p>}

      {data && (
        <>
          {summary.count > 0 ? (
            <div className="review-summary">
              <div className="review-summary__score">
                <strong>{summary.dimensions.overall?.avg?.toFixed(1)}</strong>
                <Stars value={summary.dimensions.overall?.avg} />
                <span className="small muted">{summary.count} review{summary.count > 1 ? 's' : ''}</span>
              </div>
              <ul className="dist" aria-label="Rating distribution">
                {[...summary.distribution].reverse().map((d) => (
                  <li key={d.stars}>
                    <span>{d.stars}★</span>
                    <span className="dist__bar"><span style={{ width: `${(d.count / max) * 100}%` }} /></span>
                    <span className="small muted">{d.count}</span>
                  </li>
                ))}
              </ul>
              <ul className="dims">
                {DIMENSIONS.slice(1).map(([k, l]) =>
                  summary.dimensions[k] ? (
                    <li key={k}><span>{l}</span><strong>{summary.dimensions[k].avg}</strong><span className="tiny muted">({summary.dimensions[k].n})</span></li>
                  ) : null
                )}
              </ul>
            </div>
          ) : (
            <p className="muted">No published reviews yet.</p>
          )}

          {data.mine && !writing && (
            <div className="my-review">
              <p className="small">
                Your review{data.mine.status !== 'published' ? ` is ${data.mine.status === 'pending' ? 'awaiting moderation' : data.mine.status}` : ''}.
              </p>
              <div className="btn-row">
                <button type="button" className="btn btn--outline btn--sm" onClick={() => setWriting(true)}>Edit</button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  onClick={async () => {
                    if (!window.confirm('Delete your review?')) return;
                    try {
                      await deleteReview(data.mine.id);
                      refresh();
                    } catch (err) {
                      toast.show(errorMessage(err), 'error');
                    }
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          )}

          {!data.mine && !writing && (
            user ? (
              <button type="button" className="btn btn--outline" onClick={() => setWriting(true)}>Write a review</button>
            ) : (
              <p className="small"><Link to={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>Sign in</Link> to write a review.</p>
            )
          )}
          {writing && <ReviewForm targetType={targetType} targetId={targetId} existing={data.mine} onSaved={refresh} onCancel={() => setWriting(false)} />}

          {data.items.length > 0 && (
            <>
              <div className="review-sort">
                <label className="small" htmlFor={`rs-${targetType}`}>Sort</label>
                <select id={`rs-${targetType}`} className="select select--sm" value={sort} onChange={(e) => setSort(e.target.value)}>
                  <option value="newest">Newest</option>
                  <option value="highest">Highest rated</option>
                  <option value="lowest">Lowest rated</option>
                </select>
              </div>
              <ul className="review-list">
                {data.items.map((r) => <ReviewItem key={r.id} r={r} canReply={canReply} onChanged={refresh} />)}
              </ul>
            </>
          )}
          <p className="tiny muted">
            Reviews are moderated{data.moderation === 'all' ? ' before publishing' : '; reviews flagged by our spam checks wait for a moderator'}. Listers can reply but cannot remove reviews.
          </p>
        </>
      )}
    </section>
  );
}
