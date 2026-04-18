/**
 * Ejecuta una vez la lógica del cron recurrent-rebooking (misma que /api/cron/recurrent-rebooking).
 * Usa credenciales de Firebase desde .env / .env.local (no requiere CRON_SECRET).
 *
 * Uso: npx tsx scripts/run-recurrent-rebooking.ts
 */
import { config } from "dotenv";
import { resolve } from "path";

[".env", ".env.local", ".env.development"].forEach((f) => {
  config({ path: resolve(process.cwd(), f) });
});

import { executeRecurrentRebooking } from "../src/lib/cron/recurrent-rebooking-executor";

executeRecurrentRebooking()
  .then((r) => {
    console.log("\nResultado:", JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
