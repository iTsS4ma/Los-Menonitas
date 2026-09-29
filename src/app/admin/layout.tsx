import Link from "next/link";
import Encabezado from "@/components/Encabezado";
import { exigirRol } from "@/lib/perfil";

const PESTANAS = [
  ["/admin", "Reportes"],
  ["/admin/menu", "Menú"],
  ["/admin/mesas", "Mesas"],
  ["/admin/personal", "Personal"],
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const perfil = await exigirRol(["ADMIN"]);
  return (
    <>
      <Encabezado titulo="Administración" perfil={perfil} />
      <nav className="flex gap-2 overflow-x-auto border-b px-3 py-2">
        {PESTANAS.map(([href, texto]) => (
          <Link key={href} href={href} className="shrink-0 rounded px-3 py-2 transition-colors hover:bg-orange-50 hover:text-orange-700">
            {texto}
          </Link>
        ))}
      </nav>
      <main className="mx-auto w-full max-w-5xl flex-1 p-3">{children}</main>
    </>
  );
}
