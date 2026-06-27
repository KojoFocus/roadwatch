"use client";

import { useState, useRef, useCallback } from "react";
import type { TranscribeResponse }        from "@/types";

type VoiceState =
  | "idle"
  | "recording"
  | "processing"
  | "done"
  | "error";

interface UseVoiceReturn {
  state:       VoiceState;
  duration:    number;           // seconds recorded
  result:      TranscribeResponse | null;
  error:       string | null;
  startRecording: () => Promise<void>;
  stopRecording:  () => void;
  reset:          () => void;
}

export function useVoice(): UseVoiceReturn {
  const [state,    setState]    = useState<VoiceState>("idle");
  const [duration, setDuration] = useState(0);
  const [result,   setResult]   = useState<TranscribeResponse | null>(null);
  const [error,    setError]    = useState<string | null>(null);

  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const audioChunks   = useRef<Blob[]>([]);
  const durationTimer = useRef<NodeJS.Timeout | null>(null);
  const stream        = useRef<MediaStream | null>(null);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setResult(null);
      setDuration(0);
      audioChunks.current = [];

      const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current    = mediaStream;

      // Pick best supported format
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/mp4",
      ].find(t => MediaRecorder.isTypeSupported(t)) || "audio/webm";

      const recorder = new MediaRecorder(mediaStream, { mimeType });
      mediaRecorder.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };

      recorder.onstop = async () => {
        // Stop mic
        mediaStream.getTracks().forEach(t => t.stop());

        // Build blob
        const blob     = new Blob(audioChunks.current, { type: mimeType });
        const base64   = await blobToBase64(blob);

        setState("processing");

        try {
          const res = await fetch("/api/transcribe", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ audio: base64, mimeType }),
          });

          const json = await res.json();

          if (json.success) {
            setResult(json.data);
            setState("done");
          } else {
            throw new Error(json.error || "Transcription failed");
          }
        } catch (err: any) {
          setError(err.message || "Failed to process voice note");
          setState("error");
        }
      };

      recorder.start(100); // Collect data every 100ms
      setState("recording");

      // Track duration
      durationTimer.current = setInterval(() => {
        setDuration(d => d + 1);
      }, 1000);

      // Auto-stop after 30 seconds
      setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, 30000);

    } catch (err: any) {
      const msg = err.name === "NotAllowedError"
        ? "Microphone access denied. Please allow microphone and try again."
        : "Could not start recording.";
      setError(msg);
      setState("error");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (durationTimer.current) {
      clearInterval(durationTimer.current);
      durationTimer.current = null;
    }
    if (mediaRecorder.current?.state === "recording") {
      mediaRecorder.current.stop();
    }
  }, []);

  const reset = useCallback(() => {
    stopRecording();
    setState("idle");
    setDuration(0);
    setResult(null);
    setError(null);
    audioChunks.current = [];
  }, [stopRecording]);

  return { state, duration, result, error, startRecording, stopRecording, reset };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
