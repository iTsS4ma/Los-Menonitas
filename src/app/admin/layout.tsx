import Encabezado from "@/components/Encabezado";
import { exigirRol } from "@/lib/perfil";
import NavAdmin from "./NavAdmin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const perfil = await exigirRol(["ADMIN"]);
  return (
    <>
      <Encabezado titulo="Administración" perfil={perfil} />
      <NavAdmin />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
    </>
  );
}
