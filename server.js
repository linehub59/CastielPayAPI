import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { auth } from './config/firebase.js';
import { config, origins, publicConfig } from './config/config.js';

import paymentsRouter from './routes/payments.js';
import webhooksRouter from './routes/webhooks.js';

const app = express();

app.set('trust proxy', 1);

app.use(helmet());

app.use(cors({
  origin(origin, cb) {
    if (!origin || origins.includes(origin)) {
      return cb(null, true);
    }

    return cb(new Error('Origin not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json({ limit: '100kb' }));

app.use(rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false
}));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'Castiel Pay API',
    environment: process.env.NODE_ENV || 'development'
  });
});

app.get('/api/config', (_req, res) => {
  res.json(publicConfig());
});

async function requireFirebaseUser(req, res, next) {
  try {
    const header = req.headers.authorization || '';

    if (!header.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Sign in first.'
      });
    }

    const decoded = await auth.verifyIdToken(header.slice(7));

    req.user = {
      uid: decoded.uid,
      email: decoded.email || null
    };

    next();
  } catch {
    res.status(401).json({
      error: 'Invalid or expired sign-in token.'
    });
  }
}

app.use('/api/payments', requireFirebaseUser, paymentsRouter);
app.use('/api/webhooks', webhooksRouter);

app.use((err, req, res, _next) => {
  console.error(err.message);

  res.status(err.status || 500).json({
    error:
      err.status && err.status < 500
        ? err.message
        : process.env.NODE_ENV === 'production'
          ? 'Server error. Check backend logs.'
          : err.message || 'Server error'
  });
});

app.listen(config.PORT, () => {
  console.log(`Castiel Pay API listening on port ${config.PORT}`);
});