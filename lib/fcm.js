'use strict';
const { query } = require('./db');

let messaging = null;

function getMessaging() {
  if (messaging) return messaging;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null; // sense credencials: les notificacions queden desactivades
  const admin = require('firebase-admin'); // càrrega diferida (pesa)
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
  }
  messaging = admin.messaging();
  return messaging;
}

/**
 * Envia una notificació push a un rol ('all' = tots). Mai llança errors:
 * unes notificacions fallides no han de trencar l'acció principal.
 */
async function fcmSendToRol(rol, title, body) {
  try {
    const m = getMessaging();
    if (!m) return;

    const rows = rol === 'all'
      ? await query('SELECT token FROM fcm_tokens')
      : await query('SELECT token FROM fcm_tokens WHERE rol=?', [rol]);
    const tokens = rows.map((r) => r.token);
    if (!tokens.length) return;

    for (let i = 0; i < tokens.length; i += 500) {
      const chunk = tokens.slice(i, i + 500);
      const send = m.sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
        android: { priority: 'high' },
        webpush: { headers: { Urgency: 'high' } },
      });
      const resp = await Promise.race([send, new Promise((r) => setTimeout(() => r(null), 5000))]);

      // Neteja de tokens caducats
      if (resp && resp.responses) {
        const dead = [];
        resp.responses.forEach((r, idx) => {
          const code = r.error && r.error.code;
          if (code === 'messaging/registration-token-not-registered' ||
              code === 'messaging/invalid-registration-token') dead.push(chunk[idx]);
        });
        if (dead.length) await query('DELETE FROM fcm_tokens WHERE token IN (?)', [dead]);
      }
    }
  } catch (e) {
    console.error('FCM error:', e && e.message);
  }
}

module.exports = { fcmSendToRol };
