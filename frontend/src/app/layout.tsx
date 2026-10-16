import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorker } from "@/components/service-worker";

export const metadata: Metadata = {
  title: "Giá Chuẩn | Tra giá vật tư",
  description: "Tra cứu và cập nhật bảng giá vật tư nhanh, chính xác.",
  manifest: "/manifest.webmanifest",
};
export const viewport: Viewport = { themeColor: "#1D4ED8", width: "device-width", initialScale: 1 };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="vi"><body>{children}<ServiceWorker /></body></html>;
}
