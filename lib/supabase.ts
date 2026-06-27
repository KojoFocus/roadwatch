// Supabase Storage helpers — client-side only (used from "use client" components)

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL  || "";
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

async function uploadToSupabase(
  bucket: string,
  path:   string,
  blob:   Blob,
  contentType: string
): Promise<string> {
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
  const res = await fetch(url, {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${SUPABASE_ANON}`,
      "Content-Type":  contentType,
      "x-upsert":      "true",
    },
    body: blob,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upload failed: ${err}`);
  }

  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

export async function uploadPhoto(file: File): Promise<string> {
  const ext  = file.name.split(".").pop() || "jpg";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  return uploadToSupabase("report-photos", path, file, file.type || "image/jpeg");
}

export async function uploadAudio(blob: Blob, mimeType: string): Promise<string> {
  const ext  = mimeType.includes("ogg") ? "ogg" : "webm";
  const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  return uploadToSupabase("report-audio", path, blob, mimeType);
}
