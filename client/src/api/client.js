import axios from 'axios';

export const TOKEN_KEY = 'pf_token';

/* ---------- token storage (guarded: storage can be blocked or throw) ---------- */

export function getStoredToken() {
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the session simply will not persist */
  }
}

/* ---------- axios instance ---------- */

export const http = axios.create({
  baseURL: '/api',
  timeout: 30000,
});

http.interceptors.request.use((config) => {
  const token = getStoredToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const unwrap = (res) => res.data;

/** Drop undefined / null / empty-string params so the query string stays clean. */
export function cleanParams(params = {}) {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
}

/** Human-readable message for any axios / API error. */
export function errorMessage(err, fallback = 'Something went wrong. Please try again.') {
  const apiMsg = err?.response?.data?.error || err?.response?.data?.message;
  if (typeof apiMsg === 'string' && apiMsg) return apiMsg;
  if (err?.response?.status === 429) return 'Too many requests. Please wait a moment and try again.';
  if (err?.code === 'ECONNABORTED') return 'The request timed out. Please try again.';
  if (!err?.response && err?.request) return 'Cannot reach the server. Check your connection.';
  return err?.message || fallback;
}

const enc = encodeURIComponent;

/* ---------- auth ---------- */

export const register = (data) => http.post('/auth/register', data).then(unwrap);
export const login = (data) => http.post('/auth/login', data).then(unwrap);
export const me = () => http.get('/auth/me').then(unwrap);
export const updateProfile = (data) => http.patch('/auth/me', data).then(unwrap);
export const changePassword = (data) => http.post('/auth/change-password', data).then(unwrap);
export const forgotPassword = (email) => http.post('/auth/forgot-password', { email }).then(unwrap);
export const resetPassword = (data) => http.post('/auth/reset-password', data).then(unwrap);

/* ---------- phone + OTP (demo) ---------- */
/** returns: { sent, phone, expiresInSec, devCode? } */
export const otpRequest = (phone) => http.post('/auth/otp/request', { phone }).then(unwrap);
/** data: { phone, code, name? } -> { token, user } */
export const otpVerify = (data) => http.post('/auth/otp/verify', data).then(unwrap);

/* ---------- uploads ---------- */
/** files: FileList | File[]; returns { urls: [...] } */
export const uploadImages = (files) => {
  const fd = new FormData();
  Array.from(files).forEach((f) => fd.append('images', f));
  return http.post('/uploads', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(unwrap);
};
/** Private documents (PDF/images); returns { files: [{url,name,mime}] } */
export const uploadDocuments = (files) => {
  const fd = new FormData();
  Array.from(files).forEach((f) => fd.append('files', f));
  return http.post('/uploads/documents', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then(unwrap);
};
/** Opens a private file with the auth header (cannot use a plain link). */
export async function openPrivateFile(url) {
  const res = await http.get(url.replace(/^\/api/, ''), { responseType: 'blob' });
  const href = URL.createObjectURL(res.data);
  window.open(href, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(href), 60000);
}

/* ---------- properties ---------- */

export const listProperties = (params = {}) => http.get('/properties', { params: cleanParams(params) }).then(unwrap);
export const suggest = (q) => http.get('/properties/suggest', { params: { q } }).then(unwrap);
/** returns: { property, related } */
export const getProperty = (id) => http.get(`/properties/${enc(id)}`).then(unwrap);
export const createProperty = (data) => http.post('/properties', data).then(unwrap);
export const updateProperty = (id, data) => http.put(`/properties/${enc(id)}`, data).then(unwrap);
export const setPropertyStatus = (id, status) => http.patch(`/properties/${enc(id)}/status`, { status }).then(unwrap);
export const deleteProperty = (id) => http.delete(`/properties/${enc(id)}`).then(unwrap);
export const myProperties = () => http.get('/properties/mine').then(unwrap);
export const contactLister = (id, data) => http.post(`/properties/${enc(id)}/contact`, data).then(unwrap);

/* ---------- localities, market, geo ---------- */

export const getLocalities = () => http.get('/localities').then(unwrap);
export const getLocalityInsights = (city, locality) => http.get(`/localities/${enc(city)}/${enc(locality)}/insights`).then(unwrap);
export const geocode = (q) => http.get('/geo/geocode', { params: { q } }).then(unwrap);
export const getStats = () => http.get('/stats').then(unwrap);
export const getMethodology = () => http.get('/methodology').then(unwrap);

/* ---------- ai ---------- */

export const getReport = (id, params = {}) =>
  http.get(`/ai/properties/${enc(id)}/report`, { params: cleanParams(params), timeout: 60000 }).then(unwrap);
export const getMarketing = (id) => http.get(`/ai/properties/${enc(id)}/marketing`).then(unwrap);
export const compareProperties = (ids, priorities = []) => http.post('/ai/compare', { ids, priorities }, { timeout: 90000 }).then(unwrap);
export const draftDescription = (data) => http.post('/ai/draft-description', data).then(unwrap);

/* ---------- RERA ---------- */

export const getReraAuthorities = () => http.get('/rera/authorities').then(unwrap);
export const getPropertyRera = (id) => http.get(`/rera/properties/${enc(id)}`).then(unwrap);
export const addReraEvidence = (id, files) => http.post(`/rera/properties/${enc(id)}/evidence`, { files }).then(unwrap);

/* ---------- projects ---------- */

export const listProjects = (params = {}) => http.get('/projects', { params: cleanParams(params) }).then(unwrap);
export const getProject = (slug) => http.get(`/projects/${enc(slug)}`).then(unwrap);
export const myProjects = () => http.get('/projects/mine').then(unwrap);
export const createProject = (data) => http.post('/projects', data).then(unwrap);
export const updateProject = (id, data) => http.put(`/projects/${enc(id)}`, data).then(unwrap);

/* ---------- reviews & reports ---------- */

export const listReviews = (params) => http.get('/reviews', { params: cleanParams(params) }).then(unwrap);
export const createReview = (data) => http.post('/reviews', data).then(unwrap);
export const updateReview = (id, data) => http.put(`/reviews/${enc(id)}`, data).then(unwrap);
export const deleteReview = (id) => http.delete(`/reviews/${enc(id)}`).then(unwrap);
export const replyToReview = (id, body) => http.post(`/reviews/${enc(id)}/replies`, { body }).then(unwrap);
export const reportContent = (data) => http.post('/reports', data).then(unwrap);

/* ---------- personal ---------- */

export const listFavorites = () => http.get('/me/favorites').then(unwrap);
export const addFavorite = (id) => http.post(`/me/favorites/${enc(id)}`).then(unwrap);
export const removeFavorite = (id) => http.delete(`/me/favorites/${enc(id)}`).then(unwrap);
export const listSavedSearches = () => http.get('/me/saved-searches').then(unwrap);
export const saveSearch = (data) => http.post('/me/saved-searches', data).then(unwrap);
export const touchSavedSearch = (id, data = {}) => http.patch(`/me/saved-searches/${enc(id)}`, data).then(unwrap);
export const deleteSavedSearch = (id) => http.delete(`/me/saved-searches/${enc(id)}`).then(unwrap);
export const recentlyViewed = () => http.get('/me/recently-viewed').then(unwrap);
export const clearRecentlyViewed = () => http.delete('/me/recently-viewed').then(unwrap);
export const getNotifications = () => http.get('/me/notifications').then(unwrap);
export const markNotificationsRead = (ids = []) => http.post('/me/notifications/read', { ids }).then(unwrap);
export const myEnquiries = () => http.get('/me/enquiries').then(unwrap);

/* ---------- leads & visits ---------- */

export const listLeads = (params = {}) => http.get('/leads', { params: cleanParams(params) }).then(unwrap);
export const updateLead = (id, data) => http.patch(`/leads/${enc(id)}`, data).then(unwrap);
export const requestVisit = (data) => http.post('/visits', data).then(unwrap);
export const listVisits = (as) => http.get('/visits', { params: cleanParams({ as }) }).then(unwrap);
export const updateVisit = (id, data) => http.patch(`/visits/${enc(id)}`, data).then(unwrap);

/* ---------- contact ---------- */

export const sendContact = (data) => http.post('/contact', data).then(unwrap);

/* ---------- admin ---------- */

export const admin = {
  stats: () => http.get('/admin/stats').then(unwrap),
  users: (params) => http.get('/admin/users', { params: cleanParams(params) }).then(unwrap),
  updateUser: (id, data) => http.patch(`/admin/users/${enc(id)}`, data).then(unwrap),
  listings: (params) => http.get('/admin/listings', { params: cleanParams(params) }).then(unwrap),
  moderateListing: (id, data) => http.patch(`/admin/listings/${enc(id)}`, data).then(unwrap),
  deleteListing: (id, data) => http.delete(`/admin/listings/${enc(id)}`, { data }).then(unwrap),
  rera: (params) => http.get('/admin/rera', { params: cleanParams(params) }).then(unwrap),
  reraCheck: (id) => http.post(`/admin/rera/${enc(id)}/check`).then(unwrap),
  reraReview: (id, data) => http.put(`/admin/rera/${enc(id)}`, data).then(unwrap),
  reviews: (params) => http.get('/admin/reviews', { params: cleanParams(params) }).then(unwrap),
  moderateReview: (id, data) => http.patch(`/admin/reviews/${enc(id)}`, data).then(unwrap),
  reports: (params) => http.get('/admin/reports', { params: cleanParams(params) }).then(unwrap),
  resolveReport: (id, data) => http.patch(`/admin/reports/${enc(id)}`, data).then(unwrap),
  analysis: (params) => http.get('/admin/analysis', { params: cleanParams(params) }).then(unwrap),
  rerunAnalysis: (id) => http.post(`/admin/analysis/${enc(id)}/rerun`, null, { timeout: 90000 }).then(unwrap),
  integrations: () => http.get('/admin/integrations').then(unwrap),
  searchAnalytics: () => http.get('/admin/search-analytics').then(unwrap),
  auditLogs: (params) => http.get('/admin/audit-logs', { params: cleanParams(params) }).then(unwrap),
  messages: () => http.get('/admin/messages').then(unwrap),
  closeMessage: (id) => http.patch(`/admin/messages/${enc(id)}`).then(unwrap),
};

/* ---------- chat (Server-Sent Events over POST) ---------- */

/**
 * Streams an assistant reply. Handlers: onMeta, onDelta(text, {replace}), onDone, onError.
 * Returns an abort function.
 */
export function streamChat(body, { onMeta, onDelta, onDone, onError }) {
  const controller = new AbortController();
  (async () => {
    try {
      const token = getStoredToken();
      const res = await fetch('/api/chat', {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
      if (!res.ok || !res.body) {
        let msg = res.status === 429 ? 'You are sending messages too quickly. Please wait a minute.' : 'The assistant is unavailable right now.';
        try {
          msg = (await res.json()).error || msg;
        } catch {
          /* not JSON */
        }
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const blocks = buf.split('\n\n');
        buf = blocks.pop();
        for (const block of blocks) {
          const event = block.match(/^event: (.+)$/m)?.[1];
          const raw = block.match(/^data: (.+)$/m)?.[1];
          if (!event) continue;
          const data = raw ? JSON.parse(raw) : null;
          if (event === 'meta') onMeta?.(data);
          else if (event === 'delta') onDelta?.(data.text, data);
          else if (event === 'done') onDone?.(data);
          else if (event === 'error') onError?.(new Error(data?.message || 'Something went wrong.'));
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') onError?.(err);
    }
  })();
  return () => controller.abort();
}

export const chatHistory = (sessionId) => http.get('/chat/history', { params: { sessionId } }).then(unwrap);
export const clearChat = (sessionId) => http.delete('/chat/history', { params: { sessionId } }).then(unwrap);
