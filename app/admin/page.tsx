import AdminOpsClient from "./AdminOpsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function AdminPage() {
  return <AdminOpsClient />;
}
