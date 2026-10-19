function apiBase() {
  return process.env.MPESA_ENV === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

function normalizePhone(input) {
  let phone = String(input || '').replace(/[\s+-]/g, '');

  if (phone.startsWith('0')) phone = `254${phone.slice(1)}`;
  if (phone.startsWith('7') || phone.startsWith('1')) {
    phone = `254${phone}`;
  }

  if (!/^254[17]\d{8}$/.test(phone)) {
    throw new Error('Enter a valid Kenyan M-Pesa number, e.g. 0712345678');
  }

  return phone;
}

async function getAccessToken() {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;

  if (!key || !secret) {
    throw new Error('Configure your Daraja consumer key and secret.');
  }

  const response = await fetch(
    `${apiBase()}/oauth/v1/generate?grant_type=client_credentials`,
    {
      headers: {
        Authorization:
          `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`
      }
    }
  );

  const data = await response.json();

  if (!response.ok || !data.access_token) {
    throw new Error(data.errorMessage || 'Daraja authentication failed');
  }

  return data.access_token;
}

export async function createMpesaPayment({ orderId, amount, phone }) {
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  const callbackUrl = process.env.MPESA_CALLBACK_URL;

  if (!shortcode || !passkey || !callbackUrl) {
    throw new Error('Configure the Daraja shortcode, passkey and callback URL.');
  }

  if (!callbackUrl.startsWith('https://')) {
    throw new Error('M-Pesa callback URL must use public HTTPS.');
  }

  const token = await getAccessToken();
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);

  const password = Buffer.from(
    `${shortcode}${passkey}${timestamp}`
  ).toString('base64');

  const phoneNumber = normalizePhone(phone);

  const response = await fetch(
    `${apiBase()}/mpesa/stkpush/v1/processrequest`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: 'CustomerPayBillOnline',
        Amount: Math.round(amount),
        PartyA: phoneNumber,
        PartyB: shortcode,
        PhoneNumber: phoneNumber,
        CallBackURL: callbackUrl,
        AccountReference: orderId.slice(0, 12),
        TransactionDesc: `Payment ${orderId.slice(0, 12)}`
      })
    }
  );

  const data = await response.json();

  if (!response.ok || data.ResponseCode !== '0') {
    throw new Error(
      data.errorMessage || data.ResponseDescription || 'STK Push failed'
    );
  }

  return {
    reference: data.CheckoutRequestID,
    message: data.CustomerMessage || 'Check your phone for the M-Pesa prompt.'
  };
}