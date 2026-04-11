import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

/**
 * API para gestionar apuntes (notas) de clientes.
 * Los apuntes se guardan en la subcolección `notes` de cada usuario.
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("chat_id");
    if (!chatId) {
      return NextResponse.json({ error: "Se requiere chat_id" }, { status: 400 });
    }

    const db = getDb();
    const snapshot = await db
      .collection("users")
      .doc(chatId)
      .collection("notes")
      .orderBy("created_at", "desc")
      .get();

    const notes = snapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    return NextResponse.json(notes);
  } catch (error) {
    console.error("Error fetching notes:", error);
    return NextResponse.json({ error: "Error al obtener apuntes" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { chat_id, content } = await request.json();
    if (!chat_id || !content) {
      return NextResponse.json({ error: "Faltan datos (chat_id, content)" }, { status: 400 });
    }

    const db = getDb();
    const noteData = {
      content: content.trim(),
      created_at: new Date().toISOString(),
    };

    const userRef = db.collection("users").doc(chat_id);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      // Si el usuario no existe (raro si viene de una reserva), lo creamos mínimamente
      await userRef.set({
        chat_id,
        phone_number: chat_id,
        created_at: new Date().toISOString(),
        reservation_count: 0,
        balance: 0,
        client_type: "casual",
      });
    }

    const docRef = await userRef.collection("notes").add(noteData);

    // Denormalizamos el último apunte en el documento del usuario para la vista de la cuadrilla
    const preview = content.trim().length > 2000 ? content.trim().slice(0, 1997) + "..." : content.trim();
    await userRef.update({
      last_note: preview,
    });

    return NextResponse.json({ id: docRef.id, ...noteData });
  } catch (error) {
    console.error("Error creating note:", error);
    return NextResponse.json({ error: "Error al crear apunte" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("chat_id");
    const noteId = searchParams.get("note_id");

    if (!chatId || !noteId) {
      return NextResponse.json({ error: "Faltan parámetros (chat_id, note_id)" }, { status: 400 });
    }

    const db = getDb();
    const userRef = db.collection("users").doc(chatId);
    await userRef.collection("notes").doc(noteId).delete();

    // Actualizamos el last_note denormalizado
    const latest = await userRef.collection("notes").orderBy("created_at", "desc").limit(1).get();
    let preview = null;
    if (!latest.empty) {
      const lastContent = latest.docs[0].data().content || "";
      preview = lastContent.length > 2000 ? lastContent.slice(0, 1997) + "..." : lastContent;
    }

    await userRef.update({
      last_note: preview,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting note:", error);
    return NextResponse.json({ error: "Error al eliminar apunte" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { chat_id, note_id, content } = await request.json();
    if (!chat_id || !note_id || !content) {
      return NextResponse.json({ error: "Faltan datos (chat_id, note_id, content)" }, { status: 400 });
    }

    const db = getDb();
    const userRef = db.collection("users").doc(chat_id);
    await userRef.collection("notes").doc(note_id).update({
      content: content.trim(),
      updated_at: new Date().toISOString(),
    });

    // Actualizamos el last_note denormalizado si es la nota más reciente
    const latest = await userRef.collection("notes").orderBy("created_at", "desc").limit(1).get();
    if (!latest.empty && latest.docs[0].id === note_id) {
      const lastContent = content.trim();
      const preview = lastContent.length > 150 ? lastContent.slice(0, 147) + "..." : lastContent;
      await userRef.update({
        last_note: preview,
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating note:", error);
    return NextResponse.json({ error: "Error al actualizar apunte" }, { status: 500 });
  }
}
