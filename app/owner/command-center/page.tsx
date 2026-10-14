import { headers } from "next/headers";
import { redirect, notFound } from "next/navigation";
import { requireRole, ROLE_OWNER } from "../../lib/booking/ownerAuth";
import { SiteShell } from "../../components/SiteShell";
import { CommandCenter } from "./CommandCenter";

export default async function CommandCenterPage() {
  const incoming = await headers();
  const auth = requireRole(new Request("http://internal/owner/command-center", { headers: incoming }), ROLE_OWNER);
  if (!auth.ok) { if (auth.status === 401) redirect("/login"); notFound(); }
  return <SiteShell><section className="owner-shell section"><p><a href="/login">← Operations Portal</a></p><CommandCenter /></section></SiteShell>;
}
