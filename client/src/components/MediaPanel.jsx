import { Link, useLocation } from 'react-router-dom';
import { formatFileSize } from '../utils/format.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Videos, video link and brochures for a property or project.
 * Signed out (item.media.locked): counts of what is hidden and a sign-in link back to this page.
 */
export default function MediaPanel({ item }) {
  const location = useLocation();
  const media = item?.media;
  if (!media) return null;

  if (media.locked) {
    const hiddenPhotos = Math.max(0, media.images - (item.images?.length || 0));
    const parts = [
      hiddenPhotos > 0 && plural(hiddenPhotos, 'more photo'),
      media.videos > 0 && plural(media.videos, 'video'),
      media.brochures > 0 && plural(media.brochures, 'brochure'),
    ].filter(Boolean);
    if (!parts.length) return null;
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return (
      <section className="panel media-lock" aria-labelledby="media-lock-title">
        <div className="media-lock__icon" aria-hidden="true">🔒</div>
        <div className="media-lock__body">
          <h2 id="media-lock-title" className="panel__title">Sign in to see everything</h2>
          <p className="small">{parts.join(' · ')} are available after you sign in. It's free.</p>
        </div>
        <div className="media-lock__actions">
          <Link className="btn btn--primary btn--sm" to={`/login?redirect=${next}`}>Sign in</Link>
          <Link className="btn btn--outline btn--sm" to={`/register?redirect=${next}`}>Create account</Link>
        </div>
      </section>
    );
  }

  const videos = item.videos || [];
  const brochures = item.brochures || [];
  if (!videos.length && !brochures.length && !item.videoUrl) return null;
  return (
    <section className="panel" aria-labelledby="media-title">
      <h2 id="media-title" className="panel__title">Videos &amp; brochures</h2>
      {videos.length > 0 && (
        <div className="media-videos">
          {videos.map((v) => (
            <figure key={v.url}>
              <video controls preload="metadata" src={v.src} />
              <figcaption className="tiny muted">{v.name}</figcaption>
            </figure>
          ))}
        </div>
      )}
      {item.videoUrl && (
        <p><a href={item.videoUrl} target="_blank" rel="noopener noreferrer nofollow">Watch the video tour ↗</a></p>
      )}
      {brochures.length > 0 && (
        <ul className="doc-list">
          {brochures.map((b) => (
            <li key={b.url}>
              <a href={b.src} target="_blank" rel="noopener noreferrer">📄 {b.name || 'Brochure'}</a>
              {b.size ? <span className="tiny muted"> · {formatFileSize(b.size)}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="tiny muted">Provided by the lister. Links expire after two hours; reload the page to refresh them.</p>
    </section>
  );
}
