import { redirect } from "next/navigation";

export default function OwnerApprovalsRedirect() {
  redirect("/login");
}

