"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Conexion from "@/components/Conexion";
import BotonImpresora from "@/components/BotonImpresora";
import { useTiempoReal } from "@/hooks/useTiempoReal";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { errorTexto, nombreCuenta } from "@/lib/formato";
import { escucharImpresoras, imprimir, ticketCancelacion, ticketComandaEstacion, type EstadoImpresoras } from "@/lib/impresoraBT";
import { DESTINO_ESTACION, NOMBRE_ESTACION, platosEstacion } from "@/lib/comandas";
import type { Comanda, Cuenta, Estacion, Pedido } from "@/lib/tipos";

type PedidoCocina = Pedido & { creado_por: string | null; cuentas: Omit<Cuenta, "pedidos"> };
type Filtro = "TODO" | Estacion;
const ESTACIONES: Estacion[] = ["COCINA", "GARNACHAS"];
const HORAS_ATRAS = 12;
// Prioridad: manda el tiempo de espera. Una orden chica (2 piezas o menos) cuenta como si
// llevara VENTAJA_RAPIDA minutos más, y se marca "Rápida" solo cuando ya esperó MIN_RAPIDA.
const VENTAJA_RAPIDA = 4;
const MIN_RAPIDA = 3;

const hora = (iso: string) =>
  new Date(iso).toLocaleTimeString("es-MX", { timeZone: "America/Mexico_City", hour: "2-digit", minute: "2-digit", hour12: true });

// Pitido corto con el altavoz (no necesita archivos de audio)
function pitido(ctx: AudioContext | null, frecuencia = 880, veces = 1) {
  if (!ctx) return;
  for (let i = 0; i < veces; i++) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = frecuencia;
    o.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime + i * 0.35;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.start(t);
    o.stop(t + 0.27);
  }
}

/**
 * Estación de cocina: la única computadora o tablet conectada a las impresoras
 * de Cocina y Garnachas. Imprime sola cada comanda que mandan los meseros (si la
 * impresora se cae, la guarda y la imprime al reconectar) y muestra las órdenes
 * por estación para marcarlas como listas.
 */
export default function VistaCocina() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [comandas, setComandas] = useState<Comanda[]>([]);
  const [pedidos, setPedidos] = useState<Map<string, PedidoCocina>>(new Map());
  const [nombres, setNombres] = useState<Map<string, string>>(new Map());
  const [aviso, setAviso] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("TODO");
  const [ahora, setAhora] = useState(() => Date.now());
  const [impresoras, setImpresoras] = useState<Record<Estacion, EstadoImpresoras | null>>({ COCINA: null, GARNACHAS: null });
  const [fallas, setFallas] = useState<Record<Estacion, string>>({ COCINA: "", GARNACHAS: "" });
  const [sonido, setSonido] = useState<AudioContext | null>(null);
  const [verListas, setVerListas] = useState(false);
  const imprimiendo = useRef(false);
  // Desde cuándo está pendiente cada comanda / desconectada cada impresora (margen antes de la alarma)
  const pendienteDesde = useRef(new Map<string, number>());
  const caidaDesde = useRef<Record<Estacion, number | null>>({ COCINA: null, GARNACHAS: null });
  const MARGEN_MS = 20000;
  const conocidas = useRef<Set<string> | null>(null);

  const cargar = useCallback(async () => {
    const desde = new Date(Date.now() - HORAS_ATRAS * 3600_000).toISOString();
    const c = await supabase.from("comandas").select("*").gte("creada_en", desde).order("creada_en");
    if (c.error) return setAviso(errorTexto(c.error));
    const lista = (c.data ?? []) as Comanda[];
    const ids = [...new Set(lista.map((x) => x.pedido_id))];
    const [p, u] = await Promise.all([
      ids.length
        ? supabase
            .from("pedidos")
            .select("*, detalle_pedido(*, productos(descripcion)), cuentas(tipo, nombre_cliente, numero_orden, mesa_id, mesas(numero))")
            .in("id", ids)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("usuarios").select("id, nombre"),
    ]);
    if (p.error) return setAviso(errorTexto(p.error));
    setAviso("");
    setPedidos(new Map(((p.data ?? []) as PedidoCocina[]).map((x) => [x.id, x])));
    setNombres(new Map(((u.data ?? []) as { id: string; nombre: string }[]).map((x) => [x.id, x.nombre])));
    setComandas(lista);
  }, [supabase]);

  const conectado = useTiempoReal("cocina", ["comandas", "pedidos", "detalle_pedido"], cargar);

  // Reloj para los tiempos de espera y reintentos de impresión
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  // Estado de las impresoras (para la alarma)
  useEffect(() => {
    const a = escucharImpresoras("cocina", (e) => setImpresoras((x) => ({ ...x, COCINA: e })));
    const b = escucharImpresoras("garnachas", (e) => setImpresoras((x) => ({ ...x, GARNACHAS: e })));
    return () => {
      a();
      b();
    };
  }, []);

  // Pantalla siempre encendida (si el navegador lo permite)
  useEffect(() => {
    let bloqueo: { release: () => Promise<void> } | null = null;
    const pedir = async () => {
      try {
        bloqueo = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof bloqueo> } }).wakeLock?.request("screen") ?? null;
      } catch {}
    };
    pedir();
    const alVolver = () => document.visibilityState === "visible" && pedir();
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      document.removeEventListener("visibilitychange", alVolver);
      bloqueo?.release().catch(() => {});
    };
  }, []);

  // Filtro guardado en este equipo (por si la tablet es solo de una estación)
  useEffect(() => {
    const f = localStorage.getItem("cocina_filtro") as Filtro | null;
    if (f) setFiltro(f);
  }, []);
  const cambiarFiltro = (f: Filtro) => {
    setFiltro(f);
    localStorage.setItem("cocina_filtro", f);
  };

  const mesero = (p: PedidoCocina) => (p.creado_por ? nombres.get(p.creado_por) : undefined);

  // ---------- Impresión automática con cola ----------
  const pendientes = useMemo(
    () => comandas.filter((c) => !c.impresa_en && pedidos.has(c.pedido_id)).sort((a, b) => a.creada_en.localeCompare(b.creada_en)),
    [comandas, pedidos]
  );

  const bytesDe = useCallback(
    (c: Comanda) => {
      const p = pedidos.get(c.pedido_id)!;
      const cuenta = nombreCuenta(p.cuentas);
      if (c.tipo === "CANCELACION") {
        return ticketCancelacion({
          estacion: NOMBRE_ESTACION[c.estacion],
          cuenta,
          ronda: p.numero_ronda,
          hora: hora(c.creada_en),
          motivo: c.motivo || "Sin motivo",
          renglones: (c.renglones ?? []).map((texto) => ({ texto })),
        });
      }
      const { platos } = platosEstacion(p, c.estacion);
      if (platos.length === 0) return null; // todo se canceló: no hay nada que imprimir
      return ticketComandaEstacion({
        estacion: NOMBRE_ESTACION[c.estacion],
        cuenta,
        ronda: p.numero_ronda,
        hora: hora(c.creada_en),
        mesero: mesero(p),
        platos,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pedidos, nombres]
  );

  useEffect(() => {
    if (imprimiendo.current || pendientes.length === 0) return;
    const fallidasAhora = new Set<Estacion>();
    (async () => {
      imprimiendo.current = true;
      try {
        for (const c of pendientes) {
          if (fallidasAhora.has(c.estacion)) continue;
          const destino = DESTINO_ESTACION[c.estacion];
          if (!impresoras[c.estacion]?.impresoras.length) continue; // sin impresora configurada aquí
          const bytes = bytesDe(c);
          try {
            if (bytes) await imprimir(destino, bytes);
            await supabase.from("comandas").update({ impresa_en: new Date().toISOString() }).eq("id", c.id);
            setComandas((lista) => lista.map((x) => (x.id === c.id ? { ...x, impresa_en: new Date().toISOString() } : x)));
            setFallas((f) => ({ ...f, [c.estacion]: "" }));
          } catch (e) {
            fallidasAhora.add(c.estacion);
            setFallas((f) => ({ ...f, [c.estacion]: e instanceof Error ? e.message : "No se pudo imprimir" }));
          }
        }
      } finally {
        imprimiendo.current = false;
      }
    })();
    // `ahora` cambia cada 5 s: así se reintenta sola
  }, [pendientes, impresoras, bytesDe, supabase, ahora]);

  // ---------- Alarma: impresora caída o comandas sin imprimir ----------
  // Se calcula en un efecto (usa la hora y los márgenes guardados)
  const [problemas, setProblemas] = useState<string[]>([]);
  useEffect(() => {
    const t = Date.now();
    const vistas = new Set(pendientes.map((c) => c.id));
    pendientes.forEach((c) => !pendienteDesde.current.has(c.id) && pendienteDesde.current.set(c.id, t));
    [...pendienteDesde.current.keys()].forEach((id) => !vistas.has(id) && pendienteDesde.current.delete(id));
    const lista = ESTACIONES.flatMap((e) => {
      const imp = impresoras[e];
      const sinImprimir = pendientes.filter((c) => c.estacion === e && t - (pendienteDesde.current.get(c.id) ?? t) > MARGEN_MS).length;
      const caida = !!imp?.impresoras.length && !imp.enLinea && !imp.imprimiendo;
      if (caida && caidaDesde.current[e] == null) caidaDesde.current[e] = t;
      if (!caida) caidaDesde.current[e] = null;
      const msgs: string[] = [];
      if (!imp?.impresoras.length) msgs.push(`${NOMBRE_ESTACION[e]}: no hay impresora conectada en este equipo`);
      else if (caida && t - (caidaDesde.current[e] ?? t) > MARGEN_MS) msgs.push(`${NOMBRE_ESTACION[e]}: se perdió la conexión con la impresora`);
      if (sinImprimir)
        msgs.push(`${NOMBRE_ESTACION[e]}: ${sinImprimir} ${sinImprimir === 1 ? "comanda" : "comandas"} sin imprimir${fallas[e] ? ` (${fallas[e]})` : ""}`);
      return msgs;
    });
    setProblemas((prev) => (prev.join("|") === lista.join("|") ? prev : lista));
  }, [pendientes, impresoras, fallas, ahora]);
  const hayProblema = problemas.length > 0;

  useEffect(() => {
    if (!hayProblema || !sonido) return;
    pitido(sonido, 440, 3);
    const t = setInterval(() => pitido(sonido, 440, 3), 10000);
    return () => clearInterval(t);
  }, [hayProblema, sonido]);

  // Pitido suave al llegar una comanda nueva
  useEffect(() => {
    const ids = new Set(comandas.map((c) => c.id));
    if (conocidas.current && [...ids].some((id) => !conocidas.current!.has(id))) pitido(sonido, 988, 2);
    conocidas.current = ids;
  }, [comandas, sonido]);

  function activarSonido() {
    const ctx = new AudioContext();
    pitido(ctx, 988, 1);
    setSonido(ctx);
  }

  // ---------- Órdenes por estación ----------
  const ordenes = useMemo(() => {
    return comandas
      .filter((c) => c.tipo === "PEDIDO" && (filtro === "TODO" || c.estacion === filtro))
      .map((c) => ({ c, p: pedidos.get(c.pedido_id) }))
      .filter((x): x is { c: Comanda; p: PedidoCocina } => !!x.p && x.p.estado !== "CANCELADO")
      .map((x) => ({ ...x, ...platosEstacion(x.p, x.c.estacion) }))
      .filter((x) => x.platos.length > 0);
  }, [comandas, pedidos, filtro]);

  // Orden de trabajo: la que más tiempo lleva esperando primero; las chicas con algo de ventaja
  const enEspera = ordenes
    .filter((o) => !o.c.lista_en)
    .map((o) => {
      const min = (ahora - new Date(o.c.creada_en).getTime()) / 60000;
      return { ...o, min, prioridad: min + (o.rapida ? VENTAJA_RAPIDA : 0) };
    })
    .sort((a, b) => b.prioridad - a.prioridad || a.c.creada_en.localeCompare(b.c.creada_en));
  const listas = ordenes.filter((o) => o.c.lista_en).sort((a, b) => (b.c.lista_en ?? "").localeCompare(a.c.lista_en ?? "")).slice(0, 12);

  // Lo que falta por preparar, sumado (para cocinar por tanda)
  const resumen = useMemo(() => {
    const porEstacion = new Map<Estacion, Map<string, number>>();
    enEspera.forEach((o) => {
      const m = porEstacion.get(o.c.estacion) ?? new Map<string, number>();
      o.platos.forEach((pl) =>
        pl.renglones.forEach((r) => {
          if (r.piezas >= 99) return; // por kilo: no se suma en piezas
          m.set(r.resumen, (m.get(r.resumen) ?? 0) + r.piezas);
        })
      );
      porEstacion.set(o.c.estacion, m);
    });
    return porEstacion;
  }, [enEspera]);

  const cancelacionesRecientes = comandas
    .filter((c) => c.tipo === "CANCELACION" && (filtro === "TODO" || c.estacion === filtro) && ahora - new Date(c.creada_en).getTime() < 20 * 60_000)
    .reverse();

  async function marcarLista(c: Comanda, lista: boolean) {
    setComandas((l) => l.map((x) => (x.id === c.id ? { ...x, lista_en: lista ? new Date().toISOString() : null } : x)));
    const { error } = await supabase.from("comandas").update({ lista_en: lista ? new Date().toISOString() : null }).eq("id", c.id);
    if (error) setAviso(errorTexto(error));
  }

  async function reimprimir(c: Comanda) {
    const { error } = await supabase.from("comandas").update({ impresa_en: null }).eq("id", c.id);
    if (error) return setAviso(errorTexto(error));
    setComandas((l) => l.map((x) => (x.id === c.id ? { ...x, impresa_en: null } : x)));
  }

  return (
    <main className="mx-auto w-full max-w-7xl space-y-4 px-3 pb-10 pt-3">
      <Conexion conectado={conectado} />

      {!sonido && (
        <button onClick={activarSonido} className="w-full rounded-2xl bg-queso py-4 text-lg font-bold text-cafe shadow-sm">
          🔔 Toca aquí para activar el sonido de alertas
        </button>
      )}

      {hayProblema && (
        <div className="animate-pulse rounded-2xl border-4 border-paliacate bg-paliacate px-4 py-3 text-white">
          <p className="font-display text-xl font-extrabold">¡Atención con las impresoras!</p>
          <ul className="mt-1 list-disc pl-5 text-sm font-semibold">
            {problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-1 text-sm">Las órdenes siguen apareciendo aquí abajo. Se imprimen solas al volver la conexión.</p>
        </div>
      )}

      {aviso && <p className="rounded-xl bg-paliacate-claro px-3 py-2.5 text-sm text-paliacate-oscuro">{aviso}</p>}

      <div className="grid gap-2 md:grid-cols-2">
        <BotonImpresora destino="cocina" vigilar />
        <BotonImpresora destino="garnachas" vigilar />
      </div>

      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-crema-oscuro p-1">
        {(["TODO", "COCINA", "GARNACHAS"] as Filtro[]).map((f) => (
          <button
            key={f}
            onClick={() => cambiarFiltro(f)}
            className={`rounded-xl py-3 font-semibold ${filtro === f ? "bg-white text-cafe shadow-sm" : "text-cafe-medio"}`}
          >
            {f === "TODO" ? "Todo" : NOMBRE_ESTACION[f]} ({ordenes.filter((o) => !o.c.lista_en && (f === "TODO" || o.c.estacion === f)).length})
          </button>
        ))}
      </div>

      {[...resumen.entries()].map(([e, m]) =>
        m.size ? (
          <div key={e} className="flex flex-wrap items-center gap-2 rounded-2xl border border-borde bg-white px-4 py-3">
            <strong className="mr-1 font-display">Por preparar · {NOMBRE_ESTACION[e]}:</strong>
            {[...m.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([nombre, n]) => (
                <span key={nombre} className="rounded-full bg-crema-oscuro px-3 py-1 text-sm font-semibold">
                  {nombre} <span className="text-paliacate">{n}</span>
                </span>
              ))}
          </div>
        ) : null
      )}

      {cancelacionesRecientes.length > 0 && (
        <div className="space-y-1.5 rounded-2xl border-2 border-paliacate bg-paliacate-claro px-4 py-3">
          <strong className="font-display text-paliacate-oscuro">Cancelado (últimos 20 min)</strong>
          {cancelacionesRecientes.map((c) => {
            const p = pedidos.get(c.pedido_id);
            return (
              <p key={c.id} className="text-sm">
                <strong>{p ? `${nombreCuenta(p.cuentas)} · Ronda ${p.numero_ronda}` : ""}</strong> · {NOMBRE_ESTACION[c.estacion]}:{" "}
                <span className="line-through">{(c.renglones ?? []).join(", ")}</span>
                {c.motivo ? <em className="text-cafe-medio"> ({c.motivo})</em> : null}
              </p>
            );
          })}
        </div>
      )}

      {enEspera.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-borde px-4 py-16 text-center text-lg text-cafe-medio">
          No hay órdenes pendientes.
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {enEspera.map(({ c, p, platos, rapida, min: minExacto }, idx) => {
            const min = Math.floor(minExacto);
            const color = min >= 10 ? "border-paliacate bg-paliacate-claro" : min >= 5 ? "border-queso bg-queso-claro" : "border-borde bg-white";
            return (
              <article key={c.id} className={`flex flex-col rounded-2xl border-2 p-4 ${color}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-display text-2xl font-extrabold leading-tight">{nombreCuenta(p.cuentas)}</h3>
                    <p className="text-sm text-cafe-medio">
                      Ronda {p.numero_ronda} · {hora(c.creada_en)}
                      {mesero(p) ? ` · ${mesero(p)}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className={`font-display text-2xl font-bold tabular-nums ${min >= 10 ? "text-paliacate" : ""}`}>{min} min</span>
                    {filtro === "TODO" && (
                      <span className="rounded-full bg-cafe px-2.5 py-0.5 text-xs font-bold text-crema">{NOMBRE_ESTACION[c.estacion]}</span>
                    )}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-full bg-cafe px-3 py-1 text-sm font-extrabold text-crema">#{idx + 1}</span>
                  {rapida && min >= MIN_RAPIDA && <span className="rounded-full bg-hoja px-3 py-1 text-sm font-extrabold text-white">⚡ RÁPIDA</span>}
                  {!c.impresa_en && <span className="rounded-full bg-paliacate px-3 py-1 text-xs font-bold text-white">Sin imprimir</span>}
                </div>
                <div className="mt-3 flex-1 space-y-3">
                  {platos.map((pl) => (
                    <div key={pl.plato}>
                      {(platos.length > 1 || pl.plato > 1) && (
                        <p className="mb-1 border-b border-cafe/20 text-xs font-extrabold uppercase tracking-wider text-cafe-medio">Plato {pl.plato}</p>
                      )}
                      <ul className="space-y-1.5">
                        {pl.renglones.map((r, i) => (
                          <li key={i}>
                            <span className="text-lg font-bold leading-snug">{r.texto}</span>
                            {r.detalle && <span className="block text-sm text-cafe-medio">{r.detalle}</span>}
                            {(r.quesillo || (r.extras ?? []).length > 0) && (
                              <span className="mt-0.5 flex flex-wrap gap-1">
                                {r.quesillo && <span className="rounded bg-queso px-1.5 text-xs font-bold">+ QUESILLO</span>}
                                {(r.extras ?? []).map((x) => (
                                  <span key={x} className="rounded bg-cafe px-1.5 text-xs font-bold text-crema">{x}</span>
                                ))}
                              </span>
                            )}
                            {r.nota && <em className="block text-sm font-semibold text-paliacate-oscuro">* {r.nota}</em>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <div className="mt-4 flex gap-2">
                  <button onClick={() => reimprimir(c)} className="rounded-xl border border-borde bg-white px-3 text-sm font-semibold">
                    Reimprimir
                  </button>
                  <button
                    onClick={() => marcarLista(c, true)}
                    className="flex-1 rounded-xl bg-hoja py-4 text-lg font-extrabold text-white active:scale-[0.98]"
                  >
                    Lista ✓
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {listas.length > 0 && (
        <div className="rounded-2xl border border-borde bg-white">
          <button onClick={() => setVerListas(!verListas)} className="w-full px-4 py-3 text-left font-semibold">
            {verListas ? "▾" : "▸"} Listas recientes ({listas.length})
          </button>
          {verListas && (
            <ul className="divide-y divide-borde/70 border-t border-borde">
              {listas.map(({ c, p }) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span>
                    <strong>{nombreCuenta(p.cuentas)}</strong> · Ronda {p.numero_ronda} · {NOMBRE_ESTACION[c.estacion]} · lista {hora(c.lista_en!)}
                  </span>
                  <button onClick={() => marcarLista(c, false)} className="rounded-lg border border-borde px-3 py-1.5 font-semibold">
                    Deshacer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </main>
  );
}
