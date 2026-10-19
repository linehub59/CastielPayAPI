export async function createIntaSendPayment({
  orderId,
  amount,
  currency,
  email
}) {
  const publishableKey = process.env.INTASEND_PUBLISHABLE_KEY;

  if (!publishableKey) {
    throw new Error('Configure the IntaSend publishable API key.');
  }

  const frontendUrl = process.env.FRONTEND_URL;

  if (!frontendUrl) {
    throw new Error('Configure FRONTEND_URL.');
  }

  const response = await fetch(
    'https://api.intasend.com/api/v1/checkout/',
    {
      method: 'POST',
      headers: {
        'X-IntaSend-Public-API-Key': publishableKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount,
        currency,
        email: email || 'customer@example.com',
        api_ref: orderId,
        unique_api_ref: true,
        redirect_url:
          `${frontendUrl}/?card=return&paymentId=${encodeURIComponent(orderId)}`,
        host: frontendUrl
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.detail || data.message || 'IntaSend checkout creation failed.'
    );
  }

  const checkoutUrl =
    data.url || data.checkout_url || data.redirect_url;

  if (!checkoutUrl) {
    throw new Error('IntaSend did not return a hosted checkout URL.');
  }

  return {
    reference: orderId,
    checkoutUrl,
    message: 'Continue to the secure card checkout page.'
  };
}