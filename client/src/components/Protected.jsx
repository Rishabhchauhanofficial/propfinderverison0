import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import Loader from './Loader.jsx';
import { EmptyState } from './ui.jsx';

/**
 * Route guard: renders children only for a signed-in user (optionally with one of `roles`).
 * This is a UX convenience — the API enforces every permission on the server.
 */
export default function Protected({ children, roles }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="container section">
        <Loader label="Checking your session…" />
      </div>
    );
  }

  if (!user) {
    const redirect = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?redirect=${redirect}`} replace />;
  }

  if (roles && !roles.includes(user.role)) {
    return (
      <div className="container section">
        <EmptyState icon="🔒" title="You don’t have access to this page">
          This area is for {roles.join(' / ')} accounts.
        </EmptyState>
      </div>
    );
  }

  return children;
}
