import { useEffect, useRef, useState } from 'react';

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    try {
      return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    let mq;
    try {
      mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    } catch {
      return undefined;
    }
    const on = (e) => setReduced(e.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduced;
}

/** Adds `is-visible` to the element once it scrolls into view (CSS handles the animation). */
export function useReveal(options = { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      el.classList.add('is-visible');
      return undefined;
    }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      }
    }, options);
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return ref;
}

/** Animated number that counts up once visible. */
export function useCountUp(target, { duration = 1200 } = {}) {
  const reduced = usePrefersReducedMotion();
  // Show the real number until the animation starts (screen readers, crawlers, off-screen).
  const [value, setValue] = useState(target ?? 0);
  const ref = useRef(null);
  useEffect(() => {
    if (target == null) return undefined;
    setValue(target);
    if (reduced) return undefined;
    const el = ref.current;
    let raf;
    const run = () => {
      setValue(0);
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - start) / duration);
        setValue(Math.round(target * (1 - (1 - p) ** 3)));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    if (!el || typeof IntersectionObserver === 'undefined') {
      run();
      return () => cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        run();
        io.disconnect();
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [target, duration, reduced]);
  return [value, ref];
}

/** Small parallax offset for hero backgrounds (disabled for reduced motion). */
export function useParallax(factor = 0.25) {
  const reduced = usePrefersReducedMotion();
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    if (reduced) return undefined;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setOffset(Math.min(400, window.scrollY) * factor));
    };
    window.addEventListener('scroll', on, { passive: true });
    return () => {
      window.removeEventListener('scroll', on);
      cancelAnimationFrame(raf);
    };
  }, [factor, reduced]);
  return offset;
}

/** Debounced value. */
export function useDebounced(value, ms = 250) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Fetch helper: { status: 'loading'|'ready'|'error', data, error, reload }. */
export function useAsync(fn, deps = []) {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' });
  const [key, setKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    Promise.resolve()
      .then(fn)
      .then((data) => !cancelled && setState({ status: 'ready', data, error: '' }))
      .catch((err) => {
        if (cancelled) return;
        const msg = err?.response?.data?.error || err?.message || 'Something went wrong.';
        setState({ status: 'error', data: null, error: msg, httpStatus: err?.response?.status });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, key]);
  return { ...state, reload: () => setKey((k) => k + 1) };
}
