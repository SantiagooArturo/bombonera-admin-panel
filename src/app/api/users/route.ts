import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import type { User, ClientType } from "@/lib/types";
import { normalizePeruPhone, isValidPeruPhone } from "@/features/operaciones/utils";

/**
 * GET /api/users
 * Lista usuarios desde la colección `users`.
 * Atributos denormalizados: reservation_count, balance, client_type, is_automated.
 * Una sola query a users, sin queries anidadas.
 */
export async function GET() {
  try {
    const db = getDb();
    const snapshot = await db.collection("users").get();

    const list: User[] = snapshot.docs.map((doc) => {
      const data = doc.data();
      const id = doc.id;
      const balance = data.balance;
      const reservationCount = data.reservation_count;
      const clientType = data.client_type;
      const isAutomated = data.is_automated;
      const needsHelp = data.needs_help;
      const helpReason = data.help_reason;

      return {
        id,
        chat_id: data.chat_id ?? id,
        phone_number: data.phone_number ?? undefined,
        contact_name: typeof data.contact_name === "string" ? data.contact_name : undefined,
        push_name: typeof data.push_name === "string" ? data.push_name : undefined,
        custom_name: typeof data.custom_name === "string" ? data.custom_name : undefined,
        last_representative_name: typeof data.last_representative_name === "string" ? data.last_representative_name : undefined,
        last_dni: typeof data.last_dni === "string" ? data.last_dni : undefined,
        last_ruc: typeof data.last_ruc === "string" ? data.last_ruc : undefined,
        last_factura_direccion:
          typeof data.last_factura_direccion === "string" ? data.last_factura_direccion : undefined,
        last_factura_razon_social:
          typeof data.last_factura_razon_social === "string" ? data.last_factura_razon_social : undefined,
        reservation_count: typeof reservationCount === "number" ? reservationCount : 0,
        balance: typeof balance === "number" ? balance : 0,
        client_type: (clientType === "casual" || clientType === "frecuente" || clientType === "academia" || clientType === "sospechoso_fraude"
          ? clientType
          : "casual") as ClientType,
        is_automated: typeof isAutomated === "boolean" ? isAutomated : true,
        needs_help: typeof needsHelp === "boolean" ? needsHelp : false,
        help_reason: typeof helpReason === "string" ? helpReason : undefined,
        last_interaction_at: data.last_interaction_at?.toDate
          ? data.last_interaction_at.toDate().toISOString()
          : typeof data.last_interaction_at === "string"
            ? data.last_interaction_at
            : undefined,
        created_at: data.created_at?.toDate
          ? data.created_at.toDate().toISOString()
          : typeof data.created_at === "string"
            ? data.created_at
            : undefined,
        profile_picture: typeof data.profile_picture === "string" ? data.profile_picture : undefined,
      };
    });

    return NextResponse.json(list, {
      headers: {
        // Edge cache corto para listar usuarios sin golpear Firestore en cada navegación.
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
    const {
      id,
      is_automated,
      client_type,
      custom_name,
      last_dni,
      last_ruc,
      last_factura_direccion,
      last_factura_razon_social,
      phone_number,
    } = body;

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

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No hay campos para actualizar" },
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
    const { id } = await request.json();

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
