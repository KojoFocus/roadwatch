import { GoogleGenerativeAI } from "@google/generative-ai";
import type { TranscribeResponse, HazardType, Severity } from "@/types";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

// ─── Transcribe voice note ────────────────────────────────────────────────────
export async function transcribeVoice(
  audioBase64: string,
  mimeType: string = "audio/webm"
): Promise<TranscribeResponse> {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `You are a road hazard report assistant for Ghana.
A citizen has sent a voice note to report a road hazard.
They may be speaking in English, Twi, Ga, Ewe, Hausa, or a mix.

Listen to the audio and extract:
1. A transcript in the language they spoke
2. The hazard type (one of: POTHOLE, FLOOD, ACCIDENT, DEBRIS, BROKEN_LIGHT, ROAD_BLOCK, DANGEROUS_ANIMAL, OTHER)
3. The severity (one of: LOW, MEDIUM, HIGH, CRITICAL)
4. Any location mentioned (road name, junction, landmark)
5. The primary language detected

Return ONLY valid JSON, no markdown, no explanation:
{
  "transcript": "exact words spoken",
  "hazardType": "POTHOLE",
  "severity": "HIGH",
  "locationHint": "Spintex Road near Total",
  "language": "Twi",
  "confidence": 0.92
}

If you cannot determine hazardType or severity, use null.
If no location is mentioned, use null for locationHint.`;

  const result = await model.generateContent([
    { text: prompt },
    {
      inlineData: {
        mimeType,
        data: audioBase64,
      },
    },
  ]);

  const text = result.response.text().trim();

  try {
    const parsed = JSON.parse(text);
    return {
      transcript:   parsed.transcript   || "",
      hazardType:   parsed.hazardType   as HazardType || undefined,
      severity:     parsed.severity     as Severity   || undefined,
      locationHint: parsed.locationHint || undefined,
      language:     parsed.language     || "Unknown",
      confidence:   parsed.confidence   || 0,
    };
  } catch {
    // Fallback if JSON parsing fails
    return {
      transcript: text,
      language:   "Unknown",
      confidence: 0,
    };
  }
}

// ─── Classify a text description ─────────────────────────────────────────────
export async function classifyReport(text: string): Promise<{
  hazardType?: HazardType;
  severity?:   Severity;
}> {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const prompt = `Classify this road hazard report from Ghana.

Report: "${text}"

Return ONLY valid JSON:
{
  "hazardType": "POTHOLE",
  "severity": "HIGH"
}

hazardType options: POTHOLE, FLOOD, ACCIDENT, DEBRIS, BROKEN_LIGHT, ROAD_BLOCK, DANGEROUS_ANIMAL, OTHER
severity options: LOW, MEDIUM, HIGH, CRITICAL`;

  const result = await model.generateContent(prompt);
  const raw    = result.response.text().trim();

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
