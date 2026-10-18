import { CustomerStorefront } from "@/components/customer-storefront";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function ShopPage() {
  return <>
    <div className="border-b border-gray-200 bg-white px-4 py-2">
      <Link href="/" className="inline-flex min-h-10 items-center gap-2 text-sm text-gray-600 hover:text-blue-700"><ArrowLeft size={16}/>Đổi vai trò</Link>
    </div>
    <CustomerStorefront />
  </>;
}
