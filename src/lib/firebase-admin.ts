import { initializeApp, getApps, cert, type App } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage as _getStorage } from "firebase-admin/storage";
import path from "path";
import { readFileSync, existsSync } from "fs";

let app: App | null = null;

function getCredentialPath(): string | null {
  const envPath =
    process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (envPath) {
    return path.isAbsolute(envPath) ? envPath : path.resolve(process.cwd(), envPath);
  }
  return null;
}

function ensureApp(): App {
  if (getApps().length > 0) {
    return getApps()[0] as App;
  }
  const credentialPath = getCredentialPath();
  if (!credentialPath) {
    throw new Error(
      "Configura GOOGLE_APPLICATION_CREDENTIALS o FIREBASE_SERVICE_ACCOUNT_PATH con la ruta al JSON de la cuenta de servicio de Firebase."
    );
  }
  if (!existsSync(credentialPath)) {
    throw new Error(
      `No se encontró el archivo de credenciales: ${credentialPath}. ` +
        "Configura la variable de entorno en runtime o coloca el JSON en utils/ del proyecto."
    );
  }
  const serviceAccount = JSON.parse(readFileSync(credentialPath, "utf8")) as object;
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
  // Leer project_id del credential para construir el bucket name
  const credentialPath = getCredentialPath();
  if (credentialPath) {
    const sa = JSON.parse(readFileSync(credentialPath, "utf8")) as { project_id: string };
    return _getStorage(a).bucket(`${sa.project_id}.firebasestorage.app`);
  }
  return _getStorage(a).bucket();
}
