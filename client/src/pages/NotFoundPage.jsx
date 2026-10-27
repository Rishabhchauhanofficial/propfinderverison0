import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';

export default function NotFoundPage() {
  return (
    <div className="container section not-found">
      <Helmet>
        <title>Page not found | PropFinder</title>
        <meta name="robots" content="noindex" />
      </Helmet>
      <p className="not-found__code">404</p>
      <h1>We could not find that page</h1>
      <p className="muted">The link may be broken or the listing may have been removed.</p>
      <div className="btn-row btn-row--center">
        <Link to="/" className="btn btn--primary">Go to homepage</Link>
        <Link to="/search" className="btn btn--outline">Browse properties</Link>
      </div>
    </div>
  );
}
