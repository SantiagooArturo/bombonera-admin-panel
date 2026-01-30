import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import path from "path";

const serviceAccountPath = path.resolve(
  process.cwd(),
  "../la-bombonera-agent/utils/bombonera-agent-firebase-adminsdk-fbsvc-8b126991fe.json"
);

if (getApps().length === 0) {
  initializeApp({
    credential: cert(serviceAccountPath),
  });
}

export const db = getFirestore();
