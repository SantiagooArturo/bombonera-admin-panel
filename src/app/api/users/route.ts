import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";
import type { User, ClientType } from "@/lib/types";

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
        custom_name: typeof data.custom_name === "string" ? data.custom_name : undefined,
        last_representative_name: typeof data.last_representative_name === "string" ? data.last_representative_name : undefined,
        last_dni: typeof data.last_dni === "string" ? data.last_dni : undefined,
        reservation_count: typeof reservationCount === "number" ? reservationCount : 0,
        balance: typeof balance === "number" ? balance : 0,
        client_type: (clientType === "recurrente" || clientType === "indeciso" || clientType === "sospechoso_fraude"
          ? clientType
          : null) as ClientType,
        is_automated: typeof isAutomated === "boolean" ? isAutomated : true,
        needs_help: typeof needsHelp === "boolean" ? needsHelp : false,
        help_reason: typeof helpReason === "string" ? helpReason : undefined,
      };
    });

    return NextResponse.json(list);
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "Error al obtener usuarios" },
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
    const { id, is_automated, client_type, custom_name } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Se requiere id del usuario" },
        { status: 400 }
      );
    }

    const VALID_CLIENT_TYPES = ["recurrente", "indeciso", "sospechoso_fraude", null];

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

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No hay campos para actualizar" },
        { status: 400 }
      );
    }

    await db.collection("users").doc(id).update(updateData);

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
