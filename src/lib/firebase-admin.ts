import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage as _getStorage } from "firebase-admin/storage";
import path from "path";
import { readFileSync, existsSync } from "fs";

let app: App | null = null;
let cachedServiceAccount: object | null = null;

function getServiceAccount(): object {
  if (cachedServiceAccount) return cachedServiceAccount;

  // Priority 1: JSON string in FIREBASE_SERVICE_ACCOUNT env var (for cloud deploys)
  const jsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (jsonEnv) {
    cachedServiceAccount = JSON.parse(jsonEnv) as object;
    return cachedServiceAccount;
  }

  // Priority 2: File path via GOOGLE_APPLICATION_CREDENTIALS or FIREBASE_SERVICE_ACCOUNT_PATH
  const envPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (envPath) {
    const resolved = path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
    if (!existsSync(resolved)) {
      throw new Error(`No se encontró el archivo de credenciales: ${resolved}`);
    }
    cachedServiceAccount = JSON.parse(readFileSync(resolved, "utf8")) as object;
    return cachedServiceAccount;
  }

  throw new Error(
    "Configura FIREBASE_SERVICE_ACCOUNT (JSON string) o GOOGLE_APPLICATION_CREDENTIALS (ruta al archivo) para conectar con Firebase."
  );
}

function ensureApp(): App {
  if (getApps().length > 0) {
    return getApps()[0] as App;
  }
  const serviceAccount = getServiceAccount();
  app = initializeApp({
    credential: cert(serviceAccount as Parameters<typeof cert>[0]),
    storageBucket: `${(serviceAccount as { project_id: string }).project_id}.firebasestorage.app`,
  });
  return app;
}

export function getDb() {
  ensureApp();
  return getFirestore();
}

export function getStorageBucket() {
  const a = ensureApp();
  const sa = getServiceAccount() as { project_id: string };
  return _getStorage(a).bucket(`${sa.project_id}.firebasestorage.app`);
}
