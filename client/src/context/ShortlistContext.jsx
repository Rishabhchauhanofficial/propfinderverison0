import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import * as api from '../api/client.js';
import { useAuth } from './AuthContext.jsx';
import { useToast } from './ToastContext.jsx';

/*
 * Favourites are stored on the server (signed-in users only).
 * The compare list is a per-browser working set kept in localStorage.
 */
const ShortlistContext = createContext(null);
const COMPARE_KEY = 'pf_compare';
const MAX_COMPARE = 4;

function readCompare() {
  try {
    const v = JSON.parse(window.localStorage.getItem(COMPARE_KEY) || '[]');
    return Array.isArray(v) ? v.filter((x) => x && x.id).slice(0, MAX_COMPARE) : [];
  } catch {
    return [];
  }
}

export function ShortlistProvider({ children }) {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [favoriteIds, setFavoriteIds] = useState(() => new Set());
  const [compare, setCompare] = useState(readCompare);

  useEffect(() => {
    if (!user) {
      setFavoriteIds(new Set());
      return undefined;
    }
    let cancelled = false;
    api
      .listFavorites()
      .then((d) => !cancelled && setFavoriteIds(new Set(d.ids || [])))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    try {
      window.localStorage.setItem(COMPARE_KEY, JSON.stringify(compare));
    } catch {
      /* storage unavailable */
    }
  }, [compare]);

  const toggleFavorite = useCallback(
    async (id) => {
      if (!user) {
        toast.show('Sign in to save properties to your shortlist.', 'info');
        navigate(`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`);
        return;
      }
      const saved = favoriteIds.has(id);
      // Optimistic update with rollback.
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (saved) next.delete(id);
        else next.add(id);
        return next;
      });
      try {
        if (saved) await api.removeFavorite(id);
        else await api.addFavorite(id);
        toast.show(saved ? 'Removed from your shortlist.' : 'Saved to your shortlist.', 'success');
      } catch (err) {
        setFavoriteIds((prev) => {
          const next = new Set(prev);
          if (saved) next.add(id);
          else next.delete(id);
          return next;
        });
        toast.show(api.errorMessage(err, 'Could not update your shortlist.'), 'error');
      }
    },
    [user, favoriteIds, navigate, location, toast]
  );

  const toggleCompare = useCallback(
    (property) => {
      const id = String(property.id || property._id);
      setCompare((prev) => {
        if (prev.some((p) => p.id === id)) return prev.filter((p) => p.id !== id);
        if (prev.length >= MAX_COMPARE) {
          toast.show(`You can compare up to ${MAX_COMPARE} properties.`, 'info');
          return prev;
        }
        return [...prev, { id, title: property.title, image: property.images?.[0] || property.image || null, price: property.price, listingType: property.listingType }];
      });
    },
    [toast]
  );

  const clearCompare = useCallback(() => setCompare([]), []);

  const value = useMemo(
    () => ({
      favoriteIds,
      isFavorite: (id) => favoriteIds.has(String(id)),
      toggleFavorite,
      compare,
      inCompare: (id) => compare.some((p) => p.id === String(id)),
      toggleCompare,
      clearCompare,
      maxCompare: MAX_COMPARE,
    }),
    [favoriteIds, toggleFavorite, compare, toggleCompare, clearCompare]
  );

  return <ShortlistContext.Provider value={value}>{children}</ShortlistContext.Provider>;
}

export function useShortlist() {
  const ctx = useContext(ShortlistContext);
  if (!ctx) throw new Error('useShortlist must be used inside <ShortlistProvider>');
  return ctx;
}
