function apiBase() {
  return process.env.PAYPAL_ENV === 'production'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function getAccessToken() {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;

  if (!clientId || !secret) {
    throw new Error('Configure PayPal client ID and secret.');
  }

  const response = await fetch(`${apiBase()}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization:
        `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || 'PayPal authentication failed');
  }

  return data.access_token;
}

export async function createPayPalPayment({
  orderId,
  amount,
  currency = 'USD',
  productName
}) {
  const token = await getAccessToken();
  const frontendUrl = process.env.FRONTEND_URL;

  if (!frontendUrl) {
    throw new Error('Configure FRONTEND_URL.');
  }

  const response = await fetch(`${apiBase()}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': orderId
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: orderId,
          custom_id: orderId,
          description: String(productName || 'Castiel Pay purchase').slice(0, 127),
          amount: {
            currency_code: currency,
            value: Number(amount).toFixed(2)
          }
        }
      ],
      application_context: {
        return_url:
          `${frontendUrl}/?paypal=return&paymentId=${encodeURIComponent(orderId)}`,
        cancel_url:
          `${frontendUrl}/?paypal=cancel&paymentId=${encodeURIComponent(orderId)}`,
        user_action: 'PAY_NOW'
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'PayPal order creation failed');
  }

  const approval = data.links?.find(link => link.rel === 'approve')?.href;

  if (!approval) {
    throw new Error('PayPal did not return an approval URL.');
  }

  return {
    reference: data.id,
    checkoutUrl: approval,
    message: 'Continue to PayPal to approve your payment.'
  };
}

export async function capturePayPalOrder(paypalOrderId) {
  const token = await getAccessToken();

  const response = await fetch(
    `${apiBase()}/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `${paypalOrderId}-capture`
      }
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'PayPal capture failed.');
  }

  const capture = data.purchase_units
    ?.flatMap(unit => unit.payments?.captures || [])
    .find(item => item.status === 'COMPLETED');

  return {
    paid: data.status === 'COMPLETED' && Boolean(capture),
    providerTransactionId: capture?.id || null,
    currency: capture?.amount?.currency_code || null,
    amount: capture?.amount?.value || null,
    status: data.status
  };
}