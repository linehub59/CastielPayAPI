import { Router } from 'express';
import { createHash } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { db, admin } from '../config/firebase.js';

const router = Router();
const serverTime = () =>
  FieldValue.serverTimestamp();

router.post('/mpesa', async (req, res) => {
  try {
    const callback = req.body?.Body?.stkCallback;

    if (!callback?.CheckoutRequestID) {
      return res.status(400).json({ error: 'Invalid callback' });
    }

    const matches = await db.collection('payments')
      .where('providerReference', '==', callback.CheckoutRequestID)
      .limit(1)
      .get();

    if (matches.empty) {
      return res.status(200).json({ received: true, matched: false });
    }

    const doc = matches.docs[0];
    const payment = doc.data();
    const items = callback.CallbackMetadata?.Item || [];
    const getValue = name => items.find(i => i.Name === name)?.Value;

    const amount = Number(getValue('Amount'));
    const receipt = getValue('MpesaReceiptNumber');

    const paid =
      Number(callback.ResultCode) === 0 &&
      Number.isFinite(amount) &&
      amount === Number(payment.amount) &&
      payment.currency === 'KES' &&
      Boolean(receipt);

    const eventId = createHash('sha256')
      .update(`mpesa:${callback.CheckoutRequestID}:${callback.ResultCode}:${receipt || ''}`)
      .digest('hex');

    await db.runTransaction(async tx => {
      const eventRef = db.collection('providerEvents').doc(eventId);
      const existing = await tx.get(eventRef);

      if (existing.exists) return;

      const fresh = await tx.get(doc.ref);
      if (!fresh.exists) return;

      const current = fresh.data();

      tx.create(eventRef, {
        provider: 'mpesa',
        receivedAt: serverTime()
      });

      if (current.status === 'paid') return;

      if (paid) {
        tx.update(doc.ref, {
          status: 'paid',
          providerTransactionId: String(receipt),
          paidAt: serverTime(),
          updatedAt: serverTime()
        });
      } else {
        tx.update(doc.ref, {
          status: 'failed',
          failureMessage: String(
            callback.ResultDesc || 'M-Pesa payment failed'
          ).slice(0, 250),
          updatedAt: serverTime()
        });
      }
    });

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('M-Pesa webhook error:', error.message);
    return res.status(500).json({ error: 'Could not process callback' });
  }
});

router.post('/intasend', async (req, res) => {
  try {
    const event = req.body || {};
    const challenge = process.env.INTASEND_WEBHOOK_CHALLENGE;

    if (!challenge || event.challenge !== challenge) {
      return res.status(401).json({ error: 'Invalid webhook challenge' });
    }

    if (event.topic !== 'collection_event' || !event.api_ref) {
      return res.status(200).json({ received: true, ignored: true });
    }

    const ref = db.collection('payments').doc(String(event.api_ref));
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(200).json({ received: true, matched: false });
    }

    const payment = snap.data();

    if (payment.provider !== 'card') {
      return res.status(200).json({ received: true, ignored: true });
    }

    const correctAmount =
      Number.isFinite(Number(event.value)) &&
      Number(event.value) === Number(payment.amount);

    const correctCurrency = event.currency === payment.currency;

    const paid =
      event.state === 'COMPLETE' &&
      correctAmount &&
      correctCurrency &&
      Boolean(event.invoice_id);

    const eventId = createHash('sha256')
      .update(`intasend:${event.invoice_id}:${event.state}:${event.updated_at || ''}`)
      .digest('hex');

    await db.runTransaction(async tx => {
      const eventRef = db.collection('providerEvents').doc(eventId);
      const prior = await tx.get(eventRef);

      if (prior.exists) return;

      const fresh = await tx.get(ref);
      if (!fresh.exists) return;

      const current = fresh.data();

      tx.create(eventRef, {
        provider: 'intasend',
        invoiceId: event.invoice_id,
        receivedAt: serverTime()
      });

      if (current.status === 'paid') return;

      const update = {
        updatedAt: serverTime(),
        providerTransactionId: String(
          event.provider_ref || event.invoice_id || ''
        )
      };

      if (paid) {
        update.status = 'paid';
        update.paidAt = serverTime();
      } else if (['FAILED', 'CANCELED'].includes(event.state)) {
        update.status = 'failed';
      }

      tx.update(ref, update);
    });

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('IntaSend webhook error:', error.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

export default router;