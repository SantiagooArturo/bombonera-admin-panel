import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
    try {
        const db = getDb();
        const { searchParams } = new URL(request.url);
        const date = searchParams.get("date");

        if (!date) {
            return NextResponse.json({ error: "date es requerido" }, { status: 400 });
        }

        const [resCount, blockCount] = await Promise.all([
            db.collection("reservations")
                .where("date", "==", date)
                .where("status", "in", ["pending", "confirmed"])
                .count()
                .get(),
            db.collection("blocked-slots")
                .where("date", "==", date)
                .count()
                .get(),
        ]);

        return NextResponse.json({
            reservations: resCount.data().count,
            blocks: blockCount.data().count,
        });
    } catch (error) {
        console.error("Error fetching count:", error);
        return NextResponse.json({ error: "Error al obtener conteo" }, { status: 500 });
    }
}
