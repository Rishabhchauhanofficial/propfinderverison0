import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { changePassword, errorMessage, updateProfile } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { PUBLIC_ROLES } from '../utils/constants.js';

export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ name: user.name, phone: user.phone || '', company: user.company || '', city: user.city || '', role: user.role });
  const [prefs, setPrefs] = useState({ leads: true, siteVisits: true, savedSearches: true, reviews: true, ...(user.notificationPrefs || {}) });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await updateProfile({ ...form, ...(user.role === 'admin' ? { role: undefined } : {}), notificationPrefs: prefs });
      updateUser(r);
      toast.show('Profile saved.', 'success');
    } catch (err) {
      toast.show(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container page-narrow section">
      <Helmet><title>Profile & settings | PropFinder</title><meta name="robots" content="noindex" /></Helmet>
      <header className="page-head"><h1>Profile & settings</h1><p className="muted">{user.email.endsWith('.local') ? 'Signed in with mobile OTP' : user.email}</p></header>

      <form className="card card--pad form-grid" onSubmit={save}>
        <label className="form-field"><span className="form-field__label">Full name</span><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="form-field"><span className="form-field__label">Phone</span><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /><span className="hint">Shared only with listers you contact, or buyers who contact you.</span></label>
        <label className="form-field"><span className="form-field__label">City</span><input className="input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></label>
        <label className="form-field"><span className="form-field__label">Agency / company</span><input className="input" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label>
        {user.role !== 'admin' && (
          <fieldset className="form-field form-field--full radio-cards">
            <legend className="form-field__label">Account type</legend>
            {PUBLIC_ROLES.map((r) => (
              <label key={r.value} className={`radio-card${form.role === r.value ? ' is-active' : ''}`}>
                <input type="radio" name="role" value={r.value} checked={form.role === r.value} onChange={() => setForm({ ...form, role: r.value })} />
                <strong>{r.label}</strong>
                <span className="small muted">{r.hint}</span>
              </label>
            ))}
          </fieldset>
        )}
        <fieldset className="form-field form-field--full">
          <legend className="form-field__label">In-app notifications</legend>
          {[['leads', 'New leads and enquiries'], ['siteVisits', 'Site-visit requests and updates'], ['savedSearches', 'New matches for saved searches'], ['reviews', 'Replies and reviews']].map(([k, l]) => (
            <label key={k} className="check"><input type="checkbox" checked={prefs[k]} onChange={(e) => setPrefs({ ...prefs, [k]: e.target.checked })} /> {l}</label>
          ))}
          <span className="hint">Email/SMS delivery is not configured yet; notifications appear under the bell icon.</span>
        </fieldset>
        <div className="form-field--full"><button className="btn btn--primary" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>
      </form>

      {!user.email.endsWith('.local') && (
        <form
          className="card card--pad form-grid"
          style={{ marginTop: 16 }}
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await changePassword(pw);
              setPw({ currentPassword: '', newPassword: '' });
              toast.show('Password changed.', 'success');
            } catch (err) {
              toast.show(errorMessage(err), 'error');
            }
          }}
        >
          <h2 className="form-field--full panel__title">Change password</h2>
          <label className="form-field"><span className="form-field__label">Current password</span><input className="input" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} /></label>
          <label className="form-field"><span className="form-field__label">New password</span><input className="input" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} /></label>
          <div className="form-field--full"><button className="btn btn--outline" type="submit">Update password</button></div>
        </form>
      )}
    </div>
  );
}
