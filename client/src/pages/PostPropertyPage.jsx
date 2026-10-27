import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { createProperty, errorMessage, updateProfile } from '../api/client.js';
import PropertyForm from '../components/PropertyForm.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { LISTER_ROLES } from '../utils/constants.js';
import { propertyId } from '../utils/format.js';

export default function PostPropertyPage() {
  const navigate = useNavigate();
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(payload) {
    setBusy(true);
    setError('');
    try {
      const created = await createProperty(payload);
      const id = propertyId(created);
      if (!id) throw new Error('Your listing was saved but no id was returned.');
      for (const w of created.warnings || []) toast.show(w, 'info', 6000);
      toast.show(payload.status === 'draft' ? 'Draft saved. Publish it from your dashboard.' : 'Listing published!', 'success');
      navigate(payload.status === 'draft' ? '/dashboard' : `/property/${created.slug || id}`);
    } catch (err) {
      setError(errorMessage(err, 'Could not save your listing. Please try again.'));
      setBusy(false);
    }
  }

  const canList = LISTER_ROLES.includes(user?.role) || user?.role === 'user';

  return (
    <div className="container page-narrow">
      <Helmet>
        <title>Post a property | PropFinder</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <header className="page-head">
        <h1>Post your property</h1>
        <p className="muted">List a home, plot, office or shop for free. Your progress is saved on this device as you type.</p>
      </header>

      {!canList ? (
        <div className="card card--pad">
          <h2 className="panel__title">Switch to a listing account</h2>
          <p>Your account is set up as a <strong>{user?.role}</strong>. To post a property, choose how you list:</p>
          <div className="btn-row">
            {[['owner', 'I am the owner'], ['agent', 'I am an agent'], ['builder', 'I am a builder']].map(([role, label]) => (
              <button
                key={role}
                type="button"
                className="btn btn--outline"
                onClick={async () => {
                  try {
                    updateUser(await updateProfile({ role }));
                  } catch (err) {
                    toast.show(errorMessage(err), 'error');
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="small muted">You can change this any time in <Link to="/profile">Profile</Link>.</p>
        </div>
      ) : (
        <div className="card card--pad">
          <PropertyForm onSubmit={handleSubmit} busy={busy} error={error} submitLabel="Publish listing" persistDraft />
        </div>
      )}
    </div>
  );
}
