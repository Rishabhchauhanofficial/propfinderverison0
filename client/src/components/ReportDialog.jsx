import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage, reportContent } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Modal } from './ui.jsx';

const REASONS = {
  property: [
    ['misleading', 'Misleading details or photos'],
    ['wrong-price', 'Wrong price'],
    ['already-sold', 'Already sold / rented'],
    ['duplicate', 'Duplicate listing'],
    ['fraud', 'Suspected fraud or scam'],
    ['other', 'Something else'],
  ],
  review: [
    ['fake-review', 'Looks fake or paid'],
    ['abusive', 'Abusive or hateful'],
    ['spam', 'Spam or advertising'],
    ['misleading', 'Misleading'],
    ['other', 'Something else'],
  ],
};

export default function ReportDialog({ open, onClose, targetType, targetId }) {
  const { user } = useAuth();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [state, setState] = useState({ status: 'idle', msg: '' });

  async function submit(e) {
    e.preventDefault();
    if (!reason) return setState({ status: 'error', msg: 'Choose a reason.' });
    setState({ status: 'busy', msg: '' });
    try {
      const r = await reportContent({ targetType, targetId, reason, details });
      setState({ status: 'done', msg: r.message });
    } catch (err) {
      setState({ status: 'error', msg: errorMessage(err) });
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={targetType === 'review' ? 'Report this review' : 'Report this listing'} size="sm">
      {!user ? (
        <p>
          Please <Link to={`/login?redirect=${encodeURIComponent(window.location.pathname)}`}>sign in</Link> to report content. Reports go to our moderators; they never remove content automatically.
        </p>
      ) : state.status === 'done' ? (
        <p className="alert alert--success">{state.msg}</p>
      ) : (
        <form className="form-stack" onSubmit={submit}>
          <fieldset className="radio-list">
            <legend className="form-field__label">What’s wrong?</legend>
            {REASONS[targetType].map(([v, l]) => (
              <label key={v}>
                <input type="radio" name="reason" value={v} checked={reason === v} onChange={() => setReason(v)} /> {l}
              </label>
            ))}
          </fieldset>
          <label className="form-field">
            <span className="form-field__label">Details (optional)</span>
            <textarea className="input textarea" rows={3} maxLength={2000} value={details} onChange={(e) => setDetails(e.target.value)} />
          </label>
          {state.status === 'error' && <p className="field-error">{state.msg}</p>}
          <button className="btn btn--primary" type="submit" disabled={state.status === 'busy'}>
            {state.status === 'busy' ? 'Sending…' : 'Send report'}
          </button>
        </form>
      )}
    </Modal>
  );
}
