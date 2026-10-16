"use client";

import { FormEvent, useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LockKeyhole, Mail, ShieldCheck, Store } from "lucide-react";
import { Alert, Button, Card, Label, Spinner, TextInput } from "flowbite-react";
import { createClient } from "@/lib/supabase/client";
import { clearSnapshotCache } from "@/features/offline/cache";
import { AuthLogoutContext } from "@/components/auth-actions-context";

export function AuthGate({ children, floatingLogout = true }: { children: React.ReactNode; floatingLogout?: boolean }) {
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
    try {
      await supabase?.auth.signOut();
    }
    finally {
      localStorage.removeItem("gia-chuan-invoice");
      await clearSnapshotCache().catch(() => undefined);
      if ("caches" in window) {
        const keys = await caches.keys().catch(() => []);
        await Promise.all(keys.filter((key) => key.startsWith("gia-chuan-")).map((key) => caches.delete(key)));
      }
    }
  }

  if (!ready) return <div className="grid min-h-screen place-items-center text-sm text-[var(--muted)]"><Spinner aria-label="Đang kiểm tra phiên đăng nhập" /> Đang kiểm tra phiên đăng nhập…</div>;
  if (!user) return (
    <main className="auth-page flex min-h-screen items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-7 flex items-center gap-3"><Store size={26} className="text-blue-700"/><h1 className="text-lg font-semibold">Giá Chuẩn</h1></div>
        {authUnavailable && <Alert color="warning" className="mb-5">Không kết nối được máy chủ đăng nhập. Kiểm tra mạng hoặc cấu hình Supabase rồi tải lại trang.</Alert>}
        <Card className="rounded-lg border border-gray-200 bg-white shadow-none">
          <form onSubmit={login}>
          <h2 className="mb-2 text-xl font-semibold">Đăng nhập nhân viên</h2>
          <p className="mb-6 text-sm text-gray-600">Dùng tài khoản được cửa hàng cấp để tiếp tục.</p>
          <Label className="mb-2 block text-sm font-bold" htmlFor="email">Email</Label>
          <TextInput id="email" type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ten@cuahang.vn" icon={Mail} className="mb-5" />
          <Label className="mb-2 block text-sm font-bold" htmlFor="password">Mật khẩu</Label>
          <TextInput id="password" type="password" required autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} icon={LockKeyhole} />
          {error && <Alert color="failure" className="mt-4">{error}</Alert>}
          <Button type="submit" fullSized disabled={busy} className="mt-6 min-h-11">{busy ? "Đang đăng nhập…" : "ĐĂNG NHẬP"}</Button>
          </form>
        </Card>
        <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-[var(--muted)]"><ShieldCheck size={15} /> Chỉ dành cho tài khoản nội bộ được cấp quyền</p>
      </div>
    </main>
  );
  return <AuthLogoutContext.Provider value={logout}>{children}{floatingLogout && <Button color="light" onClick={() => void logout()} className="fixed right-2 top-3 z-40 rounded-lg border border-[var(--line)] bg-white px-3 py-2 text-xs font-bold text-[var(--muted)] sm:right-5">Đăng xuất</Button>}</AuthLogoutContext.Provider>;
}
