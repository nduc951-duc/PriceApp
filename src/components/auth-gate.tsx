"use client";

import { FormEvent, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!supabase);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => { setUser(data.user); setReady(true); });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  async function login(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    if (!supabase) { setError("Chưa cấu hình Supabase."); setBusy(false); return; }
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) setError("Email hoặc mật khẩu không đúng.");
    setBusy(false);
  }

  if (!ready) return <div className="grid min-h-screen place-items-center text-sm text-[var(--muted)]">Đang kiểm tra phiên đăng nhập…</div>;
  if (!user) return <main className="grid min-h-screen place-items-center px-5"><form onSubmit={login} className="w-full max-w-sm rounded-3xl border border-[var(--line)] bg-[var(--card)] p-7 shadow-xl"><div className="mb-7 flex items-center gap-3"><span className="grid size-11 place-items-center rounded-xl bg-[var(--green)] text-xl font-black text-white">đ</span><div><h1 className="text-xl font-black">Đăng nhập Giá Chuẩn</h1><p className="text-sm text-[var(--muted)]">Bảng giá dành cho nội bộ</p></div></div><label className="mb-1 block text-sm font-bold" htmlFor="email">Email</label><input id="email" type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className="mb-4 h-12 w-full rounded-xl border border-[var(--line)] bg-white px-4 outline-none focus:border-[var(--green)]"/><label className="mb-1 block text-sm font-bold" htmlFor="password">Mật khẩu</label><input id="password" type="password" required autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} className="h-12 w-full rounded-xl border border-[var(--line)] bg-white px-4 outline-none focus:border-[var(--green)]"/>{error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}<button disabled={busy} className="mt-5 h-12 w-full rounded-xl bg-[var(--green)] font-bold text-white disabled:opacity-60">{busy?"Đang đăng nhập…":"Đăng nhập"}</button></form></main>;
  return <>{children}<button onClick={()=>supabase?.auth.signOut()} className="fixed right-16 top-5 z-20 rounded-lg px-3 py-2 text-xs font-bold text-[var(--muted)] sm:right-20">Đăng xuất</button></>;
}
