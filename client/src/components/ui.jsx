import { Component, useEffect, useRef } from 'react';
import { useReveal } from '../hooks/useUi.js';

/* ---------- skeletons ---------- */

export function Skeleton({ w = '100%', h = 14, r = 6, className = '' }) {
  return <span className={`skeleton ${className}`} style={{ width: w, height: h, borderRadius: r }} aria-hidden="true" />;
}

export function CardSkeleton() {
  return (
    <div className="prop-card prop-card--skeleton" aria-hidden="true">
      <div className="prop-card__media skeleton" />
      <div className="prop-card__body">
        <Skeleton w="45%" h={20} />
        <Skeleton w="90%" />
        <Skeleton w="60%" />
        <div className="chips">
          <Skeleton w={50} h={22} />
          <Skeleton w={60} h={22} />
          <Skeleton w={70} h={22} />
        </div>
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 6 }) {
  return (
    <div className="results-grid" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

export function PanelSkeleton({ lines = 4 }) {
  return (
    <div className="panel" aria-hidden="true">
      <Skeleton w="35%" h={20} />
      <div className="stack-sm" style={{ marginTop: 14 }}>
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} w={`${90 - i * 12}%`} />
        ))}
      </div>
    </div>
  );
}

/* ---------- states ---------- */

export function EmptyState({ icon = '🔍', title, children, action }) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon" aria-hidden="true">{icon}</div>
      <h2>{title}</h2>
      {children && <div className="muted">{children}</div>}
      {action && <div className="btn-row btn-row--center">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="alert alert--error" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="btn btn--outline btn--sm" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/* ---------- reveal on scroll ---------- */

export function Reveal({ as: Tag = 'div', className = '', delay = 0, children, ...rest }) {
  const ref = useReveal();
  return (
    <Tag ref={ref} className={`reveal ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined} {...rest}>
      {children}
    </Tag>
  );
}

/* ---------- modal ---------- */

export function Modal({ open, title, onClose, children, footer, size = 'md' }) {
  const panel = useRef(null);
  const lastFocus = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    lastFocus.current = document.activeElement;
    const t = setTimeout(() => panel.current?.querySelector('input,select,textarea,button')?.focus(), 30);
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
      if (e.key === 'Tab' && panel.current) {
        const f = panel.current.querySelectorAll('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      lastFocus.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal__panel modal__panel--${size}`} role="dialog" aria-modal="true" aria-label={title} ref={panel}>
        <header className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="modal__close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}

/* ---------- badges ---------- */

export function DemoBadge({ small = false }) {
  return (
    <span className={`badge badge--demo${small ? ' badge--sm' : ''}`} title="Sample data for demonstration — not a real listing">
      Demo
    </span>
  );
}

const RERA_TONES = {
  verified: ['good', 'RERA verified'],
  'found-needs-review': ['warn', 'RERA: needs review'],
  'not-verified': ['muted', 'RERA not verified yet'],
  mismatch: ['bad', 'RERA details mismatch'],
  'not-found': ['bad', 'RERA not found'],
  'not-applicable': ['muted', 'RERA not applicable'],
};

export function ReraBadge({ status, small = false }) {
  const t = RERA_TONES[status];
  if (!t) return null;
  return <span className={`badge badge--${t[0]}${small ? ' badge--sm' : ''}`}>{t[1]}</span>;
}

export function ConfidencePill({ level }) {
  if (!level) return null;
  return <span className={`conf conf--${level}`}>{level === 'none' ? 'No data' : `${level} confidence`}</span>;
}

export function Stars({ value = 0, size = 'md', label }) {
  const v = Math.round(Number(value) * 2) / 2;
  return (
    <span className={`stars stars--${size}`} role="img" aria-label={label || `${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= v ? 'is-on' : i - 0.5 === v ? 'is-half' : ''} aria-hidden="true">
          ★
        </span>
      ))}
    </span>
  );
}

/* ---------- error boundary ---------- */

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error('[ui] render error:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="container section">
          <EmptyState icon="⚠️" title="Something went wrong on this page" action={<button type="button" className="btn btn--primary" onClick={() => window.location.reload()}>Reload</button>}>
            Try reloading. If the problem continues, contact support.
          </EmptyState>
        </div>
      );
    }
    return this.props.children;
  }
}
