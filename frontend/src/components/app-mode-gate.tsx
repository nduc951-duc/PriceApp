"use client";

import { ArrowLeft, ArrowRight, LockKeyhole, ShoppingBasket, Store } from "lucide-react";
import { Button, Card } from "flowbite-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { PriceApp } from "@/components/price-app";
import { createClient } from "@/lib/supabase/client";

export function AppModeGate({ employee = false }: { employee?: boolean }) {
  const router = useRouter();
  const client = useMemo(() => createClient(), []);
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    let active = true;
    void client?.auth.getSession().then(({ data }) => { if (active) setSignedIn(Boolean(data.session)); }).catch(() => undefined);
    const subscription = client?.auth.onAuthStateChange((_event, session) => { if (active) setSignedIn(Boolean(session)); });
    return () => { active = false; subscription?.data.subscription.unsubscribe(); };
  }, [client]);

  if (employee) return <div><div className="border-b border-gray-200 bg-white px-4 py-2"><Link href="/" className="inline-flex min-h-10 items-center gap-2 text-sm text-gray-600 hover:text-blue-700"><ArrowLeft size={16}/>Đổi vai trò</Link></div><AuthGate floatingLogout={false}><PriceApp/></AuthGate></div>;

  // Flowbite Card + Button: compact entry, without a marketing hero.
  return <main className="grid min-h-screen place-items-center bg-gray-50 px-4 py-10 text-gray-900">
    <div className="w-full max-w-md">
      <Link href="/" className="mb-8 flex items-center gap-2.5 text-lg font-semibold"><Store size={26} className="text-blue-700"/>Giá Chuẩn</Link>
      <h1 className="text-2xl font-semibold">Bạn muốn vào đâu?</h1><p className="mt-2 mb-6 text-base text-gray-600">Chọn khu vực phù hợp với công việc của bạn.</p>
      <Card className="mb-4 border-gray-200 shadow-none">
        <div className="flex items-center gap-3"><ShoppingBasket className="text-blue-700" size={22}/><h2 className="text-lg font-semibold">Tra giá và đặt hàng</h2></div>
        <p className="text-sm leading-6 text-gray-600">Xem giá lẻ, giá sỉ và gửi yêu cầu cho cửa hàng. Không cần tài khoản.</p>
        <Button onClick={() => router.push("/shop")} aria-label="Khách hàng"><span>Khách hàng</span><ArrowRight size={17} className="ml-auto"/></Button>
      </Card>
      <Card className="border-gray-200 shadow-none"><div className="flex items-center gap-3"><LockKeyhole size={20} className="text-gray-500"/><h2 className="text-lg font-semibold">Khu vực nhân viên</h2></div><p className="text-sm leading-6 text-gray-600">Tra cứu, cập nhật giá và xử lý yêu cầu của khách.</p>
        {!signedIn && <Button color="light" disabled>Chưa đăng nhập</Button>}
        <Button color="light" onClick={() => router.push("/staff")} aria-label="Nhân viên">{signedIn ? "Vào khu vực nhân viên" : "Đăng nhập nhân viên"}<ArrowRight size={17} className="ml-auto"/></Button>
      </Card>
    </div>
  </main>;
}
