"use client";

import { useEffect, useState } from "react";
import { elegirImpresora, escucharImpresora, recuperarImpresora, type EstadoImpresora } from "@/lib/impresoraBT";

export default function BotonImpresora() {
  const [estado, setEstado] = useState<EstadoImpresora | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const quitar = escucharImpresora(setEstado);
    recuperarImpresora();
    return quitar;
  }, []);

  if (!estado) return null;

  if (!estado.soportado) {
    return (
      <p className="rounded-xl bg-queso-claro px-3 py-2.5 text-sm">
        Para imprimir comandas abre el sistema en <strong>Chrome</strong> en un celular Android.
      </p>
    );
  }

  async function elegir() {
    setError("");
    try {
      await elegirImpresora();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!/cancel/i.test(msg)) setError(msg || "No se pudo elegir la impresora.");
    }
  }

  if (estado.lista) {
    return (
      <div className="flex items-center justify-between rounded-xl bg-hoja-claro px-3 py-2 text-sm">
        <span className="font-medium text-hoja">
          {estado.imprimiendo ? "Imprimiendo…" : `Impresora: ${estado.nombre}`}
        </span>
        <button onClick={elegir} className="text-xs font-semibold text-cafe-medio underline-offset-2 hover:underline">
          Cambiar
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={elegir}
        className="w-full rounded-xl border-2 border-cafe bg-white py-3 font-semibold hover:bg-crema-oscuro"
      >
        {estado.nombre ? `Conectar impresora (${estado.nombre})` : "Conectar impresora de comandas"}
      </button>
      {error && <p className="text-xs text-paliacate">{error}</p>}
    </div>
  );
}
