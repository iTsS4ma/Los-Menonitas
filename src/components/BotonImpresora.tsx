"use client";

import { useEffect, useState } from "react";
import {
  elegirImpresora,
  escucharImpresoras,
  imprimir,
  LUGARES,
  recuperarImpresoras,
  ticketPrueba,
  vigilarImpresora,
  type Destino,
  type EstadoImpresoras,
} from "@/lib/impresoraBT";

/**
 * Un lugar fijo de impresora (Cocina, Garnachas o Caja) en este equipo.
 * Tiene una sola impresora: conectar otra la reemplaza. Se vacía cada día nuevo.
 */
export default function BotonImpresora({ destino, vigilar = false }: { destino: Destino; vigilar?: boolean }) {
  const [estado, setEstado] = useState<EstadoImpresoras | null>(null);
  const [error, setError] = useState("");
  const [probando, setProbando] = useState(false);
  const lugar = LUGARES[destino];

  useEffect(() => {
    const quitar = escucharImpresoras(destino, setEstado);
    recuperarImpresoras(destino);
    // En la estación de cocina la conexión se vigila y se reconecta sola
    const detener = vigilar ? vigilarImpresora(destino) : () => {};
    return () => {
      quitar();
      detener();
    };
  }, [destino, vigilar]);

  if (!estado) return null;
  if (!estado.soportado) {
    return (
      <p className="rounded-xl bg-queso-claro px-3 py-2.5 text-sm">
        Para imprimir abre el sistema en <strong>Chrome</strong> en un celular Android o en una computadora. En iPhone no se puede.
      </p>
    );
  }

  const impresora = estado.impresoras[0];
  // Con vigilancia, "conectada" es la conexión real; sin ella, que ya tiene permiso
  const conectada = vigilar ? estado.enLinea : !!impresora?.lista;
  const reconectando = vigilar && !!impresora?.lista && !estado.enLinea;

  async function conectar() {
    setError("");
    try {
      await elegirImpresora(destino);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!/cancel/i.test(msg)) setError(msg || "No se pudo conectar la impresora.");
    }
  }

  async function probar() {
    setError("");
    setProbando(true);
    try {
      await imprimir(destino, ticketPrueba(destino));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo imprimir la prueba.");
    }
    setProbando(false);
  }

  return (
    <div
      className={`rounded-xl px-3 py-2.5 text-sm ${
        conectada ? "bg-hoja-claro" : reconectando ? "border-2 border-paliacate bg-paliacate-claro" : "border-2 border-dashed border-paliacate/50 bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${conectada ? "bg-hoja" : "bg-paliacate"}`} />
          <span>
            <strong>Impresora {lugar.nombre}</strong>
            <span className="block text-xs text-cafe-medio">
              {estado.imprimiendo
                ? "Imprimiendo…"
                : conectada
                ? "Conectada"
                : reconectando
                ? "Se perdió la conexión · reconectando sola…"
                : `Sin conectar · elige la que termina en ${lugar.terminacion}`}
            </span>
          </span>
        </span>
        <span className="flex shrink-0 gap-2">
          {(conectada || reconectando) && (
            <button
              onClick={probar}
              disabled={probando}
              className="rounded-lg border border-borde bg-white px-3 py-1.5 text-xs font-semibold hover:border-cafe-medio disabled:opacity-40"
            >
              {probando ? "…" : "Probar"}
            </button>
          )}
          <button
            onClick={conectar}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${conectada || reconectando ? "border border-borde bg-white hover:border-cafe-medio" : "bg-paliacate text-white hover:bg-paliacate-oscuro"}`}
          >
            {conectada || reconectando ? "Cambiar" : "Conectar"}
          </button>
        </span>
      </div>
      {error && <p className="mt-1.5 text-xs text-paliacate">{error}</p>}
    </div>
  );
}
