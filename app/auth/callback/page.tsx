"use client";
import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase-auth";

function CallbackHandler() {
  const router = useRouter();
  const params = useSearchParams();

  useEffect(() => {
    const code = params.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code)
        .then(({ error }) => router.replace(error ? "/?auth=error" : "/"));
    } else {
      supabase.auth.getSession()
        .then(({ data: { session } }) => router.replace(session ? "/" : "/?auth=error"));
    }
  }, [router, params]);

  return null;
}

export default function AuthCallbackPage() {
  return (
    <>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#0A0A0A", color:"#fff", fontFamily:"'Inter',-apple-system,sans-serif" }}>
        <div style={{ textAlign:"center" as const }}>
          <div style={{ fontSize:36, marginBottom:16 }}>🔐</div>
          <div style={{ color:"#888", fontSize:14 }}>Signing you in…</div>
        </div>
      </div>
      <Suspense>
        <CallbackHandler/>
      </Suspense>
    </>
  );
}
