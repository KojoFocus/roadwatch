import { NextRequest, NextResponse } from "next/server";
import { transcribeVoice }           from "@/lib/gemini";

// ─── POST /api/transcribe ─────────────────────────────────────────────────────
// Receives base64 audio, returns transcript + hazard classification
export async function POST(req: NextRequest) {
  try {
    const body     = await req.json();
    const { audio, mimeType } = body;

    if (!audio) {
      return NextResponse.json(
        { success: false, error: "No audio provided" },
        { status: 400 }
      );
    }

    // Strip data URL prefix if present
    const base64 = audio.includes(",") ? audio.split(",")[1] : audio;

    const result = await transcribeVoice(base64, mimeType || "audio/webm");

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error("POST /api/transcribe:", error);
    return NextResponse.json(
      { success: false, error: "Transcription failed" },
      { status: 500 }
    );
  }
}
