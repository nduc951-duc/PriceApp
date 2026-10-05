import { PriceApp } from "@/components/price-app";
import { AuthGate } from "@/components/auth-gate";

export default function Home() {
  return <AuthGate><PriceApp /></AuthGate>;
}
