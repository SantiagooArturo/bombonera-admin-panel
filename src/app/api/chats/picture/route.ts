import { NextRequest, NextResponse } from "next/server";
import { resolveWhatsAppTarget } from "@/lib/waha";
import {
  getWahaApiKey,
  getWahaSession,
  getWahaUrl,
  isWahaConfigured,
} from "@/lib/waha-server-config";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const chatId = searchParams.get("chat_id");
    const refresh = searchParams.get("refresh") === "true";

    if (!chatId) {
      return NextResponse.json({ error: "chat_id es obligatorio" }, { status: 400 });
    }

    if (!isWahaConfigured()) {
      return NextResponse.json({ url: null });
    }

    const resolved = await resolveWhatsAppTarget(chatId);
    
    const url = `${getWahaUrl()}/api/${getWahaSession()}/chats/${encodeURIComponent(resolved.chatId)}/picture?refresh=${refresh}`;
    const res = await fetch(url, {
      method: "GET",
      headers: {
        "X-Api-Key": getWahaApiKey(),
      },
    });

    if (!res.ok) {
      return new Response(null, { status: 404 });
    }

    const data = await res.json();
    if (data.url) {
      return NextResponse.redirect(data.url, { status: 307 });
    }

    return new Response(null, { status: 404 });
  } catch (error) {
    console.error("Error fetching chat picture:", error);
    return new Response(null, { status: 404 });
  }
}
