"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { dinero, errorTexto } from "@/lib/formato";
import { imprimir, ticketCorte } from "@/lib/impresoraBT";

type Movimiento = { tipo: "ENTRADA" | "SALIDA"; monto: number; motivo: string; hora: string };
type Cierre = {
  ventas_efectivo: number;
  entradas: number;
  salidas: number;
  esperado: number;
  contado: number;
  diferencia: number;
  fondo?: number;
};
export type EstadoCaja = {
  estado: "SIN_ABRIR" | "ABIERTA" | "CERRADA";
  fondo?: number;
  movimientos?: Movimiento[];
  cierre?: Cierre | null;
};

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hour12: true });

/**
 * Control del efectivo del día: apertura con fondo, entradas/salidas (gastos pagados
 * con la caja) y cierre contando el efectivo. El cajero no ve lo "esperado" hasta
 * que escribe lo que contó.
 */
export default function ControlCaja({ onCambio }: { onCambio: (e: EstadoCaja | null) => void }) {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [estado, setEstado] = useState<EstadoCaja | null>(null);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [fondo, setFondo] = useState("");
  const [ventana, setVentana] = useState<"movimiento" | "cierre" | null>(null);
  const [tipo, setTipo] = useState<"SALIDA" | "ENTRADA">("SALIDA");
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [contado, setContado] = useState("");
  const [notas, setNotas] = useState("");
  const [resultado, setResultado] = useState<Cierre | null>(null);

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.rpc("estado_caja");
    if (error) {
      setError(errorTexto(error));
      onCambio(null);
      return;
    }
    setEstado(data as EstadoCaja);
    onCambio(data as EstadoCaja);
  }, [supabase, onCambio]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function correr(fn: () => PromiseLike<{ error: unknown; data?: unknown }>) {
    setOcupado(true);
    setError("");
    const { error, data } = await fn();
    setOcupado(false);
    if (error) {
      setError(errorTexto(error));
      return null;
    }
    await cargar();
    return data ?? true;
  }

  async function abrir() {
    if (fondo === "" || Number(fondo) < 0) return setError("Escribe con cuánto efectivo empieza la caja.");
    if (await correr(() => supabase.rpc("abrir_caja", { p_fondo: Number(fondo) }))) setFondo("");
  }

  async function guardarMovimiento() {
    const ok = await correr(() =>
      supabase.rpc("registrar_movimiento_caja", { p_tipo: tipo, p_monto: Number(monto), p_motivo: motivo })
    );
    if (ok) {
      setMonto("");
      setMotivo("");
    }
  }

  async function cerrar() {
    if (contado === "") return setError("Escribe cuánto efectivo contaste.");
    if (!window.confirm(`¿Cerrar la caja con ${dinero(Number(contado))} contados? Ya no se podrá cobrar en efectivo hoy.`)) return;
    const data = await correr(() => supabase.rpc("cerrar_caja", { p_contado: Number(contado), p_notas: notas }));
    if (data && data !== true) {
      setResultado(data as Cierre);
      setContado("");
      setNotas("");
    }
  }

  async function imprimirCierre(c: Cierre) {
    setError("");
    try {
      const ahora = new Date();
      await imprimir(
        "caja",
        ticketCorte({
          titulo: "CIERRE DE CAJA",
          fecha: ahora.toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" }),
          hora: hora(ahora.toISOString()),
          renglones: [
            ["Fondo inicial", dinero(Number(c.fondo ?? estado?.fondo ?? 0))],
            ["Ventas en efectivo", dinero(Number(c.ventas_efectivo))],
            ["Entradas", dinero(Number(c.entradas))],
            ["Salidas", `-${dinero(Number(c.salidas))}`],
            ["", ""],
            ["Efectivo esperado", dinero(Number(c.esperado))],
            ["Efectivo contado", dinero(Number(c.contado))],
          ],
          etiquetaTotal: Number(c.diferencia) < 0 ? "FALTA" : "SOBRA",
          total: dinero(Math.abs(Number(c.diferencia))),
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo imprimir. Conecta la impresora de caja.");
    }
  }

  if (!estado) return error ? <p className="text-sm text-paliacate">{error}</p> : null;

  const campo = "w-full rounded-xl border border-borde bg-white px-3 py-2.5 focus:border-cafe focus:outline-none";
  const movs = estado.movimientos ?? [];

  // ----- Caja sin abrir: hay que registrar el fondo antes de cobrar en efectivo -----
  if (estado.estado === "SIN_ABRIR") {
    return (
      <div className="w-full space-y-3 rounded-2xl border-2 border-paliacate bg-white p-5">
        <div>
          <h2 className="font-display text-2xl font-extrabold">Abrir caja</h2>
          <p className="text-sm text-cafe-medio">
            Cuenta el efectivo con el que empiezas el día (el cambio). Sin abrir la caja no se puede cobrar en efectivo.
          </p>
        </div>
        <div className="flex max-w-sm gap-2">
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-cafe-medio">$</span>
            <input
              type="number"
              inputMode="decimal"
              value={fondo}
              onChange={(e) => setFondo(e.target.value)}
              placeholder="0.00"
              className={`${campo} pl-8 font-display text-2xl font-bold`}
            />
          </div>
          <button
            disabled={ocupado || fondo === ""}
            onClick={abrir}
            className="rounded-xl bg-paliacate px-6 font-semibold text-white hover:bg-paliacate-oscuro disabled:opacity-40"
          >
            Abrir caja
          </button>
        </div>
        {error && <p className="text-sm text-paliacate">{error}</p>}
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-borde bg-white px-4 py-3">
        <span className="mr-2">
          <strong className={estado.estado === "ABIERTA" ? "text-hoja" : "text-cafe-medio"}>
            {estado.estado === "ABIERTA" ? "● Caja abierta" : "Caja cerrada"}
          </strong>
          <span className="block text-xs text-cafe-medio">Fondo inicial {dinero(Number(estado.fondo ?? 0))}</span>
        </span>
        {estado.estado === "ABIERTA" ? (
          <>
            <button onClick={() => setVentana("movimiento")} className="rounded-xl border border-borde px-4 py-2 text-sm font-semibold hover:border-cafe-medio">
              Entrada / Salida
            </button>
            <button onClick={() => setVentana("cierre")} className="rounded-xl bg-cafe px-4 py-2 text-sm font-semibold text-crema hover:bg-cafe/90">
              Cerrar caja
            </button>
          </>
        ) : (
          estado.cierre && (
            <button
              onClick={() => {
                setResultado({ ...estado.cierre!, fondo: estado.fondo });
                setVentana("cierre");
              }}
              className="rounded-xl border border-borde px-4 py-2 text-sm font-semibold hover:border-cafe-medio"
            >
              Ver cierre
            </button>
          )
        )}
      </div>

      {ventana && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            setVentana(null);
            setResultado(null);
            setError("");
          }}
        >
          <div className="max-h-[90vh] w-full max-w-sm space-y-4 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
            {ventana === "movimiento" ? (
              <>
                <div>
                  <h2 className="font-display text-2xl font-extrabold">Entrada / Salida</h2>
                  <p className="text-sm text-cafe-medio">Efectivo que entra o sale de la caja y no es venta.</p>
                </div>
                <div className="grid grid-cols-2 gap-1 rounded-xl bg-crema-oscuro p-1">
                  {(["SALIDA", "ENTRADA"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTipo(t)}
                      className={`rounded-lg py-2.5 text-sm font-semibold ${tipo === t ? "bg-white text-cafe shadow-sm" : "text-cafe-medio"}`}
                    >
                      {t === "SALIDA" ? "Salida (gasto, retiro)" : "Entrada (cambio extra)"}
                    </button>
                  ))}
                </div>
                <input type="number" inputMode="decimal" placeholder="Monto $" value={monto} onChange={(e) => setMonto(e.target.value)} className={`${campo} font-display text-xl font-bold`} />
                <input placeholder="Motivo (ej. tortillas, hielo, retiro)" value={motivo} onChange={(e) => setMotivo(e.target.value)} className={campo} />
                <button
                  disabled={ocupado || !(Number(monto) > 0) || !motivo.trim()}
                  onClick={guardarMovimiento}
                  className="w-full rounded-xl bg-paliacate py-3 font-semibold text-white hover:bg-paliacate-oscuro disabled:opacity-40"
                >
                  Registrar {tipo === "SALIDA" ? "salida" : "entrada"}
                </button>
                {movs.length > 0 && (
                  <ul className="divide-y divide-borde/70 rounded-xl border border-borde text-sm">
                    {movs.map((m, i) => (
                      <li key={i} className="flex justify-between gap-2 px-3 py-2">
                        <span>
                          <span className="text-xs text-cafe-medio">{hora(m.hora)}</span> {m.motivo}
                        </span>
                        <strong className={m.tipo === "SALIDA" ? "text-paliacate" : "text-hoja"}>
                          {m.tipo === "SALIDA" ? "−" : "+"}
                          {dinero(Number(m.monto))}
                        </strong>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : resultado ? (
              <>
                <h2 className="font-display text-2xl font-extrabold">Caja cerrada</h2>
                <dl className="divide-y divide-borde/70 text-sm">
                  {[
                    ["Fondo inicial", dinero(Number(resultado.fondo ?? estado.fondo ?? 0))],
                    ["Ventas en efectivo", dinero(Number(resultado.ventas_efectivo))],
                    ["Entradas", `+${dinero(Number(resultado.entradas))}`],
                    ["Salidas", `−${dinero(Number(resultado.salidas))}`],
                    ["Efectivo esperado", dinero(Number(resultado.esperado))],
                    ["Efectivo contado", dinero(Number(resultado.contado))],
                  ].map(([a, b]) => (
                    <div key={a} className="flex justify-between py-1.5">
                      <dt>{a}</dt>
                      <dd className="font-semibold tabular-nums">{b}</dd>
                    </div>
                  ))}
                </dl>
                <div
                  className={`rounded-xl px-4 py-3 text-center font-display text-2xl font-extrabold ${
                    Number(resultado.diferencia) === 0 ? "bg-hoja-claro text-hoja" : Number(resultado.diferencia) < 0 ? "bg-paliacate-claro text-paliacate-oscuro" : "bg-queso-claro"
                  }`}
                >
                  {Number(resultado.diferencia) === 0
                    ? "Cuadra exacto"
                    : Number(resultado.diferencia) < 0
                    ? `Faltan ${dinero(Math.abs(Number(resultado.diferencia)))}`
                    : `Sobran ${dinero(Number(resultado.diferencia))}`}
                </div>
                <button onClick={() => imprimirCierre(resultado)} className="w-full rounded-xl bg-paliacate py-3 font-semibold text-white hover:bg-paliacate-oscuro">
                  Imprimir cierre
                </button>
              </>
            ) : (
              <>
                <div>
                  <h2 className="font-display text-2xl font-extrabold">Cerrar caja</h2>
                  <p className="text-sm text-cafe-medio">
                    Cuenta todo el efectivo de la caja (incluido el fondo) y escribe el total. Después de cerrar ya no se puede cobrar en efectivo hoy.
                  </p>
                </div>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-cafe-medio">$</span>
                  <input type="number" inputMode="decimal" placeholder="Efectivo contado" value={contado} onChange={(e) => setContado(e.target.value)} className={`${campo} pl-8 font-display text-2xl font-bold`} />
                </div>
                <input placeholder="Notas (opcional)" value={notas} onChange={(e) => setNotas(e.target.value)} className={campo} />
                <button
                  disabled={ocupado || contado === ""}
                  onClick={cerrar}
                  className="w-full rounded-xl bg-cafe py-3 font-semibold text-crema hover:bg-cafe/90 disabled:opacity-40"
                >
                  {ocupado ? "Cerrando…" : "Cerrar caja"}
                </button>
              </>
            )}
            {error && <p className="rounded-xl bg-paliacate-claro px-3 py-2 text-sm text-paliacate-oscuro">{error}</p>}
            <button
              onClick={() => {
                setVentana(null);
                setResultado(null);
                setError("");
              }}
              className="w-full rounded-xl border border-borde py-2.5 font-semibold"
            >
              Cerrar ventana
            </button>
          </div>
        </div>
      )}
    </>
  );
}
