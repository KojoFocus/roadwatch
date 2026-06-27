"use client";

import { useState }      from "react";
import { useRouter }     from "next/navigation";

export default function LoginPage() {
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const router                  = useRouter();

  const login = async () => {
    if (!email || !password) { setError("Enter email and password"); return; }
    setLoading(true); setError("");
    try {
      const res  = await fetch("/api/auth", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ email, password }) });
      const json = await res.json();
      if (json.success) { router.push("/admin/dashboard"); router.refresh(); }
      else              { setError(json.error || "Invalid credentials"); }
    } catch { setError("Login failed. Try again."); }
    setLoading(false);
  };

  return (
    <div style={{ background:"#0A0A0A", minHeight:"100vh", display:"flex", flexDirection:"column", justifyContent:"center", padding:"40px 24px", fontFamily:"'Inter',-apple-system,sans-serif" }}>
      <style>{`*{box-sizing:border-box;margin:0;padding:0} input{outline:none} input::placeholder{color:#1e1e1e}`}</style>

      <div style={{ marginBottom:40 }}>
        <div style={{ color:"#EF4444", fontSize:9, fontWeight:900, letterSpacing:3.5, marginBottom:8 }}>ROADWATCH GH</div>
        <div style={{ color:"#fff", fontSize:26, fontWeight:900, letterSpacing:-.5, marginBottom:6 }}>Admin Portal</div>
        <div style={{ color:"#333", fontSize:13 }}>Road Safety Intelligence Dashboard</div>
      </div>

      <div style={{ marginBottom:12 }}>
        <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@roadwatch.gh"
          style={{ width:"100%", background:"#111", border:`1px solid ${error?"rgba(239,68,68,0.4)":"#1a1a1a"}`, borderRadius:14, padding:"14px 16px", color:"#fff", fontSize:15, fontFamily:"inherit" }}/>
      </div>

      <div style={{ marginBottom:28 }}>
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••"
          onKeyDown={e => e.key === "Enter" && login()}
          style={{ width:"100%", background:"#111", border:`1px solid ${error?"rgba(239,68,68,0.4)":"#1a1a1a"}`, borderRadius:14, padding:"14px 16px", color:"#fff", fontSize:15, fontFamily:"inherit" }}/>
      </div>

      {error && <div style={{ color:"#EF4444", fontSize:12, marginBottom:14, textAlign:"center" }}>{error}</div>}

      <button onClick={login} disabled={loading}
        style={{ width:"100%", background:loading?"#7f1d1d":"#EF4444", border:"none", borderRadius:14, padding:"16px", color:"#fff", fontWeight:800, fontSize:16, fontFamily:"inherit", transition:"background .2s" }}>
        {loading ? "Signing in…" : "Sign In"}
      </button>

      <div style={{ textAlign:"center", marginTop:24, color:"#1e1e1e", fontSize:11 }}>
        admin@roadwatch.gh · roadwatch2024
      </div>
    </div>
  );
}
