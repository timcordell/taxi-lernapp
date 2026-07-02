'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();

const PAYPAL_CLIENT_ID = defineSecret('PAYPAL_CLIENT_ID');
const PAYPAL_CLIENT_SECRET = defineSecret('PAYPAL_CLIENT_SECRET');

// Stored server-side only – never shipped to the client
const VALID_CODES = new Set([
  'TAXI-2024',
  'PROFI-IHK',
  'LERN-7731',
  'FREI-4892',
  'TEST-0001',
]);

// ── Promo-Code-Validierung ───────────────────────────────────────────────────
exports.validatePromoCode = onCall({ region: 'europe-west1' }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Anmeldung erforderlich.');
  }
  const raw = (request.data.code ?? '').trim().toUpperCase().replace(/\s+/g, '');
  if (!VALID_CODES.has(raw)) {
    throw new HttpsError('invalid-argument', 'Ungültiger Code.');
  }
  await db.collection('users').doc(request.auth.uid).set(
    { paid: true },
    { merge: true }
  );
  return { success: true };
});

// ── PayPal-Capture (server-side) ─────────────────────────────────────────────
exports.capturePayPalOrder = onCall(
  { region: 'europe-west1', secrets: [PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Anmeldung erforderlich.');
    }
    const { orderID } = request.data;
    if (!orderID || typeof orderID !== 'string') {
      throw new HttpsError('invalid-argument', 'Order-ID fehlt.');
    }

    const clientId = PAYPAL_CLIENT_ID.value();
    const secret   = PAYPAL_CLIENT_SECRET.value();
    const base64   = Buffer.from(`${clientId}:${secret}`).toString('base64');

    // 1. Access-Token holen
    const tokenRes = await fetch('https://api-m.paypal.com/v1/oauth2/token', {
      method:  'POST',
      headers: {
        'Authorization': `Basic ${base64}`,
        'Content-Type':  'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const tokenJson = await tokenRes.json();
    if (!tokenJson.access_token) {
      throw new HttpsError('internal', 'PayPal-Authentifizierung fehlgeschlagen.');
    }

    // 2. Order capturen
    const captureRes = await fetch(
      `https://api-m.paypal.com/v2/checkout/orders/${orderID}/capture`,
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${tokenJson.access_token}`,
          'Content-Type':  'application/json',
        },
      }
    );
    const captureJson = await captureRes.json();

    if (captureJson.status !== 'COMPLETED') {
      throw new HttpsError('failed-precondition', 'Zahlung nicht abgeschlossen.');
    }

    // 3. Betrag prüfen (Mindestschutz gegen manipulierte Bestellungen)
    const capture = captureJson.purchase_units?.[0]?.payments?.captures?.[0];
    if (
      !capture ||
      capture.amount?.currency_code !== 'EUR' ||
      parseFloat(capture.amount?.value) < 19.99
    ) {
      throw new HttpsError('failed-precondition', 'Ungültiger Zahlungsbetrag.');
    }

    // 4. Paid-Flag serverseitig setzen
    await db.collection('users').doc(request.auth.uid).set(
      { paid: true },
      { merge: true }
    );
    return { success: true };
  }
);
