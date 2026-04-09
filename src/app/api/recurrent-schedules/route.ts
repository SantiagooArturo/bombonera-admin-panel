import { NextResponse } from "next/server";
import { getDb } from "@/lib/firebase-admin";

export async function GET() {
  try {
    const db = getDb();
    const snapshot = await db.collection("recurrent_schedules").get();
    const schedules = snapshot.docs.map(doc => doc.data());
    return NextResponse.json(schedules);
  } catch (error) {
    console.error("Error fetching recurrent schedules:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
