/*
 * In-app notifications. Email/SMS delivery is not configured in this build;
 * add a transport here (e.g. SMTP or an SMS gateway) and call it from notify().
 */
import { Notification } from '../models/index.js';
import User from '../models/User.js';

// Maps notification types to the preference that controls them.
const PREF_FOR = {
  lead: 'leads',
  'site-visit': 'siteVisits',
  'saved-search': 'savedSearches',
  review: 'reviews',
};

export async function notify(userId, { type, title, body = '', link = '' }) {
  try {
    if (!userId) return null;
    const pref = PREF_FOR[type];
    if (pref) {
      const user = await User.findById(userId).select('notificationPrefs').lean();
      if (user?.notificationPrefs && user.notificationPrefs[pref] === false) return null;
    }
    return await Notification.create({ user: userId, type, title: title.slice(0, 160), body: body.slice(0, 500), link });
  } catch (err) {
    console.warn('[notify] failed:', err.message);
    return null;
  }
}
