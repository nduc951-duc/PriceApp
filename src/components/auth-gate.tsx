"use client";

import { FormEvent, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LockKeyhole, Mail, ShieldCheck, Wifi } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clearSnapshotCache } from "@/features/offline/cache";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [supabase] = useState(() => createClient());
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!supabase);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [authUnavailable, setAuthUnavailable] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const timeout = setTimeout(() => {
      if (!active) return;
      setAuthUnavailable(true);
      setReady(true);
    }, 8000);
    supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!active) return;
        setUser(data.session?.user ?? null);
        setAuthUnavailable(Boolean(error));
      })
      .catch(() => { if (active) setAuthUnavailable(true); })
      .finally(() => { if (active) { clearTimeout(timeout); setReady(true); } });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setUser(session?.user ?? null);
    });
    return () => { active = false; clearTimeout(timeout); data.subscription.unsubscribe(); };
  }, [supabase]);

  async function login(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    if (!supabase) {
      setError("Chưa cấu hình Supabase.");
      setBusy(false);
      return;
    }
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError) {
      const networkFailure = authError.name === "AuthRetryableFetchError" || /network|fetch|connection/i.test(authError.message);
      setError(networkFailure ? "Không kết nối được Supabase Auth. Kiểm tra mạng rồi thử lại." : "Email hoặc mật khẩu không đúng.");
    }
    setBusy(false);
  }

  async function logout() {
    try { await supabase?.auth.signOut(); }
    finally {
      await clearSnapshotCache().catch(() => undefined);
      if ("caches" in window) {
        const keys = await caches.keys().catch(() => []);
        await Promise.all(keys.filter((key) => key.startsWith("gia-chuan-")).map((key) => caches.delete(key)));
      }
    }
  }

  if (!ready) return <div className="grid min-h-screen place-items-center text-sm text-[var(--muted)]">Đang kiểm tra phiên đăng nhập…</div>;
  if (!user) return (
    <main className="auth-page flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-5 rounded-2xl border border-[var(--line)] bg-white p-7 text-center">
          <span className="mx-auto mb-4 grid size-16 place-items-center rounded-2xl bg-[var(--green)] text-3xl font-black text-white">✓</span>
          <h1 className="text-2xl font-black">Giá Chuẩn</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">Hệ thống tra giá vật tư nội bộ</p>
        </div>
        <div className="mb-5 flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-semibold text-green-800">
          <Wifi size={19} aria-hidden="true" /> Đăng nhập trực tuyến để tra cứu và cập nhật giá
        </div>
        {authUnavailable && <p role="alert" className="mb-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">Không kết nối được máy chủ đăng nhập. Kiểm tra mạng hoặc cấu hình Supabase rồi tải lại trang.</p>}
        <form onSubmit={login} className="rounded-2xl border border-[var(--line)] bg-white p-6 shadow-sm sm:p-8">
          <h2 className="mb-6 text-xl font-bold">Đăng nhập vào ca trực</h2>
          <label className="mb-2 block text-sm font-bold" htmlFor="email">Email</label>
          <div className="relative mb-5"><Mail className="absolute left-4 top-3.5 text-[var(--muted)]" size={20} aria-hidden="true" /><input id="email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ten@cuahang.vn" className="h-12 w-full rounded-xl border border-[var(--line)] bg-white pl-12 pr-4 outline-none focus:border-[var(--green)]" /></div>
          <label className="mb-2 block text-sm font-bold" htmlFor="password">Mật khẩu</label>
          <div className="relative"><LockKeyhole className="absolute left-4 top-3.5 text-[var(--muted)]" size={20} aria-hidden="true" /><input id="password" type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className="h-12 w-full rounded-xl border border-[var(--line)] bg-white pl-12 pr-4 outline-none focus:border-[var(--green)]" /></div>
          {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
          <button disabled={busy} className="mt-7 h-12 w-full rounded-xl bg-[var(--green)] font-bold text-white disabled:opacity-60">{busy ? "Đang đăng nhập…" : "ĐĂNG NHẬP"}</button>
        </form>
        <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-[var(--muted)]"><ShieldCheck size={15} /> Chỉ dành cho tài khoản nội bộ được cấp quyền</p>
      </div>
    </main>
  );
  return <>{children}<button onClick={() => void logout()} className="fixed right-2 top-3 z-20 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold text-[var(--muted)] sm:right-5">Đăng xuất</button></>;
}
