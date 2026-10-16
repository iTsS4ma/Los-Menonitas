"use client";

import { useEffect, useState } from "react";

// Abierto todos los días de 9:00 a 18:00 (hora de CDMX)
export default function Horario() {
  const [abierto, setAbierto] = useState<boolean | null>(null);
  useEffect(() => {
    const revisar = () => {
      const h = Number(new Date().toLocaleString("en-US", { timeZone: "America/Mexico_City", hour: "numeric", hour12: false }));
      setAbierto(h >= 9 && h < 18);
    };
    revisar();
    const t = setInterval(revisar, 60000);
    return () => clearInterval(t);
  }, []);
  if (abierto === null) return null;
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold ${
        abierto ? "bg-hoja text-white" : "bg-cafe text-crema"
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${abierto ? "animate-pulse bg-white" : "bg-crema/60"}`} />
      {abierto ? "Abierto ahora" : "Cerrado ahora · abrimos a las 9:00"}
    </span>
  );
}
