import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { errorMessage, getProperty, updateProperty } from '../api/client.js';
import PropertyForm, { toFormValues } from '../components/PropertyForm.jsx';
import Loader from '../components/Loader.jsx';

export default function EditPropertyPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [load, setLoad] = useState({ status: 'loading', property: null, error: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading', property: null, error: '' });

    getProperty(id)
      .then((data) => {
        if (!cancelled) setLoad({ status: 'ready', property: data.property ?? data, error: '' });
      })
      .catch((err) => {
        if (!cancelled) {
          setLoad({ status: 'error', property: null, error: errorMessage(err, 'Could not load this listing.') });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  async function handleSubmit(payload) {
    setBusy(true);
    setError('');
    try {
      const saved = await updateProperty(id, payload);
      navigate(payload.status === 'active' ? `/property/${saved.slug || id}` : '/dashboard');
    } catch (err) {
      setError(errorMessage(err, 'Could not save your changes. Please try again.'));
      setBusy(false);
    }
  }

  if (load.status === 'loading') {
    return (
      <div className="container section">
        <Loader label="Loading listing…" />
      </div>
    );
  }

  if (load.status === 'error') {
    return (
      <div className="container section">
        <div className="empty-state">
          <h1>Listing unavailable</h1>
          <p className="alert alert--error">{load.error}</p>
          <Link to="/dashboard" className="btn btn--outline">Back to my listings</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="container page-narrow">
      <Helmet>
        <title>Edit listing | PropFinder</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <header className="page-head">
        <h1>Edit listing</h1>
        <p className="muted">Update details, photos, RERA information or status. Changing the RERA number restarts verification.</p>
      </header>

      <div className="card card--pad">
        <PropertyForm
          key={id}
          initialValues={toFormValues(load.property)}
          onSubmit={handleSubmit}
          busy={busy}
          error={error}
          showStatus
          submitLabel="Save changes"
        />
      </div>
    </div>
  );
}
