import { config } from "dotenv";
import { resolve } from "path";

[".env", ".env.local", ".env.development"].forEach((f) =>
  config({ path: resolve(process.cwd(), f) })
);

import { getDb } from "../src/lib/firebase-admin";

async function main() {
  const db = getDb();
  const snap = await db.collection("invoices").where("sunat_estado", "==", "PENDIENTE").get();
  console.log(`[inspect] pendientes=${snap.size}`);
  for (const d of snap.docs) {
    const inv = d.data() || {};
    const status = String(inv.status || "");
    const grayButton = status === "voided";
    console.log(
      JSON.stringify(
        {
          id: d.id,
          serie_correlativo: inv.serie_correlativo || "",
          status,
          sunat_estado: inv.sunat_estado || "",
          voided_at: inv.voided_at || null,
          void_motivo: inv.void_motivo || null,
          gray_button: grayButton,
        },
        null,
        0
      )
    );
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

