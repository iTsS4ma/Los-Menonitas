import Image from "next/image";
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

  const esActual = (texto: string) => texto === titulo || (texto === "Admin" && titulo === "Administración");

  return (
    <header className="bg-cafe text-crema print:hidden">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="Los Menonitas"
            width={44}
            height={44}
            className="h-11 w-11 rounded-full bg-crema object-cover ring-2 ring-queso"
            priority
          />
          <div>
            <p className="font-display text-xl font-bold leading-tight">{titulo}</p>
            <p className="text-sm text-crema/70">{perfil.nombre}</p>
          </div>
        </div>
        <nav className="flex flex-wrap items-center gap-2">
          {enlaces.map(([href, texto]) => (
            <Link
              key={href}
              href={href}
              className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                esActual(texto) ? "bg-queso text-cafe" : "text-crema/85 hover:bg-crema/10"
              }`}
            >
              {texto}
            </Link>
          ))}
          <BotonSalir />
        </nav>
      </div>
      <div className="paliacate h-2" aria-hidden />
    </header>
  );
}
