"use client";

import { useEffect, useState } from "react";
import {
  elegirImpresora,
  escucharImpresoras,
  quitarImpresora,
  recuperarImpresoras,
  type Destino,
  type EstadoImpresoras,
} from "@/lib/impresoraBT";

/**
 * Configuración de impresoras Bluetooth de este equipo.
 * - varias = true: se pueden agregar varias (cocina); la comanda sale en todas.
 * - varias = false: una sola (caja).
 */
export default function BotonImpresora({
  destino,
  titulo,
  varias = false,
}: {
  destino: Destino;
  titulo: string;
  varias?: boolean;
}) {
  const [estado, setEstado] = useState<EstadoImpresoras | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const quitar = escucharImpresoras(destino, setEstado);
    recuperarImpresoras(destino);
    return quitar;
  }, [destino]);

  if (!estado) return null;

  if (!estado.soportado) {
    return (
      <p className="rounded-xl bg-queso-claro px-3 py-2.5 text-sm">
        Para imprimir por Bluetooth abre el sistema en <strong>Chrome</strong>.
      </p>
    );
  }

  async function elegir(reemplazar = false) {
    setError("");
    try {
      await elegirImpresora(destino, reemplazar);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!/cancel/i.test(msg)) setError(msg || "No se pudo elegir la impresora.");
    }
  }

  const { impresoras } = estado;
  const todasListas = impresoras.length > 0 && impresoras.every((i) => i.lista);

  return (
    <div
      className={`space-y-2 rounded-xl px-3 py-2.5 text-sm ${
        todasListas ? "bg-hoja-claro" : "border-2 border-dashed border-borde bg-white"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold">{estado.imprimiendo ? "Imprimiendo…" : titulo}</span>
        {(varias || impresoras.length === 0) && (
          <button onClick={() => elegir(false)} className="text-xs font-semibold text-cafe underline-offset-2 hover:underline">
            + Agregar impresora
          </button>
        )}
        {!varias && impresoras.length > 0 && (
          <button onClick={() => elegir(true)} className="text-xs font-semibold text-cafe-medio underline-offset-2 hover:underline">
            Cambiar
          </button>
        )}
      </div>

      {impresoras.length === 0 && <p className="text-cafe-medio">Ninguna impresora conectada en este equipo.</p>}

      {impresoras.map((i) => (
        <div key={i.id} className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <span className={`h-2.5 w-2.5 rounded-full ${i.lista ? "bg-hoja" : "bg-queso"}`} />
            {i.nombre}
          </span>
          <span className="flex gap-3 text-xs font-semibold">
            {!i.lista && (
              <button onClick={() => elegir(false)} className="text-paliacate underline-offset-2 hover:underline">
                Reconectar
              </button>
            )}
            {varias && (
              <button onClick={() => quitarImpresora(destino, i.id)} className="text-cafe-medio underline-offset-2 hover:underline">
                Quitar
              </button>
            )}
          </span>
        </div>
      ))}
      {error && <p className="text-xs text-paliacate">{error}</p>}
    </div>
  );
}
