// Routes for the v2 modules (everything except auth, properties, ai, uploads, localities and seo).
import { Router } from 'express';
import requireAuth, { optionalAuth, requireRole } from '../middleware/auth.js';
import { chatLimiter, writeLimiter } from '../middleware/rateLimit.js';
import { LISTER_ROLES } from '../models/User.js';
import * as rera from '../controllers/reraController.js';
import * as reviews from '../controllers/reviewController.js';
import * as me from '../controllers/userController.js';
import * as leads from '../controllers/leadController.js';
import * as projects from '../controllers/projectController.js';
import * as admin from '../controllers/adminController.js';
import * as chat from '../controllers/chatController.js';
import * as misc from '../controllers/miscController.js';
import { serveMedia, servePrivateFile } from '../controllers/uploadController.js';

const router = Router();
const lister = [requireAuth, requireRole(...LISTER_ROLES)];
const adminOnly = [requireAuth, requireRole('admin')];

/* public info */
router.get('/stats', misc.publicStats);
router.get('/methodology', misc.methodology);
router.get('/market/benchmark', misc.benchmark);
router.get('/geo/geocode', misc.geocode);
router.get('/localities/:city/:locality/insights', misc.localityInsights);
router.post('/contact', optionalAuth, writeLimiter, misc.contact);

/* private documents */
router.get('/files/:name', requireAuth, servePrivateFile);
// Videos and brochures: the signed link (issued only to signed-in users) is the credential.
router.get('/media/:name', serveMedia);

/* RERA */
router.get('/rera/authorities', rera.authorities);
router.get('/rera/properties/:id', optionalAuth, rera.forProperty);
router.post('/rera/properties/:id/evidence', ...lister, rera.addEvidence);

/* projects */
router.get('/projects', projects.list);
router.get('/projects/mine', requireAuth, projects.mine);
router.get('/projects/:slug', optionalAuth, projects.getOne);
router.post('/projects', requireAuth, writeLimiter, projects.create);
router.put('/projects/:slug', requireAuth, writeLimiter, projects.update);

/* reviews & reports */
router.get('/reviews', optionalAuth, reviews.list);
router.post('/reviews', requireAuth, writeLimiter, reviews.create);
router.put('/reviews/:id', requireAuth, writeLimiter, reviews.update);
router.delete('/reviews/:id', requireAuth, reviews.remove);
router.post('/reviews/:id/replies', requireAuth, writeLimiter, reviews.reply);
router.post('/reports', requireAuth, writeLimiter, reviews.report);

/* personal */
router.get('/me/favorites', requireAuth, me.listFavorites);
router.post('/me/favorites/:propertyId', requireAuth, me.addFavorite);
router.delete('/me/favorites/:propertyId', requireAuth, me.removeFavorite);
router.get('/me/saved-searches', requireAuth, me.listSavedSearches);
router.post('/me/saved-searches', requireAuth, writeLimiter, me.createSavedSearch);
router.patch('/me/saved-searches/:id', requireAuth, me.touchSavedSearch);
router.delete('/me/saved-searches/:id', requireAuth, me.deleteSavedSearch);
router.get('/me/recently-viewed', requireAuth, me.recentlyViewed);
router.delete('/me/recently-viewed', requireAuth, me.clearRecentlyViewed);
router.get('/me/notifications', requireAuth, me.notifications);
router.post('/me/notifications/read', requireAuth, me.markNotificationsRead);
router.get('/me/enquiries', requireAuth, me.myEnquiries);

/* leads & visits */
router.get('/leads', ...lister, leads.listLeads);
router.patch('/leads/:id', ...lister, leads.updateLead);
router.post('/visits', requireAuth, writeLimiter, leads.requestVisit);
router.get('/visits', requireAuth, leads.listVisits);
router.patch('/visits/:id', requireAuth, leads.updateVisit);

/* chat assistant */
router.post('/chat', chatLimiter, optionalAuth, chat.chat);
router.get('/chat/history', optionalAuth, chat.history);
router.delete('/chat/history', optionalAuth, chat.clear);

/* admin */
router.get('/admin/stats', ...adminOnly, admin.stats);
router.get('/admin/users', ...adminOnly, admin.users);
router.patch('/admin/users/:id', ...adminOnly, admin.updateUser);
router.get('/admin/listings', ...adminOnly, admin.listings);
router.patch('/admin/listings/:id', ...adminOnly, admin.moderateListing);
router.delete('/admin/listings/:id', ...adminOnly, admin.deleteListing);
router.get('/admin/projects', ...adminOnly, admin.projects);
router.get('/admin/rera', ...adminOnly, rera.queue);
router.post('/admin/rera/:recordId/check', ...adminOnly, rera.runCheck);
router.put('/admin/rera/:recordId', ...adminOnly, rera.review);
router.get('/admin/reviews', ...adminOnly, reviews.moderationQueue);
router.patch('/admin/reviews/:id', ...adminOnly, reviews.moderate);
router.get('/admin/reports', ...adminOnly, admin.reports);
router.patch('/admin/reports/:id', ...adminOnly, admin.resolveReport);
router.get('/admin/analysis', ...adminOnly, admin.analysisJobs);
router.post('/admin/analysis/:propertyId/rerun', ...adminOnly, admin.rerunAnalysis);
router.get('/admin/integrations', ...adminOnly, admin.integrations);
router.get('/admin/search-analytics', ...adminOnly, admin.searchAnalytics);
router.get('/admin/audit-logs', ...adminOnly, admin.auditLogs);
router.get('/admin/messages', ...adminOnly, admin.messages);
router.patch('/admin/messages/:id', ...adminOnly, admin.closeMessage);

export default router;
