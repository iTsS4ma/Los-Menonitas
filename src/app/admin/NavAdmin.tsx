"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const PESTANAS = [
  ["/admin", "Reportes"],
  ["/admin/menu", "Menú"],
  ["/admin/mesas", "Mesas"],
  ["/admin/personal", "Personal"],
];

export default function NavAdmin() {
  const ruta = usePathname();
  return (
    <nav className="border-b border-borde bg-white">
      <div className="mx-auto flex w-full max-w-6xl gap-1 overflow-x-auto px-4">
        {PESTANAS.map(([href, texto]) => {
          const activa = ruta === href;
          return (
            <Link
              key={href}
              href={href}
              className={`shrink-0 border-b-[3px] px-4 py-3 text-sm font-semibold transition-colors ${
                activa
                  ? "border-paliacate text-cafe"
                  : "border-transparent text-cafe-medio hover:text-cafe"
              }`}
            >
              {texto}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
