import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import type { User, ClientType } from "@/lib/types";
import { normalizePeruPhone, isValidPeruPhone } from "@/features/operaciones/utils";
import { mapQueryDocToUser } from "@/lib/server/mapUserFromFirestore";
import { userMatchesSearch } from "@/features/usuarios/utils/userMatchesSearch";

const BROWSE_MAX = 280;

/**
 * GET /api/users
 * Sin query: lista completa (compatibilidad con `store.fetchUsers()` y otros consumidores).
 *
 * Query opcional para /usuarios con muchos registros:
 * - `mode=summary` → `{ needsHelpCount }` (usuarios con needs_help o tipo fraude; sin leer toda la colección).
 * - `mode=browse&limit=N` → top por `reservation_count` descendente (vista inicial).
 * - `mode=search&q=...` → filtro con la misma lógica que el buscador del panel (puede leer toda la colección).
 * - `mode=attention` → unión de needs_help y client_type sospechoso_fraude.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get("mode");
    const db = getDb();
    const usersCol = db.collection("users");

    if (mode === "summary") {
      const [helpSnap, fraudSnap] = await Promise.all([
        usersCol.where("needs_help", "==", true).get(),
        usersCol.where("client_type", "==", "sospechoso_fraude").get(),
      ]);
      const ids = new Set<string>();
      helpSnap.docs.forEach((d) => ids.add(d.id));
      fraudSnap.docs.forEach((d) => ids.add(d.id));
      return NextResponse.json({ needsHelpCount: ids.size }, { headers: { "Cache-Control": "no-store" } });
    }

    if (mode === "browse") {
      const limRaw = searchParams.get("limit");
      const limit = Math.min(
        Math.max(1, limRaw ? parseInt(limRaw, 10) || BROWSE_MAX : BROWSE_MAX),
        500
      );
      const snapshot = await usersCol.orderBy("reservation_count", "desc").limit(limit).get();
      const list = snapshot.docs.map(mapQueryDocToUser);
      return NextResponse.json(list, {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
        },
      });
    }

    if (mode === "attention") {
      const [helpSnap, fraudSnap] = await Promise.all([
        usersCol.where("needs_help", "==", true).get(),
        usersCol.where("client_type", "==", "sospechoso_fraude").get(),
      ]);
      const byId = new Map<string, User>();
      for (const d of helpSnap.docs) byId.set(d.id, mapQueryDocToUser(d));
      for (const d of fraudSnap.docs) byId.set(d.id, mapQueryDocToUser(d));
      return NextResponse.json(Array.from(byId.values()), { headers: { "Cache-Control": "no-store" } });
    }

    if (mode === "search") {
      const q = (searchParams.get("q") ?? "").trim();
      if (!q) {
        return NextResponse.json({ error: "Parámetro q requerido" }, { status: 400 });
      }
      const snapshot = await usersCol.get();
      const list = snapshot.docs.map(mapQueryDocToUser).filter((u) => userMatchesSearch(u, q));
      return NextResponse.json(list, { headers: { "Cache-Control": "no-store" } });
    }

    if (mode !== null && mode !== "") {
      return NextResponse.json({ error: "mode inválido" }, { status: 400 });
    }

    const snapshot = await usersCol.get();
    const list: User[] = snapshot.docs.map(mapQueryDocToUser);

    return NextResponse.json(list, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "Error al obtener usuarios" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/users
 * Crea un usuario manualmente (nombre, teléfono con lógica 51, DNI opcional, tipo).
 */
export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    const { name, phone, dni, client_type } = body;

    const nameTrim = typeof name === "string" ? name.trim() : "";
    if (nameTrim.length < 2) {
      return NextResponse.json(
        { error: "El nombre debe tener al menos 2 caracteres" },
        { status: 400 }
      );
    }

    const rawPhone = typeof phone === "string" ? phone.replace(/\D/g, "") : "";
    if (!rawPhone) {
      return NextResponse.json(
        { error: "El teléfono es obligatorio" },
        { status: 400 }
      );
    }

    const phoneNormalized = normalizePeruPhone(rawPhone);
    if (!isValidPeruPhone(phoneNormalized)) {
      return NextResponse.json(
        { error: "Teléfono inválido. Debe ser 9 dígitos (Perú)." },
        { status: 400 }
      );
    }

    const VALID_CLIENT_TYPES = ["casual", "recurrente", "sospechoso_fraude"];
    const clientType: ClientType =
      VALID_CLIENT_TYPES.includes(client_type) ? client_type : "casual";

    const dniClean =
      typeof dni === "string" && dni.trim()
        ? dni.replace(/\D/g, "").slice(0, 8)
        : null;
    if (dniClean && dniClean.length !== 8) {
      return NextResponse.json(
        { error: "El DNI debe tener 8 dígitos" },
        { status: 400 }
      );
    }

    const docId = phoneNormalized;
    const docRef = db.collection("users").doc(docId);
    const existing = await docRef.get();
    if (existing.exists) {
      return NextResponse.json(
        { error: "Ya existe un usuario con ese número" },
        { status: 409 }
      );
    }

    await docRef.set({
      chat_id: docId,
      phone_number: docId,
      custom_name: nameTrim,
      last_dni: dniClean || null,
      client_type: clientType,
      reservation_count: 0,
      balance: 0,
      is_automated: true,
      needs_help: false,
      help_reason: null,
    });

    return NextResponse.json({ success: true, id: docId });
  } catch (error) {
    console.error("Error creating user:", error);
    return NextResponse.json(
      { error: "Error al crear usuario" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/users
 * Actualiza campos de un usuario (ej: is_automated).
 */
export async function PATCH(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    console.log("DEBUG: PATCH /api/users body:", body);
    const {
      is_automated,
      client_type,
      custom_name,
      last_dni,
      last_ruc,
      last_factura_direccion,
      last_factura_razon_social,
      phone_number,
      last_note,
    } = body;

    const id = body.id ? String(body.id) : null;

    if (!id) {
      return NextResponse.json(
        { error: "Se requiere id del usuario" },
        { status: 400 }
      );
    }

    const VALID_CLIENT_TYPES = ["casual", "frecuente", "academia", "recurrente", "sospechoso_fraude"];

    const updateData: Record<string, unknown> = {};
    if (typeof is_automated === "boolean") {
      updateData.is_automated = is_automated;
      if (is_automated === true) {
        updateData.needs_help = false;
        updateData.help_reason = null;
      }
    }

    if (client_type !== undefined) {
      if (!VALID_CLIENT_TYPES.includes(client_type)) {
        return NextResponse.json(
          { error: `Tipo de cliente inválido: ${client_type}` },
          { status: 400 }
        );
      }
      updateData.client_type = client_type;
    }

    if (custom_name !== undefined) {
      updateData.custom_name = typeof custom_name === "string" ? custom_name.trim() : null;
    }

    if (last_dni !== undefined) {
      const clean = typeof last_dni === "string" ? last_dni.replace(/\D/g, "").slice(0, 8) : "";
      updateData.last_dni = clean.length === 8 ? clean : null;
    }
    if (last_ruc !== undefined) {
      const clean = typeof last_ruc === "string" ? last_ruc.replace(/\D/g, "").slice(0, 11) : "";
      updateData.last_ruc = clean.length === 11 ? clean : null;
    }

    if (last_factura_direccion !== undefined) {
      const t = typeof last_factura_direccion === "string" ? last_factura_direccion.trim().slice(0, 500) : "";
      updateData.last_factura_direccion = t || null;
    }
    if (last_factura_razon_social !== undefined) {
      const t =
        typeof last_factura_razon_social === "string" ? last_factura_razon_social.trim().slice(0, 400) : "";
      updateData.last_factura_razon_social = t || null;
    }

    if (last_note !== undefined) {
      updateData.last_note = typeof last_note === "string" ? last_note.trim() : null;
    }

    if (phone_number !== undefined) {
      const raw = typeof phone_number === "string" ? phone_number : "";
      const normalized = normalizePeruPhone(raw.replace(/\D/g, ""));
      if (!isValidPeruPhone(normalized)) {
        return NextResponse.json(
          { error: "Teléfono inválido. Debe ser un móvil peruano (9 dígitos o 51 + 9 dígitos)." },
          { status: 400 }
        );
      }
      updateData.phone_number = normalized;
    }

    const totalKeys = Object.keys(updateData).length;
    if (totalKeys === 0) {
      return NextResponse.json(
        { error: "No hay campos válidos para actualizar", receivedKeys: Object.keys(body) },
        { status: 400 }
      );
    }

    const userRef = db.collection("users").doc(id);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      const reservationsSnap = await db
        .collection("reservations")
        .where("chat_id", "==", id)
        .get();
      const reservationCount = reservationsSnap.size;
      let nameFromReservation: string | null = null;
      for (const d of reservationsSnap.docs) {
        const rep = d.data()?.representative_name;
        if (typeof rep === "string" && rep.trim()) {
          nameFromReservation = rep.trim();
          break;
        }
      }

      const customName =
        typeof custom_name === "string" && custom_name.trim()
          ? custom_name.trim()
          : nameFromReservation;

      const minimal: Record<string, unknown> = {
        chat_id: id,
        phone_number: id,
        reservation_count: reservationCount,
        balance: 0,
        is_automated: true,
        needs_help: false,
        help_reason: null,
        ...(customName ? { custom_name: customName } : {}),
        ...(nameFromReservation ? { last_representative_name: nameFromReservation } : {}),
        ...updateData,
      };
      if (!("client_type" in minimal)) minimal.client_type = "casual";
      await userRef.set(minimal);
    } else {
      await userRef.update(updateData);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating user:", error);
    return NextResponse.json(
      { error: "Error al actualizar usuario" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/users
 * Elimina un usuario por completo: historial, reservas y documento de usuario.
 * Si vuelve a escribir, el sistema lo recrea automáticamente como "nuevo".
 */
export async function DELETE(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id");

    if (!id) {
      try {
        const body = await request.json();
        id = body?.id;
      } catch (e) {
        // Ignore JSON parsing errors for empty/non-JSON bodies
      }
    }

    if (!id) {
      return NextResponse.json({ error: "Se requiere id del usuario" }, { status: 400 });
    }

    const batch = db.batch();

    const historyRef = db.collection("message_history").doc(id);
    const historyDoc = await historyRef.get();
    if (historyDoc.exists) batch.delete(historyRef);

    const reservations = await db.collection("reservations").where("chat_id", "==", id).get();
    let reservationsDeleted = 0;
    for (const doc of reservations.docs) {
      batch.delete(doc.ref);
      reservationsDeleted++;
    }

    const userRef = db.collection("users").doc(id);
    batch.delete(userRef);

    await batch.commit();

    return NextResponse.json({
      success: true,
      reservations_deleted: reservationsDeleted,
      history_cleared: historyDoc.exists,
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    return NextResponse.json({ error: "Error al eliminar usuario" }, { status: 500 });
  }
}
