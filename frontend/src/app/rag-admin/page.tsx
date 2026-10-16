import { AuthGate } from "@/components/auth-gate";
import { RagAdmin } from "@/components/rag-admin";
export default function RagAdminPage() { return <AuthGate floatingLogout={false}><RagAdmin/></AuthGate>; }
