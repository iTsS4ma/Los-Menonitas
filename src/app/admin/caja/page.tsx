"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { diaMX, dinero, errorTexto } from "@/lib/formato";
import { imprimir } from "@/lib/impresoraBT";
import { etiquetaDen, textoDiferencia, ticketCierreCaja } from "@/lib/ticketsCaja";

type Corte = {
  id: string;
  dia: string;
  fondo_inicial: number;
  abierto_por: string | null;
  abierto_en: string;
  cerrado_por: string | null;
  cerrado_en: string | null;
  ventas_efectivo: number | null;
  entradas: number | null;
  salidas: number | null;
  efectivo_esperado: number | null;
  efectivo_contado: number | null;
  diferencia: number | null;
  notas: string | null;
  desglose?: Record<string, number> | null;
  retiro?: number | null;
  tarjeta_terminal?: number | null;
  tarjeta_sistema?: number | null;
  tarjeta_diferencia?: number | null;
  transferencia_sistema?: number | null;
};
type Movimiento = { id: string; corte_id: string; tipo: string; monto: number; motivo: string; creado_en: string; creado_por: string | null };

const hora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hour12: true }) : "—";

// Historial del efectivo: fondo, ventas en efectivo, gastos, lo esperado y lo contado de cada día
export default function HistorialCaja() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [cortes, setCortes] = useState<Corte[]>([]);
  const [movs, setMovs] = useState<Movimiento[]>([]);
  const [nombres, setNombres] = useState<Map<string, string>>(new Map());
  const [abierto, setAbierto] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [avisoImpresion, setAvisoImpresion] = useState<{ id: string; texto: string; error: boolean } | null>(null);

  const cargar = useCallback(async () => {
    const [c, m, u] = await Promise.all([
      supabase.from("cortes_caja").select("*").order("dia", { ascending: false }).limit(90),
      supabase.from("movimientos_caja").select("*").order("creado_en"),
      supabase.from("usuarios").select("id, nombre"),
    ]);
    if (c.error) return setError(errorTexto(c.error));
    setCortes((c.data ?? []) as Corte[]);
    setMovs((m.data ?? []) as Movimiento[]);
    setNombres(new Map(((u.data ?? []) as { id: string; nombre: string }[]).map((x) => [x.id, x.nombre])));
  }, [supabase]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function reabrir() {
    if (!window.confirm("¿Reabrir la caja de hoy? Se borra el conteo del cierre y caja tendrá que volver a cerrarla.")) return;
    const { error } = await supabase.rpc("reabrir_caja");
    if (error) return setError(errorTexto(error));
    await cargar();
  }

  // Reimprime el cierre de un día por la impresora de caja de esta computadora
  async function reimprimirCierre(c: Corte) {
    setAvisoImpresion({ id: c.id, texto: "Imprimiendo…", error: false });
    try {
      await imprimir(
        "caja",
        ticketCierreCaja(
          {
            fondo: c.fondo_inicial, ventas_efectivo: c.ventas_efectivo, entradas: c.entradas, salidas: c.salidas,
            esperado: c.efectivo_esperado, contado: c.efectivo_contado, diferencia: c.diferencia, desglose: c.desglose,
            retiro: c.retiro, tarjeta_terminal: c.tarjeta_terminal, tarjeta_sistema: c.tarjeta_sistema,
            tarjeta_diferencia: c.tarjeta_diferencia, transferencia_sistema: c.transferencia_sistema,
          },
          c.dia,
          hora(c.cerrado_en)
        )
      );
      setAvisoImpresion({ id: c.id, texto: "Cierre reimpreso.", error: false });
    } catch (e) {
      setAvisoImpresion({
        id: c.id,
        texto: `${e instanceof Error ? e.message : "No se pudo imprimir"}. Conecta la impresora de caja en la pantalla de Caja.`,
        error: true,
      });
    }
  }

  const nombre = (id: string | null) => (id ? nombres.get(id) ?? "Usuario eliminado" : "—");
  const hoy = diaMX();
  const faltantes = cortes.filter((c) => Number(c.diferencia ?? 0) < 0).reduce((s, c) => s + Number(c.diferencia), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold">Caja</h1>
        <p className="text-sm text-cafe-medio">
          Cada día: con cuánto se abrió, lo que entró en efectivo, gastos y retiros, lo que debía haber y lo que se contó al
          cerrar. Toca un día para ver sus entradas y salidas.
        </p>
      </div>

      {error && <p className="rounded-xl bg-paliacate-claro px-4 py-3 text-sm text-paliacate-oscuro">{error}</p>}

      {faltantes < 0 && (
        <p className="rounded-xl bg-paliacate-claro px-4 py-3 text-sm text-paliacate-oscuro">
          Faltantes acumulados en los días listados: <strong>{dinero(Math.abs(faltantes))}</strong>
        </p>
      )}

      <div className="overflow-x-auto rounded-2xl border border-borde bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-borde bg-crema/60 text-xs font-semibold text-cafe-medio">
            <tr>
              <th className="px-4 py-3">Día</th>
              <th className="px-4 py-3">Abrió</th>
              <th className="px-4 py-3 text-right">Fondo</th>
              <th className="px-4 py-3 text-right">Ventas efectivo</th>
              <th className="px-4 py-3 text-right">Entradas − Salidas</th>
              <th className="px-4 py-3 text-right">Esperado</th>
              <th className="px-4 py-3 text-right">Contado</th>
              <th className="px-4 py-3 text-right">Diferencia</th>
              <th className="px-4 py-3 text-right">Tarjeta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borde/70">
            {cortes.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-10 text-center text-cafe-medio">
                  Todavía no se ha abierto ninguna caja.
                </td>
              </tr>
            )}
            {cortes.map((c) => {
              const cerrado = !!c.cerrado_en;
              const dif = Number(c.diferencia ?? 0);
              const deDia = movs.filter((m) => m.corte_id === c.id);
              const expandido = abierto === c.id;
              return (
                <Fragment key={c.id}>
                  <tr onClick={() => setAbierto(expandido ? null : c.id)} className="cursor-pointer hover:bg-crema/50">
                    <td className="whitespace-nowrap px-4 py-3 font-semibold">
                      <span className="mr-1.5 inline-block w-3">{expandido ? "▾" : "▸"}</span>
                      {c.dia}
                    </td>
                    <td className="px-4 py-3">
                      {nombre(c.abierto_por)} <span className="text-xs text-cafe-medio">{hora(c.abierto_en)}</span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{dinero(Number(c.fondo_inicial))}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{cerrado ? dinero(Number(c.ventas_efectivo)) : "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {cerrado ? `${dinero(Number(c.entradas))} − ${dinero(Number(c.salidas))}` : `${deDia.length} mov.`}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{cerrado ? dinero(Number(c.efectivo_esperado)) : "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{cerrado ? dinero(Number(c.efectivo_contado)) : "—"}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-display font-bold tabular-nums">
                      {!cerrado ? (
                        <span className="text-cafe-medio">{c.dia === hoy ? "Abierta" : "Sin cerrar"}</span>
                      ) : dif === 0 ? (
                        <span className="text-hoja">Cuadra</span>
                      ) : (
                        <span className={dif < 0 ? "text-paliacate" : "text-cafe"}>
                          {dif < 0 ? "Faltan " : "Sobran "}
                          {dinero(Math.abs(dif))}
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-display font-bold tabular-nums">
                      {!cerrado || c.tarjeta_diferencia == null ? (
                        <span className="text-cafe-medio">—</span>
                      ) : (
                        <span className={Number(c.tarjeta_diferencia) === 0 ? "text-hoja" : "text-paliacate"}>
                          {textoDiferencia(Number(c.tarjeta_diferencia))}
                        </span>
                      )}
                    </td>
                  </tr>
                  {expandido && (
                    <tr className="bg-crema/40">
                      <td colSpan={9} className="space-y-2 px-4 pb-4 pt-1">
                        {deDia.length === 0 ? (
                          <p className="text-sm text-cafe-medio">Sin entradas ni salidas.</p>
                        ) : (
                          <ul className="divide-y divide-borde/60 rounded-xl border border-borde bg-white">
                            {deDia.map((m) => (
                              <li key={m.id} className="flex justify-between gap-3 px-4 py-2">
                                <span>
                                  <span className="text-xs text-cafe-medio">{hora(m.creado_en)}</span> {m.motivo}{" "}
                                  <span className="text-xs text-cafe-medio">· {nombre(m.creado_por)}</span>
                                </span>
                                <strong className={m.tipo === "SALIDA" ? "text-paliacate" : "text-hoja"}>
                                  {m.tipo === "SALIDA" ? "−" : "+"}
                                  {dinero(Number(m.monto))}
                                </strong>
                              </li>
                            ))}
                          </ul>
                        )}
                        {cerrado && (
                          <div className="grid gap-2 rounded-xl border border-borde bg-white px-4 py-3 text-sm sm:grid-cols-2">
                            <div>
                              {c.retiro != null && (
                                <p>
                                  Retiro al cerrar: <strong>{dinero(Number(c.retiro))}</strong> (se dejan $1,000)
                                </p>
                              )}
                              {c.tarjeta_sistema != null && (
                                <p>
                                  Tarjeta: sistema {dinero(Number(c.tarjeta_sistema))} · terminal {dinero(Number(c.tarjeta_terminal))}
                                </p>
                              )}
                              {c.transferencia_sistema != null && <p>Transferencias: {dinero(Number(c.transferencia_sistema))}</p>}
                            </div>
                            {c.desglose && Object.keys(c.desglose).length > 0 && (
                              <p className="text-cafe-medio">
                                Conteo:{" "}
                                {Object.entries(c.desglose)
                                  .sort((a, b) => Number(b[0]) - Number(a[0]))
                                  .map(([d, n]) => `${n} × ${etiquetaDen(Number(d))}`)
                                  .join(" · ")}
                              </p>
                            )}
                          </div>
                        )}
                        <p className="text-xs text-cafe-medio">
                          {cerrado ? `Cerró ${nombre(c.cerrado_por)} a las ${hora(c.cerrado_en)}.` : "Todavía no se cierra."}
                          {c.notas ? ` Notas: ${c.notas}` : ""}
                        </p>
                        {cerrado && (
                          <div className="flex flex-wrap items-center gap-3">
                            <button
                              onClick={() => reimprimirCierre(c)}
                              className="rounded-lg border border-cafe px-3 py-1.5 text-sm font-semibold hover:bg-crema"
                            >
                              Reimprimir cierre
                            </button>
                            {avisoImpresion?.id === c.id && (
                              <span className={`text-sm ${avisoImpresion.error ? "text-paliacate" : "text-hoja"}`}>{avisoImpresion.texto}</span>
                            )}
                          </div>
                        )}
                        {cerrado && c.dia === hoy && (
                          <button onClick={reabrir} className="rounded-lg border border-paliacate/40 px-3 py-1.5 text-sm font-semibold text-paliacate hover:bg-paliacate-claro">
                            Reabrir caja de hoy
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
