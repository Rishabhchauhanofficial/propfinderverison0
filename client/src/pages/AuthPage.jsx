import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { errorMessage, otpRequest, otpVerify } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import { ACTIVITY_CONSENT_TEXT, PUBLIC_ROLES } from '../utils/constants.js';

/** Only allow same-site relative redirects, e.g. "/dashboard". */
function safeRedirect(value) {
  if (typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')) return value;
  return '/';
}

export default function AuthPage({ mode = 'login' }) {
  const isLogin = mode === 'login';
  const { user, login, register, setSession } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const redirect = safeRedirect(params.get('redirect'));

  // Registration defaults to email so the account type can be chosen.
  const [method, setMethod] = useState(isLogin ? 'otp' : 'password'); // 'otp' | 'password'

  // ----- shared -----
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // ----- OTP state -----
  const [otpStage, setOtpStage] = useState('phone'); // 'phone' | 'code'
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState('');

  // ----- password state -----
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', role: params.get('role') || 'buyer', company: '', shareActivity: false });
  const setF = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  if (user) return <Navigate to={redirect} replace />;

  const withRedirect = (base) =>
    `${base}${params.get('redirect') ? `?redirect=${encodeURIComponent(redirect)}` : ''}`;

  // ---------- OTP handlers ----------
  async function sendOtp(e) {
    e?.preventDefault();
    setError('');
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 10) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    setBusy(true);
    try {
      const res = await otpRequest(phone);
      setDevCode(res.devCode || '');
      setOtpStage('code');
    } catch (err) {
      setError(errorMessage(err, 'Could not send the code.'));
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e) {
    e.preventDefault();
    setError('');
    if (!code.trim()) {
      setError('Enter the code you received.');
      return;
    }
    setBusy(true);
    try {
      const data = await otpVerify({ phone, code: code.trim(), name: name.trim() });
      setSession(data);
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Could not verify the code.'));
      setBusy(false);
    }
  }

  // ---------- password handlers ----------
  async function submitPassword(e) {
    e.preventDefault();
    setError('');
    const email = form.email.trim();
    if (!email || !form.password) {
      setError('Enter your email and password.');
      return;
    }
    if (!isLogin) {
      if (!form.name.trim()) return setError('Enter your full name.');
      if (form.password.length < 8 || !/[A-Za-z]/.test(form.password) || !/d/.test(form.password)) return setError('Password must be at least 8 characters with a letter and a number.');
    }
    setBusy(true);
    try {
      if (isLogin) {
        await login({ email, password: form.password });
      } else {
        await register({ name: form.name.trim(), email, phone: form.phone.trim(), password: form.password, role: form.role, company: form.company.trim(), shareActivity: form.shareActivity === true });
      }
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(errorMessage(err, isLogin ? 'Could not sign you in.' : 'Could not create your account.'));
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <Helmet>
        <title>{isLogin ? 'Sign in | PropFinder' : 'Create account | PropFinder'}</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="auth-card">
        <div className="auth-card__brand">
          <span className="brand__mark" aria-hidden="true">PF</span>
          <span>PropFinder</span>
        </div>
        <h1 className="auth-card__title">{isLogin ? 'Login or Sign up' : 'Create your account'}</h1>
        <p className="muted auth-card__sub">
          {isLogin
            ? 'Continue with your mobile number or email to manage listings and contact owners.'
            : 'Join free to post properties, save searches and get AI price insights.'}
        </p>

        <div className="auth-tabs" role="tablist" aria-label="Login method">
          <button
            type="button"
            role="tab"
            aria-selected={method === 'otp'}
            className={`auth-tab${method === 'otp' ? ' is-active' : ''}`}
            onClick={() => { setMethod('otp'); setError(''); }}
          >
            Mobile OTP
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={method === 'password'}
            className={`auth-tab${method === 'password' ? ' is-active' : ''}`}
            onClick={() => { setMethod('password'); setError(''); }}
          >
            Email &amp; password
          </button>
        </div>

        {/* ---------- OTP ---------- */}
        {method === 'otp' && (
          <>
            {otpStage === 'phone' && (
              <form className="form-stack" onSubmit={sendOtp} noValidate>
                <label className="form-field">
                  <span className="form-field__label">Mobile number</span>
                  <div className="phone-input">
                    <span className="phone-input__cc">+91</span>
                    <input
                      className="input"
                      type="tel"
                      autoComplete="tel"
                      inputMode="numeric"
                      placeholder="98xxxxxxxx"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      autoFocus
                    />
                  </div>
                </label>
                {!isLogin && (
                  <label className="form-field">
                    <span className="form-field__label">Your name (optional)</span>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                  </label>
                )}
                {error && <div className="alert alert--error" role="alert">{error}</div>}
                <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
                  {busy ? 'Sending…' : 'Send OTP'}
                </button>
              </form>
            )}

            {otpStage === 'code' && (
              <form className="form-stack" onSubmit={verifyOtp} noValidate>
                <p className="muted">
                  Code sent to <strong>+91 {phone}</strong>.{' '}
                  <button type="button" className="link-btn" onClick={() => { setOtpStage('phone'); setCode(''); setError(''); }}>
                    Change
                  </button>
                </p>

                {devCode && (
                  <div className="otp-demo" role="status">
                    SMS isn’t configured in this environment — your development OTP is <strong>{devCode}</strong>.
                  </div>
                )}

                <label className="form-field">
                  <span className="form-field__label">Enter OTP</span>
                  <input
                    className="input input--otp"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="----"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    autoFocus
                  />
                </label>

                {error && <div className="alert alert--error" role="alert">{error}</div>}

                <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
                  {busy ? 'Verifying…' : 'Verify & continue'}
                </button>
                <button type="button" className="link-btn" onClick={sendOtp} disabled={busy}>
                  Resend OTP
                </button>
              </form>
            )}
          </>
        )}

        {/* ---------- password ---------- */}
        {method === 'password' && (
          <form className="form-stack" onSubmit={submitPassword} noValidate>
            {!isLogin && (
              <>
                <label className="form-field">
                  <span className="form-field__label">Full name</span>
                  <input className="input" autoComplete="name" value={form.name} onChange={(e) => setF('name', e.target.value)} required />
                </label>
                <fieldset className="form-field radio-cards radio-cards--compact">
                  <legend className="form-field__label">I am a</legend>
                  {PUBLIC_ROLES.map((r) => (
                    <label key={r.value} className={`radio-card${form.role === r.value ? ' is-active' : ''}`}>
                      <input type="radio" name="role" value={r.value} checked={form.role === r.value} onChange={() => setF('role', r.value)} />
                      <strong>{r.label}</strong>
                    </label>
                  ))}
                </fieldset>
                {['agent', 'builder'].includes(form.role) && (
                  <label className="form-field">
                    <span className="form-field__label">{form.role === 'builder' ? 'Developer / company name' : 'Agency name (optional)'}</span>
                    <input className="input" value={form.company} onChange={(e) => setF('company', e.target.value)} />
                  </label>
                )}
                <label className="form-field">
                  <span className="form-field__label">Phone (optional)</span>
                  <input className="input" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => setF('phone', e.target.value)} placeholder="+91 98xxxxxxxx" />
                </label>
              </>
            )}
            <label className="form-field">
              <span className="form-field__label">Email</span>
              <input className="input" type="email" autoComplete="email" value={form.email} onChange={(e) => setF('email', e.target.value)} required />
            </label>
            <label className="form-field">
              <span className="form-field__label">Password</span>
              <input
                className="input"
                type="password"
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                value={form.password}
                onChange={(e) => setF('password', e.target.value)}
                required
              />
              {!isLogin && <span className="hint">At least 8 characters, with a letter and a number.</span>}
              {isLogin && <Link to="/forgot-password" className="hint">Forgot password?</Link>}
            </label>
            {!isLogin && (
              <label className="check consent">
                <input type="checkbox" checked={form.shareActivity} onChange={(e) => setF('shareActivity', e.target.checked)} />
                <span className="small">
                  <strong>Optional:</strong> {ACTIVITY_CONSENT_TEXT}
                </span>
              </label>
            )}
            {error && <div className="alert alert--error" role="alert">{error}</div>}
            <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
              {busy ? 'Please wait…' : isLogin ? 'Sign in' : 'Create account'}
            </button>
          </form>
        )}

        <p className="auth-card__switch muted">
          {isLogin ? (
            <>New to PropFinder? <Link to={withRedirect('/register')}>Create an account</Link></>
          ) : (
            <>Already registered? <Link to={withRedirect('/login')}>Sign in</Link></>
          )}
        </p>
      </div>
    </div>
  );
}
