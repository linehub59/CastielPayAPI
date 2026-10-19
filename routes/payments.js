import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db, admin } from '../config/firebase.js';
import { getProduct } from '../config/config.js';
import { createMpesaPayment } from '../services/mpesa.js';
import {
  createPayPalPayment,
  capturePayPalOrder
} from '../services/paypal.js';
import { FieldValue } from 'firebase-admin/firestore';
import { createIntaSendPayment } from '../services/intasend.js';

const router = Router();
const serverTime = () =>
  FieldValue.serverTimestamp()

router.post('/create', async (req, res, next) => {
  try {
    const { appId, productId, provider, phone } = req.body || {};

    if (
      typeof appId !== 'string' ||
      typeof productId !== 'string' ||
      !['mpesa', 'paypal', 'card'].includes(provider)
    ) {
      return res.status(400).json({
        error: 'Provide a valid appId, productId and payment provider.'
      });
    }

    const product = getProduct(appId, productId);

    if (!product) {
      return res.status(400).json({
        error: 'Unknown product or invalid product price.'
      });
    }

    if (provider === 'mpesa' && product.currency !== 'KES') {
      return res.status(400).json({
        error: 'M-Pesa payments must use KES.'
      });
    }

    if (
      provider === 'paypal' &&
      (!product.paypalAmount || product.paypalAmount <= 0)
    ) {
      return res.status(400).json({
        error: 'This product has no configured PayPal price.'
      });
    }

    const orderId = randomUUID();

    await db.collection('payments').doc(orderId).create({
      orderId,
      appId,
      productId,
      productName: product.name,
      uid: req.user.uid,
      provider,
      amount: product.amount,
      currency: product.currency,
      paypalAmount:
        provider === 'paypal' ? product.paypalAmount : null,
      status: 'pending',
      createdAt: serverTime(),
      updatedAt: serverTime()
    });

    let checkout;

    try {
      if (provider === 'mpesa') {
        checkout = await createMpesaPayment({
          orderId,
          amount: product.amount,
          phone
        });
      } else if (provider === 'paypal') {
        checkout = await createPayPalPayment({
          orderId,
          amount: product.paypalAmount,
          currency: 'USD',
          productName: product.name
        });
      } else {
        checkout = await createIntaSendPayment({
          orderId,
          amount: product.amount,
          currency: product.currency,
          email: req.user.email
        });
      }
    } catch (err) {
      await db.collection('payments').doc(orderId).update({
        status: 'initiation_failed',
        updatedAt: serverTime()
      });
      throw err;
    }

    await db.collection('payments').doc(orderId).update({
      providerReference: checkout.reference || null,
      checkoutUrl: checkout.checkoutUrl || null,
      updatedAt: serverTime()
    });

    res.status(201).json({
      orderId,
      status: 'pending',
      provider,
      checkoutUrl: checkout.checkoutUrl || null,
      message: checkout.message || 'Payment initiated.'
    });
  } catch (err) {
    next(err);
  }
});

/*
 * Capture a PayPal order after the customer returns from PayPal.
 * The client supplies only the Castiel Pay order ID.
 * PayPal order ID is retrieved from the server's saved order.
 */
router.post('/:orderId/paypal/capture', async (req, res, next) => {
  try {
    const ref = db.collection('payments').doc(req.params.orderId);
    const snap = await ref.get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'Payment not found.' });
    }

    const payment = snap.data();

    if (payment.uid !== req.user.uid) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    if (payment.provider !== 'paypal') {
      return res.status(400).json({ error: 'This is not a PayPal order.' });
    }

    if (payment.status === 'paid') {
      return res.json({ orderId: payment.orderId, status: 'paid' });
    }

    if (!payment.providerReference) {
      return res.status(409).json({
        error: 'PayPal order has not been created yet.'
      });
    }

    const result = await capturePayPalOrder(payment.providerReference);

    const expectedAmount = Number(payment.paypalAmount);
    const actualAmount = Number(result.amount);

    if (
      !result.paid ||
      result.currency !== 'USD' ||
      actualAmount !== expectedAmount
    ) {
      return res.status(409).json({
        error: 'PayPal has not confirmed the expected amount.',
        status: result.status
      });
    }

    await db.runTransaction(async tx => {
      const fresh = await tx.get(ref);

      if (!fresh.exists) throw new Error('Payment order not found.');

      const current = fresh.data();

      if (current.status === 'paid') return;

      tx.update(ref, {
        status: 'paid',
        providerTransactionId: result.providerTransactionId,
        paidAt: serverTime(),
        updatedAt: serverTime()
      });
    });

    res.json({ orderId: payment.orderId, status: 'paid' });
  } catch (err) {
    next(err);
  }
});

router.get('/:orderId', async (req, res, next) => {
  try {
    const snap = await db.collection('payments')
      .doc(req.params.orderId)
      .get();

    if (!snap.exists) {
      return res.status(404).json({ error: 'Payment not found.' });
    }

    const payment = snap.data();

    if (payment.uid !== req.user.uid) {
      return res.status(403).json({ error: 'Access denied.' });
    }

    res.json({
      orderId: payment.orderId,
      appId: payment.appId,
      productId: payment.productId,
      productName: payment.productName,
      provider: payment.provider,
      amount: payment.provider === 'paypal'
        ? payment.paypalAmount
        : payment.amount,
      currency: payment.provider === 'paypal'
        ? 'USD'
        : payment.currency,
      status: payment.status
    });
  } catch (err) {
    next(err);
  }
});

export default router;