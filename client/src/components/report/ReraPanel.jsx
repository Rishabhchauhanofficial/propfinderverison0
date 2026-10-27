import { useEffect, useRef, useState } from 'react';
import { addReraEvidence, errorMessage, getPropertyRera, openPrivateFile, uploadDocuments } from '../../api/client.js';
import { ReraBadge } from '../ui.jsx';
import { formatDate } from '../../utils/format.js';

const ICON = { verified: '✅', 'found-needs-review': '🟡', 'not-verified': '⏳', mismatch: '⚠️', 'not-found': '❌', 'not-applicable': 'ℹ️', 'not-provided': '—' };

/** RERA status, evidence and legal-scope notes for a listing. */
export default function ReraPanel({ propertyId, isOwner }) {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const [upload, setUpload] = useState({ busy: false, msg: '', error: '' });
  const fileRef = useRef(null);

  const load = () =>
    getPropertyRera(propertyId)
      .then((data) => setState({ status: 'ready', data, error: '' }))
      .catch((err) => setState({ status: 'error', data: null, error: errorMessage(err) }));

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  async function onFiles(files) {
    if (!files?.length) return;
    setUpload({ busy: true, msg: '', error: '' });
    try {
      const { files: uploaded } = await uploadDocuments(files);
      await addReraEvidence(propertyId, uploaded);
      setUpload({ busy: false, msg: 'Evidence uploaded. A reviewer will check it against the official record.', error: '' });
      load();
    } catch (err) {
      setUpload({ busy: false, msg: '', error: errorMessage(err, 'Upload failed.') });
    }
  }

  if (state.status === 'loading') return <section className="panel"><p className="muted">Loading RERA information…</p></section>;
  if (state.status === 'error') return <section className="panel"><p className="alert alert--error">{state.error}</p></section>;
  const r = state.data;

  return (
    <section className="panel" id="rera" aria-labelledby="rera-title">
      <header className="panel__head">
        <h2 id="rera-title">RERA registration</h2>
        <ReraBadge status={r.status} />
      </header>

      <div className={`rera-status rera-status--${r.status}`}>
        <span className="rera-status__icon" aria-hidden="true">{ICON[r.status]}</span>
        <div>
          <strong>{r.label}</strong>
          {r.statusNote && <p className="small">{r.statusNote}</p>}
        </div>
      </div>

      <dl className="specs specs--2">
        <div className="spec"><dt>Registration number (as listed)</dt><dd>{r.registrationNumber || '—'}</dd></div>
        <div className="spec"><dt>Authority</dt><dd>{r.authority ? r.authority.authority : 'Unknown — set the state on the listing'}</dd></div>
        <div className="spec"><dt>Verification method</dt><dd>{r.method === 'manual-review' ? 'Manual review against the official portal' : r.method === 'official-api' ? 'Official data feed' : 'Not checked yet'}</dd></div>
        <div className="spec"><dt>Last verified</dt><dd>{r.lastVerifiedAt ? formatDate(r.lastVerifiedAt) : '—'}</dd></div>
      </dl>

      {r.official && (
        <div className="rera-official">
          <h3 className="pc-title">Official record (as checked)</h3>
          <dl className="specs specs--2">
            <div className="spec"><dt>Project</dt><dd>{r.official.projectName || '—'}</dd></div>
            <div className="spec"><dt>Promoter</dt><dd>{r.official.promoterName || '—'}</dd></div>
            <div className="spec"><dt>Registration status</dt><dd>{r.official.registrationStatus || '—'}</dd></div>
            <div className="spec"><dt>Valid until</dt><dd>{r.official.validUntil ? formatDate(r.official.validUntil) : '—'}</dd></div>
            <div className="spec"><dt>Declared completion</dt><dd>{r.official.declaredCompletion ? formatDate(r.official.declaredCompletion) : '—'}</dd></div>
          </dl>
        </div>
      )}

      {r.discrepancies?.length > 0 && (
        <div className="alert alert--warn">
          <strong>Differences from the official record</strong>
          <ul>{r.discrepancies.map((d, i) => <li key={i}>{d}</li>)}</ul>
        </div>
      )}

      {r.officialUrl && (
        <p className="small">
          Check it yourself:{' '}
          <a href={r.officialUrl} target="_blank" rel="noopener noreferrer">{r.authority?.state ? `${r.authority.state} RERA portal` : 'official RERA portal'} ↗</a>
          {!r.automatedCheckAvailable && ' (no automated official feed is available for this state, so PropFinder verifies manually).'}
        </p>
      )}

      {isOwner && r.registrationNumber && (
        <div className="owner-tools">
          <strong className="small">Lister tools</strong>
          <p className="small muted">Upload the RERA registration certificate (PDF or image) to speed up verification. Documents are private to you and PropFinder reviewers.</p>
          <input ref={fileRef} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
          <button type="button" className="btn btn--outline btn--sm" disabled={upload.busy} onClick={() => fileRef.current?.click()}>
            {upload.busy ? 'Uploading…' : 'Upload evidence'}
          </button>
          {upload.msg && <p className="hint">{upload.msg}</p>}
          {upload.error && <p className="field-error">{upload.error}</p>}
          {r.evidence?.length > 0 && (
            <ul className="evidence">
              {r.evidence.map((e) => (
                <li key={e.url}>
                  <button type="button" className="link-btn" onClick={() => openPrivateFile(e.url)}>{e.name || 'Document'}</button> <span className="tiny muted">{formatDate(e.uploadedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <details className="report__more">
        <summary>When is RERA registration required?</summary>
        <ul>{r.applicability.map((a, i) => <li key={i}>{a}</li>)}</ul>
      </details>
      <p className="disclaimer">{r.disclaimer}</p>
    </section>
  );
}
