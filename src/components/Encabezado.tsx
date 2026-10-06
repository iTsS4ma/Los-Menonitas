import Image from "next/image";
import Link from "next/link";
import BotonSalir from "@/components/BotonSalir";
import type { Perfil } from "@/lib/perfil";

export default function Encabezado({ titulo, perfil }: { titulo: string; perfil: Perfil }) {
  const enlaces =
    perfil.rol === "ADMIN"
      ? [["/admin", "Admin"], ["/mesero", "Mesero"], ["/caja", "Caja"]]
      : perfil.rol === "MESERO" && perfil.puede_cobrar
        ? [["/mesero", "Mesero"], ["/caja", "Caja"]]
        : [];

  const esActual = (texto: string) => texto === titulo || (texto === "Admin" && titulo === "Administración");

  return (
    <header className="bg-cafe text-crema print:hidden">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
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

        {/* En celular esta fila ocupa todo el ancho: pantallas a la izquierda, salir a la derecha */}
        <div className="flex w-full items-center gap-2 sm:ml-auto sm:w-auto">
          {enlaces.length > 0 && (
            <nav className="flex flex-wrap items-center gap-2">
              {enlaces.map(([href, texto]) => (
                <Link
                  key={href}
                  href={href}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                    esActual(texto) ? "bg-queso text-cafe" : "text-crema/85 hover:bg-crema/10"
                  }`}
                >
                  {texto}
                </Link>
              ))}
            </nav>
          )}
          <div className="ml-auto flex items-center sm:ml-6 sm:border-l sm:border-crema/20 sm:pl-6">
            <BotonSalir />
          </div>
        </div>
      </div>
      <div className="paliacate h-2" aria-hidden />
    </header>
  );
}
