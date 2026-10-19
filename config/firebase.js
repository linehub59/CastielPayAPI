
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  initializeApp,
  cert,
  applicationDefault,
  getApps,
} from 'firebase-admin/app';

import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const existingApps = getApps();
let firebaseApp;

if (existingApps.length > 0) {
  firebaseApp = existingApps[0];
} else {
  let serviceAccount = null;
  const serviceAccountJson =
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();

  if (serviceAccountJson) {
    try {
      serviceAccount = JSON.parse(serviceAccountJson);
    } catch {
      throw new Error(
        'FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON. ' +
        'Check your backend .env file.'
      );
    }
  } else {
    const keyPath = path.resolve(
      __dirname,
      '../serviceAccountKey.json'
    );

    if (fs.existsSync(keyPath)) {
      try {
        serviceAccount = JSON.parse(
          fs.readFileSync(keyPath, 'utf8')
        );
      } catch {
        throw new Error(
          'serviceAccountKey.json is not valid JSON.'
        );
      }
    }
  }

  if (serviceAccount) {
    firebaseApp = initializeApp({
      credential: cert(serviceAccount),
      projectId:
        process.env.FIREBASE_PROJECT_ID ||
        serviceAccount.project_id,
    });
  } else {
    firebaseApp = initializeApp({
      credential: applicationDefault(),
      projectId: process.env.FIREBASE_PROJECT_ID,
    });
  }
}

const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);

// Compatibility export for older files importing { admin }.
// Use the modular SDK methods shown below.
const admin = {
  apps: getApps(),
  app: () => firebaseApp,
  auth: () => auth,
  firestore: () => db,
};

export { firebaseApp, db, auth, admin };
