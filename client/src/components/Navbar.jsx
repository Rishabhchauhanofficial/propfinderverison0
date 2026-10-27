import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { getNotifications, markNotificationsRead } from '../api/client.js';
import { formatDate, labelize } from '../utils/format.js';
import { LISTER_ROLES } from '../utils/constants.js';

function Notifications() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ items: [], unread: 0 });
  const ref = useRef(null);
  const location = useLocation();

  const load = () => getNotifications().then(setData).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next && data.unread) {
      await markNotificationsRead().catch(() => {});
      setData((d) => ({ ...d, unread: 0 }));
    }
  }

  return (
    <div className="notif" ref={ref}>
      <button type="button" className="icon-btn icon-btn--nav" aria-label={`Notifications${data.unread ? `, ${data.unread} unread` : ''}`} aria-expanded={open} onClick={toggle}>
        🔔{data.unread > 0 && <span className="notif__dot">{data.unread > 9 ? '9+' : data.unread}</span>}
      </button>
      {open && (
        <div className="notif__panel" role="menu">
          <strong className="notif__title">Notifications</strong>
          {data.items.length === 0 && <p className="muted small">You're all caught up.</p>}
          <ul>
            {data.items.slice(0, 12).map((n) => (
              <li key={n._id} className={n.read ? '' : 'is-unread'}>
                {n.link ? <Link to={n.link}>{n.title}</Link> : <span>{n.title}</span>}
                {n.body && <p className="small muted">{n.body}</p>}
                <span className="tiny muted">{formatDate(n.createdAt)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [menuOpen, setMenuOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const userMenuRef = useRef(null);

  useEffect(() => {
    setMenuOpen(false);
    setUserOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function onPointerDown(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setUserOpen(false);
    }
    const onScroll = () => setScrolled(window.scrollY > 8);
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  function handleLogout() {
    logout();
    setUserOpen(false);
    navigate('/');
  }

  const initial = (user?.name || '?').trim().charAt(0).toUpperCase();
  const isLister = user && LISTER_ROLES.includes(user.role);

  return (
    <header className={`navbar${scrolled ? ' is-scrolled' : ''}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      <div className="container navbar__inner">
        <Link to="/" className="brand" aria-label="PropFinder home">
          <span className="brand__mark" aria-hidden="true">PF</span>
          <span className="brand__name">PropFinder</span>
        </Link>

        <nav className={`navbar__links${menuOpen ? ' is-open' : ''}`} aria-label="Primary">
          <NavLink to="/buy">Buy</NavLink>
          <NavLink to="/rent">Rent</NavLink>
          <NavLink to="/commercial">Commercial</NavLink>
          <NavLink to="/projects">New projects</NavLink>
          <NavLink to="/assistant">AI Assistant</NavLink>
          <NavLink to="/compare" className="hide-lg">Compare</NavLink>
          <NavLink to="/saved" className="hide-lg">Saved</NavLink>
          {user && <NavLink to="/dashboard" className="hide-lg">Dashboard</NavLink>}
          {user?.role === 'admin' && <NavLink to="/admin" className="hide-lg">Admin</NavLink>}
        </nav>

        <div className="navbar__actions">
          <Link to="/post" className="navbar__post">
            Post Property <span className="navbar__free">FREE</span>
          </Link>

          {user && <Notifications />}

          {user ? (
            <div className="user-menu" ref={userMenuRef}>
              <button
                type="button"
                className="user-menu__btn"
                aria-haspopup="menu"
                aria-expanded={userOpen}
                onClick={() => setUserOpen((o) => !o)}
              >
                <span className="avatar" aria-hidden="true">{initial}</span>
                <span className="user-menu__name">{user.name}</span>
                <span className="user-menu__caret" aria-hidden="true" />
              </button>

              {userOpen && (
                <div className="user-menu__dropdown" role="menu">
                  <span className="user-menu__role">{labelize(user.role)}</span>
                  <Link role="menuitem" to="/dashboard">{isLister ? 'Dashboard' : 'My activity'}</Link>
                  <Link role="menuitem" to="/saved">Saved & shortlists</Link>
                  <Link role="menuitem" to="/compare">Compare</Link>
                  {isLister && <Link role="menuitem" to="/post">Post a property</Link>}
                  {user.role === 'admin' && <Link role="menuitem" to="/admin">Admin console</Link>}
                  <Link role="menuitem" to="/profile">Profile & settings</Link>
                  <button type="button" role="menuitem" onClick={handleLogout}>
                    Logout
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link to="/login" className="btn btn--ghost btn--sm">Login</Link>
              <Link to="/register" className="btn btn--primary btn--sm hide-xs">Register</Link>
            </>
          )}

          <button
            type="button"
            className="navbar__toggle"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span />
            <span />
            <span />
          </button>
        </div>
      </div>
    </header>
  );
}
