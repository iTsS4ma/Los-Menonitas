import Link from "next/link";
import BotonSalir from "@/components/BotonSalir";
import type { Perfil } from "@/lib/perfil";

export default function Encabezado({ titulo, perfil }: { titulo: string; perfil: Perfil }) {
  const enlaces =
    perfil.rol === "ADMIN"
      ? [["/admin", "Admin"], ["/mesero", "Mesero"], ["/cocina", "Cocina"], ["/caja", "Caja"]]
      : perfil.rol === "MESERO" && perfil.puede_cobrar
        ? [["/mesero", "Mesero"], ["/caja", "Caja"]]
        : [];
  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
      <div>
        <h1 className="text-xl font-semibold">{titulo}</h1>
        <p className="text-sm text-slate-600">{perfil.nombre}</p>
      </div>
      <nav className="flex flex-wrap items-center gap-2">
        {enlaces.map(([href, texto]) => (
          <Link key={href} href={href} className="rounded border px-3 py-2 text-sm">
            {texto}
          </Link>
        ))}
        <BotonSalir />
      </nav>
    </header>
  );
}
