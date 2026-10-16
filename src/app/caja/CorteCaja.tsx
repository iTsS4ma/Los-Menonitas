"use client";

import { useMemo, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { dinero } from "@/lib/formato";
import { imprimir, ticketCorte } from "@/lib/impresoraBT";

type Pago = { metodo: string; total: number; propina: number | null; descuento: number | null; cuentas: { consumo: number | null } | null };

const hoyMX = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

// Inicio del día de hoy en CDMX, en formato ISO (para filtrar pagos)
function inicioDeHoy() {
  const ahora = new Date();
  const mx = new Date(ahora.toLocaleString("en-US", { timeZone: "America/Mexico_City" }));
  const diferencia = ahora.getTime() - mx.getTime();
  const inicio = new Date(mx.getFullYear(), mx.getMonth(), mx.getDate());
  return new Date(inicio.getTime() + diferencia).toISOString();
}

/** Corte de caja: lo cobrado hoy por método, propinas, descuentos y cortesías. */
export default function CorteCaja() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [abierto, setAbierto] = useState(false);
  const [pagos, setPagos] = useState<Pago[] | null>(null);
  const [error, setError] = useState("");
  const [imprimiendo, setImprimiendo] = useState(false);

  async function abrir() {
    setAbierto(true);
    setError("");
    setPagos(null);
    const { data, error } = await supabase
      .from("pagos")
      .select("metodo, total, propina, descuento, cuentas(consumo)")
      .gte("fecha", inicioDeHoy());
    if (error) return setError(error.message);
    setPagos((data ?? []) as unknown as Pago[]);
  }

  const r = useMemo(() => {
    const res = { cuentas: 0, EFECTIVO: 0, TARJETA: 0, TRANSFERENCIA: 0, propinas: 0, descuentos: 0, cortesias: 0, consumoCortesias: 0, total: 0 };
    (pagos ?? []).forEach((p) => {
      res.descuentos += Number(p.descuento ?? 0);
      if (p.metodo === "CORTESIA" || p.metodo === "PREFERENTE") {
        res.cortesias += 1;
        res.consumoCortesias += Number(p.cuentas?.consumo ?? p.descuento ?? 0);
        return;
      }
      res.cuentas += 1;
      if (p.metodo === "EFECTIVO" || p.metodo === "TARJETA" || p.metodo === "TRANSFERENCIA") res[p.metodo] += Number(p.total);
      res.propinas += Number(p.propina ?? 0);
      res.total += Number(p.total);
    });
    return res;
  }, [pagos]);

  const renglones: [string, string][] = [
    ["Cuentas cobradas", String(r.cuentas)],
    ["Efectivo", dinero(r.EFECTIVO)],
    ["Tarjeta", dinero(r.TARJETA)],
    ["Transferencia", dinero(r.TRANSFERENCIA)],
    ["", ""],
    ["Propinas en tarjeta", dinero(r.propinas)],
    ["Descuentos dados", dinero(r.descuentos)],
    ["Cortesias", `${r.cortesias} (${dinero(r.consumoCortesias)})`],
  ];

  async function imprimirCorte() {
    setImprimiendo(true);
    setError("");
    try {
      const hora = new Date().toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hour12: true });
      await imprimir("caja", ticketCorte({ fecha: hoyMX(), hora, renglones, total: dinero(r.total) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo imprimir. Conecta la impresora de caja.");
    }
    setImprimiendo(false);
  }

  return (
    <>
      <button onClick={abrir} className="rounded-xl border-2 border-cafe px-5 py-3 font-semibold text-cafe hover:bg-crema">
        Corte de caja
      </button>

      {abierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAbierto(false)}>
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div>
              <h2 className="font-display text-2xl font-extrabold">Corte de caja</h2>
              <p className="text-sm text-cafe-medio">Hoy, {hoyMX()}</p>
            </div>
            {!pagos && !error && <p className="text-cafe-medio">Calculando…</p>}
            {pagos && (
              <>
                <dl className="divide-y divide-borde/70 text-sm">
                  {renglones
                    .filter(([a]) => a)
                    .map(([a, b]) => (
                      <div key={a} className="flex justify-between py-1.5">
                        <dt>{a}</dt>
                        <dd className="font-semibold tabular-nums">{b}</dd>
                      </div>
                    ))}
                </dl>
                <div className="flex items-baseline justify-between rounded-xl bg-crema px-4 py-3">
                  <span className="font-semibold">Total cobrado</span>
                  <span className="font-display text-3xl font-extrabold tabular-nums">{dinero(r.total)}</span>
                </div>
                <p className="text-xs text-cafe-medio">El total no incluye propinas. Las cortesías no suman.</p>
              </>
            )}
            {error && <p className="rounded-xl bg-paliacate-claro px-3 py-2 text-sm text-paliacate-oscuro">{error}</p>}
            <div className="flex gap-2">
              <button
                disabled={!pagos || imprimiendo}
                onClick={imprimirCorte}
                className="flex-1 rounded-xl bg-paliacate py-3 font-semibold text-white hover:bg-paliacate-oscuro disabled:opacity-40"
              >
                {imprimiendo ? "Imprimiendo…" : "Imprimir corte"}
              </button>
              <button onClick={() => setAbierto(false)} className="rounded-xl border border-borde px-5 font-semibold">
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
