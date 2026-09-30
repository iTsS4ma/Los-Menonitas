"use client";

import { generarUUID } from "@/lib/formato";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Conexion from "@/components/Conexion";
import BotonNotificaciones from "@/components/BotonNotificaciones";
import { useTiempoReal } from "@/hooks/useTiempoReal";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { cantidadTexto, dinero, errorTexto, nombreCuenta, totalCuenta } from "@/lib/formato";
import type { Perfil } from "@/lib/perfil";
import type { Categoria, Cuenta, Mesa, Opcion, Producto, Pedido, DetallePedido } from "@/lib/tipos";

type Linea = {
  clave: string;
  producto: Producto;
  opcion: Opcion | null;
  cantidad?: number;
  monto?: number;
  notas: string;
};

type DatosTicketCancelacion = {
  cuentaNombre: string;
  ronda: number;
  items: { nombre: string; cantidad: string; notas?: string }[];
  motivo: string;
  hora: string;
};

const ETIQUETA_PEDIDO: Record<string, string> = {
  ENVIADO: "En cola",
  PREPARANDO: "Preparando",
  LISTO: "¡Listo!",
  ENTREGADO: "Entregado",
  CANCELADO: "Cancelado",
};

const ESTILO_ESTADO: Record<string, string> = {
  ENVIADO: "bg-queso-claro text-cafe",
  PREPARANDO: "bg-queso text-cafe",
  LISTO: "bg-hoja text-white",
  ENTREGADO: "bg-crema-oscuro text-cafe-medio",
  CANCELADO: "bg-paliacate-claro text-paliacate-oscuro",
};

function horaActualMX() {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
}

export default function VistaMesero({ perfil, cuentaInicial = null }: { perfil: Perfil; cuentaInicial?: string | null }) {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [opciones, setOpciones] = useState<Opcion[]>([]);
  const [pestana, setPestana] = useState<"MESAS" | "LLEVAR">("MESAS");
  const [cuentaId, setCuentaId] = useState<string | null>(cuentaInicial);
  const [capturando, setCapturando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [solicitandoCuenta, setSolicitandoCuenta] = useState(false);

  // Estado para disparar la impresión del ticket de cancelación
  const [ticketCancelacion, setTicketCancelacion] = useState<DatosTicketCancelacion | null>(null);
  const [ordenImpresion, setOrdenImpresion] = useState(0);

  const cargar = useCallback(async () => {
    const [m, c, cat, p, o] = await Promise.all([
      supabase.from("mesas").select("*").eq("activa", true).order("numero"),
      supabase
        .from("cuentas")
        .select("*, mesas(numero), pedidos(*, detalle_pedido(*))")
        .in("estado", ["ABIERTA", "CUENTA_SOLICITADA"])
        .order("abierta_en"),
      supabase.from("categorias").select("*").order("orden"),
      supabase.from("productos").select("*").eq("activo", true).order("orden"),
      supabase.from("opciones_producto").select("*").eq("activo", true).order("nombre"),
    ]);
    const error = m.error || c.error || cat.error || p.error || o.error;
    if (error) return setAviso(errorTexto(error));
    setMesas((m.data as Mesa[]) || []);
    setCuentas((c.data as Cuenta[]) || []);
    setCategorias((cat.data as Categoria[]) || []);
    setProductos((p.data as Producto[]) || []);
    setOpciones((o.data as Opcion[]) || []);
  }, [supabase]);

  const conectado = useTiempoReal("mesero", ["cuentas", "pedidos", "detalle_pedido"], cargar);

  const cuenta = cuentas.find((c) => c.id === cuentaId) ?? null;

  // Disparar ventana de impresión cuando se prepara un ticket de cancelación
  // No se borra el ticket tras imprimir (en celulares window.print() no espera)
  useEffect(() => {
    if (ordenImpresion === 0) return;
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, [ordenImpresion]);

  async function ejecutar(accion: () => PromiseLike<{ error: unknown }>) {
    setAviso("");
    const { error } = await accion();
    if (error) setAviso(errorTexto(error));
    await cargar();
    return !error;
  }

  async function abrirMesa(mesa: Mesa) {
    const existente = cuentas.find((c) => c.mesa_id === mesa.id);
    if (existente) return setCuentaId(existente.id);
    const { data, error } = await supabase
      .from("cuentas")
      .insert({ tipo: "MESA", mesa_id: mesa.id, mesero_id: perfil.id })
      .select("id")
      .single();
    if (error) return setAviso(errorTexto(error));
    await cargar();
    setCuentaId(data.id);
    setCapturando(true);
  }

  async function nuevaParaLlevar() {
    const nombre = window.prompt("Nombre del cliente (opcional)") ?? "";
    const { data, error } = await supabase
      .from("cuentas")
      .insert({ tipo: "PARA_LLEVAR", nombre_cliente: nombre.trim() || null, mesero_id: perfil.id })
      .select("id")
      .single();
    if (error) return setAviso(errorTexto(error));
    await cargar();
    setCuentaId(data.id);
    setCapturando(true);
  }

  // Cancelar un producto individual e imprimir ticket en cocina
  async function cancelarItemIndividual(d: DetallePedido, p: Pedido) {
    const motivo = window.prompt("Motivo de la cancelación para cocina:");
    if (!motivo || !motivo.trim()) return;

    const exito = await ejecutar(() =>
      supabase
        .from("detalle_pedido")
        .update({ estado: "CANCELADO", motivo_cancelacion: motivo.trim() })
        .eq("id", d.id)
    );

    if (exito && cuenta) {
      setTicketCancelacion({
        cuentaNombre: nombreCuenta(cuenta),
        ronda: p.numero_ronda,
        items: [
          {
            nombre: `${d.nombre_producto}${d.nombre_opcion ? ` (${d.nombre_opcion})` : ""}`,
            cantidad: cantidadTexto(d),
            notas: d.notas ?? undefined,
          },
        ],
        motivo: motivo.trim(),
        hora: horaActualMX(),
      });
      setOrdenImpresion((n) => n + 1);
    }
  }

  // Cancelar toda una ronda e imprimir ticket en cocina
  async function cancelarRondaCompleta(p: Pedido) {
    if (!window.confirm("¿Seguro que deseas cancelar toda esta ronda en cocina?")) return;
    const motivo = window.prompt("Motivo de la cancelación de la ronda:");
    if (!motivo || !motivo.trim()) return;

    const exito = await ejecutar(() =>
      supabase.from("pedidos").update({ estado: "CANCELADO" }).eq("id", p.id)
    );

    if (exito && cuenta) {
      const itemsActivos = (p.detalle_pedido || [])
        .filter((d) => d.estado !== "CANCELADO")
        .map((d) => ({
          nombre: `${d.nombre_producto}${d.nombre_opcion ? ` (${d.nombre_opcion})` : ""}`,
          cantidad: cantidadTexto(d),
          notas: d.notas ?? undefined,
        }));

      setTicketCancelacion({
        cuentaNombre: nombreCuenta(cuenta),
        ronda: p.numero_ronda,
        items: itemsActivos.length > 0 ? itemsActivos : [{ nombre: "Ronda completa cancelada", cantidad: "Toda" }],
        motivo: motivo.trim(),
        hora: horaActualMX(),
      });
      setOrdenImpresion((n) => n + 1);
    }
  }

  // Validación estricta para no pedir cuenta con pedidos activos en cocina
  async function pedirCuentaSegura() {
    if (!cuenta) return;
    setSolicitandoCuenta(true);
    setAviso("");

    const { data: pedidosActuales, error: errVerif } = await supabase
      .from("pedidos")
      .select("id, estado")
      .eq("cuenta_id", cuenta.id);

    if (errVerif) {
      setSolicitandoCuenta(false);
      return setAviso("Error al verificar pedidos: " + errVerif.message);
    }

    const pedidosPendientes = (pedidosActuales || []).filter((p) => {
      const estadoNorm = String(p.estado || "").toUpperCase().trim();
      return !["ENTREGADO", "CANCELADO"].includes(estadoNorm);
    });

    if (pedidosPendientes.length > 0) {
      setSolicitandoCuenta(false);
      setAviso("⚠️ No se puede pedir la cuenta: Hay pedidos en preparación o listos sin entregar.");
      await cargar();
      return;
    }

    const { error } = await supabase
      .from("cuentas")
      .update({ estado: "CUENTA_SOLICITADA" })
      .eq("id", cuenta.id);

    setSolicitandoCuenta(false);
    if (error) setAviso(errorTexto(error));
    await cargar();
  }

  // ---------- Vista: captura de productos ----------
  if (cuenta && capturando) {
    return (
      <Captura
        cuenta={cuenta}
        categorias={categorias}
        productos={productos}
        opciones={opciones}
        onCancelar={() => setCapturando(false)}
        onEnviado={async () => {
          setCapturando(false);
          await cargar();
        }}
      />
    );
  }

  // ---------- Vista: detalle de una cuenta ----------
  if (cuenta) {
    const total = totalCuenta(cuenta.pedidos);
    const rondas = [...(cuenta.pedidos || [])].sort((a, b) => a.numero_ronda - b.numero_ronda);

    const tieneEnPreparacion = rondas.some((p) => {
      const st = String(p.estado || "").toUpperCase().trim();
      return st === "ENVIADO" || st === "PREPARANDO" || st === "EN_COLA";
    });

    const tieneListosPorEntregar = rondas.some((p) => {
      const st = String(p.estado || "").toUpperCase().trim();
      return st === "LISTO";
    });

    const hayPendientes = tieneEnPreparacion || tieneListosPorEntregar;
    const puedePedirCuenta = cuenta.estado === "ABIERTA" && total > 0 && !hayPendientes && !solicitandoCuenta;

    return (
      <main className="mx-auto w-full max-w-2xl space-y-4 px-3 pb-8 pt-3">
        <Conexion conectado={conectado} />
        <button
          onClick={() => setCuentaId(null)}
          className="flex w-full items-center justify-left gap-2 rounded-xl border-2 border-cafe bg-white py-3.5 text-base font-semibold active:scale-[0.99] active:bg-crema-oscuro"
        >
          <span aria-hidden className="text-xl leading-none">‹</span> Mesas
        </button>

        <div className="flex items-end justify-between rounded-2xl border border-borde bg-white px-4 py-4">
          <div>
            <h2 className="font-display text-3xl font-extrabold leading-none">{nombreCuenta(cuenta)}</h2>
            <p className="mt-1 text-sm text-cafe-medio">
              {rondas.length} {rondas.length === 1 ? "ronda" : "rondas"}
            </p>
          </div>
          <span className="font-display text-3xl font-bold">{dinero(total)}</span>
        </div>

        {cuenta.estado === "CUENTA_SOLICITADA" && (
          <p className="rounded-xl bg-queso-claro px-3 py-2.5 text-sm font-medium text-cafe">
            Cuenta solicitada a caja. Si piden algo más, se reabre automáticamente.
          </p>
        )}
        {aviso && (
          <p className="rounded-xl bg-paliacate-claro px-3 py-2.5 text-sm font-medium text-paliacate-oscuro">{aviso}</p>
        )}

        {rondas.length === 0 && (
          <p className="rounded-2xl border-2 border-dashed border-borde px-4 py-8 text-center text-cafe-medio">
            Sin productos todavía. Toca <strong>Agregar productos</strong> para empezar.
          </p>
        )}

        {rondas.map((p) => {
          const estadoNorm = String(p.estado || "").toUpperCase().trim();
          return (
            <section
              key={p.id}
              className={`rounded-2xl border bg-white p-4 ${
                estadoNorm === "LISTO" ? "border-hoja ring-2 ring-hoja/30" : "border-borde"
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <strong className="font-display text-lg">Ronda {p.numero_ronda}</strong>
                <span className={`rounded-full px-3 py-1 text-xs font-bold ${ESTILO_ESTADO[estadoNorm] ?? "bg-crema-oscuro text-cafe"}`}>
                  {ETIQUETA_PEDIDO[estadoNorm] || p.estado}
                </span>
              </div>
              <ul className="space-y-2">
                {(p.detalle_pedido || []).map((d) => {
                  const tachado = d.estado === "CANCELADO" || estadoNorm === "CANCELADO";
                  return (
                    <li key={d.id} className={`flex items-start justify-between gap-3 ${tachado ? "text-cafe/40 line-through" : ""}`}>
                      <span className="min-w-0">
                        <span className="font-semibold">{cantidadTexto(d)}</span> {d.nombre_producto}
                        {d.nombre_opcion ? ` (${d.nombre_opcion})` : ""}
                        {d.notas ? <em className="block text-xs text-cafe-medio">{d.notas}</em> : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-3">
                        <span className="tabular-nums">{dinero(d.importe)}</span>
                        {d.estado === "ACTIVO" &&
                          estadoNorm !== "CANCELADO" &&
                          (perfil.rol === "ADMIN" || ["ENVIADO", "PREPARANDO"].includes(estadoNorm)) && (
                            <button
                              className="rounded-lg px-2 py-1 text-xs font-semibold text-paliacate hover:bg-paliacate-claro"
                              onClick={() => cancelarItemIndividual(d, p)}
                            >
                              Quitar
                            </button>
                          )}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {(estadoNorm === "LISTO" || ["ENVIADO", "PREPARANDO"].includes(estadoNorm)) && (
                <div className="mt-4 flex gap-2">
                  {estadoNorm === "LISTO" && (
                    <button
                      className="flex-1 rounded-xl bg-hoja py-3.5 text-lg font-semibold text-white shadow-sm active:scale-[0.99]"
                      onClick={() =>
                        ejecutar(() => supabase.from("pedidos").update({ estado: "ENTREGADO" }).eq("id", p.id))
                      }
                    >
                      Marcar entregado
                    </button>
                  )}
                  {["ENVIADO", "PREPARANDO"].includes(estadoNorm) && (
                    <button
                      className="rounded-xl border border-paliacate/40 px-4 py-2.5 text-sm font-semibold text-paliacate hover:bg-paliacate-claro"
                      onClick={() => cancelarRondaCompleta(p)}
                    >
                      Cancelar ronda
                    </button>
                  )}
                </div>
              )}
            </section>
          );
        })}

        <div className="grid gap-3 pt-2">
          <button
            className="rounded-xl bg-paliacate py-4 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-paliacate-oscuro active:scale-[0.99]"
            onClick={() => setCapturando(true)}
          >
            Agregar productos
          </button>

          {cuenta.estado === "ABIERTA" && total > 0 && (
            <div className="space-y-1.5">
              <button
                disabled={!puedePedirCuenta}
                className={`w-full rounded-xl py-3.5 font-semibold transition-colors ${
                  puedePedirCuenta
                    ? "bg-cafe text-crema hover:bg-cafe/90"
                    : "cursor-not-allowed bg-crema-oscuro text-cafe/50"
                }`}
                onClick={pedirCuentaSegura}
              >
                {solicitandoCuenta
                  ? "Verificando…"
                  : tieneEnPreparacion
                  ? "Cocina preparando platillos…"
                  : tieneListosPorEntregar
                  ? "Entrega los platillos listos primero"
                  : "Pedir la cuenta"}
              </button>
              {hayPendientes && (
                <p className="text-center text-xs font-medium text-cafe-medio">
                  {tieneEnPreparacion
                    ? "Hay platillos en preparación en cocina."
                    : "Hay platillos listos sin marcar como entregados."}
                </p>
              )}
            </div>
          )}

          {(perfil.puede_cobrar || perfil.rol === "ADMIN") && total > 0 && (
            <Link
              href={`/caja?cuenta=${cuenta.id}`}
              className="rounded-xl border-2 border-cafe py-3 text-center font-semibold hover:bg-crema-oscuro"
            >
              Cobrar
            </Link>
          )}

          {(total === 0 || perfil.rol === "ADMIN") && (
            <button
              className="py-2 text-sm font-medium text-paliacate underline-offset-4 hover:underline"
              onClick={async () => {
                if (!window.confirm("¿Cancelar la cuenta completa?")) return;
                if (
                  await ejecutar(() =>
                    supabase.from("cuentas").update({ estado: "CANCELADA" }).eq("id", cuenta.id)
                  )
                )
                  setCuentaId(null);
              }}
            >
              Cancelar cuenta
            </button>
          )}
        </div>

        {/* TICKET DE CANCELACIÓN AUTOMÁTICO PARA COCINA */}
        {ticketCancelacion && (
          <div id="ticket-impresion" style={{ padding: "4px" }}>
            <div style={{ textAlign: "center", borderBottom: "2px solid #000", paddingBottom: "4px" }}>
              <h1 style={{ margin: "0", fontSize: "16px", fontWeight: "900" }}>*** CANCELACIÓN ***</h1>
              <p style={{ margin: "2px 0", fontSize: "13px", fontWeight: "bold" }}>
                {ticketCancelacion.cuentaNombre} · Ronda {ticketCancelacion.ronda}
              </p>
              <p style={{ margin: "1px 0", fontSize: "11px" }}>Hora: {ticketCancelacion.hora}</p>
            </div>

            <div style={{ margin: "8px 0", borderBottom: "1px dashed #000", paddingBottom: "6px" }}>
              <p style={{ margin: "0 0 4px 0", fontSize: "12px", fontWeight: "900" }}>NO PREPARAR:</p>
              {ticketCancelacion.items.map((it, idx) => (
                <div key={idx} style={{ fontSize: "13px", margin: "2px 0", fontWeight: "bold" }}>
                  <span>✖ {it.cantidad} {it.nombre}</span>
                  {it.notas && <p style={{ margin: "1px 0 0 14px", fontSize: "11px", fontWeight: "normal" }}>({it.notas})</p>}
                </div>
              ))}
            </div>

            <div style={{ fontSize: "11px", marginTop: "4px" }}>
              <p style={{ margin: "2px 0", fontWeight: "bold" }}>Motivo:</p>
              <p style={{ margin: "1px 0", fontStyle: "italic" }}>{ticketCancelacion.motivo}</p>
            </div>

            <div style={{ borderTop: "2px solid #000", marginTop: "8px", paddingTop: "4px", textAlign: "center" }}>
              <span style={{ fontSize: "12px", fontWeight: "900" }}>DESECHAR / RETIRAR COMANDA</span>
            </div>
          </div>
        )}
      </main>
    );
  }

  // ---------- Vista: lista de mesas / para llevar ----------
  const paraLlevar = cuentas.filter((c) => c.tipo === "PARA_LLEVAR");
  const tieneListo = (c?: Cuenta) =>
    !!c?.pedidos?.some((p) => String(p.estado || "").toUpperCase().trim() === "LISTO");
  const tieneEnCocina = (c?: Cuenta) =>
    !!c?.pedidos?.some((p) => {
      const st = String(p.estado || "").toUpperCase().trim();
      return st === "ENVIADO" || st === "PREPARANDO";
    });

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 px-3 pb-8 pt-3">
      <Conexion conectado={conectado} />
      {aviso && (
        <p className="rounded-xl bg-paliacate-claro px-3 py-2.5 text-sm font-medium text-paliacate-oscuro">{aviso}</p>
      )}

      <BotonNotificaciones />

      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-crema-oscuro p-1">
        {(["MESAS", "LLEVAR"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPestana(p)}
            className={`rounded-xl py-3 font-semibold transition-colors ${
              pestana === p ? "bg-white text-cafe shadow-sm" : "text-cafe-medio"
            }`}
          >
            {p === "MESAS" ? "Mesas" : `Para llevar (${paraLlevar.length})`}
          </button>
        ))}
      </div>

      {pestana === "MESAS" ? (
        mesas.length === 0 ? (
          <p className="rounded-2xl border-2 border-dashed border-borde px-4 py-8 text-center text-cafe-medio">
            No hay mesas. Dalas de alta en Admin → Mesas.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {mesas.map((m) => {
                const c = cuentas.find((x) => x.mesa_id === m.id);
                const listo = tieneListo(c);
                const enCocina = tieneEnCocina(c);
                const pidioCuenta = c?.estado === "CUENTA_SOLICITADA";
                const estilo = listo
                  ? "border-hoja bg-hoja text-white"
                  : enCocina
                  ? "border-queso bg-queso-claro text-cafe"
                  : pidioCuenta
                  ? "border-paliacate bg-paliacate-claro text-cafe"
                  : c
                  ? "border-cafe bg-white text-cafe"
                  : "border-borde bg-white/60 text-cafe/50";
                return (
                  <button
                    key={m.id}
                    onClick={() => abrirMesa(m)}
                    className={`relative flex aspect-square flex-col items-center justify-center rounded-2xl border-2 transition-transform active:scale-95 ${estilo}`}
                  >
                    {listo && enCocina && (
                      <span
                        className="absolute right-2 top-2 h-3 w-3 rounded-full bg-queso ring-2 ring-white"
                        title="Otra ronda sigue en cocina"
                      />
                    )}
                    <span className="font-display text-4xl font-extrabold leading-none">{m.numero}</span>
                    <span className="mt-1.5 text-xs font-semibold">
                      {listo
                        ? enCocina
                          ? "¡Listo! + cocina"
                          : "¡Listo!"
                        : enCocina
                        ? "En cocina"
                        : c
                        ? pidioCuenta
                          ? "Cuenta"
                          : dinero(totalCuenta(c.pedidos))
                        : "Libre"}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-1 text-xs text-cafe-medio">
              <Leyenda color="bg-white border-2 border-borde" texto="Libre" />
              <Leyenda color="bg-white border-2 border-cafe" texto="Abierta" />
              <Leyenda color="bg-queso" texto="En cocina" />
              <Leyenda color="bg-hoja" texto="Listo para llevar" />
              <Leyenda color="bg-paliacate" texto="Pidió cuenta" />
            </div>
          </>
        )
      ) : (
        <div className="space-y-3">
          <button
            onClick={nuevaParaLlevar}
            className="w-full rounded-xl bg-paliacate py-4 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-paliacate-oscuro"
          >
            Nueva orden para llevar
          </button>
          {paraLlevar.length === 0 && (
            <p className="py-6 text-center text-sm text-cafe-medio">No hay órdenes para llevar abiertas.</p>
          )}
          {paraLlevar.map((c) => {
            const listo = tieneListo(c);
            return (
              <button
                key={c.id}
                onClick={() => setCuentaId(c.id)}
                className={`flex w-full items-center justify-between rounded-2xl border-2 px-4 py-4 text-left ${
                  listo ? "border-hoja bg-hoja text-white" : "border-borde bg-white"
                }`}
              >
                <span className="font-display text-lg font-bold">{nombreCuenta(c)}</span>
                <span className="font-semibold">{listo ? "¡Listo!" : dinero(totalCuenta(c.pedidos))}</span>
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-3 rounded ${color}`} />
      {texto}
    </span>
  );
}

// =====================================================================
// Captura de productos para una ronda
// =====================================================================
function Captura({
  cuenta,
  categorias,
  productos,
  opciones,
  onCancelar,
  onEnviado,
}: {
  cuenta: Cuenta;
  categorias: Categoria[];
  productos: Producto[];
  opciones: Opcion[];
  onCancelar: () => void;
  onEnviado: () => void;
}) {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [catId, setCatId] = useState<string | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [eligiendo, setEligiendo] = useState<Producto | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");

  const categoriaActiva = catId ?? categorias[0]?.id ?? null;

  useEffect(() => {
    const aviso = (e: BeforeUnloadEvent) => {
      if (lineas.length) e.preventDefault();
    };
    window.addEventListener("beforeunload", aviso);
    return () => window.removeEventListener("beforeunload", aviso);
  }, [lineas.length]);

  function agregar(l: Omit<Linea, "clave" | "notas">) {
    setLineas((prev) => {
      if (l.producto.unidad === "PIEZA") {
        const i = prev.findIndex(
          (x) => x.producto.id === l.producto.id && x.opcion?.id === l.opcion?.id && !x.notas
        );
        if (i >= 0) return prev.map((x, j) => (j === i ? { ...x, cantidad: (x.cantidad ?? 0) + 1 } : x));
      }
      return [...prev, { ...l, notas: "", clave: generarUUID() }];
    });
  }

  function tocarProducto(p: Producto) {
    if (!p.disponible) return;
    if (p.requiere_opcion || p.unidad === "KG") return setEligiendo(p);
    agregar({ producto: p, opcion: null, cantidad: 1 });
  }

  const importeLinea = (l: Linea) =>
    l.monto ?? Math.round((l.cantidad ?? 0) * Number(l.producto.precio) * 100) / 100;
  const total = lineas.reduce((s, l) => s + importeLinea(l), 0);

  // Cuántas piezas de cada producto van en la ronda (para mostrarlo sobre el botón)
  const enRonda = (id: string) =>
    lineas.filter((l) => l.producto.id === id).reduce((s, l) => s + (l.producto.unidad === "PIEZA" ? l.cantidad ?? 0 : 1), 0);

  async function enviar() {
    setEnviando(true);
    setError("");
    const items = lineas.map((l) => ({
      producto_id: l.producto.id,
      opcion_id: l.opcion?.id ?? null,
      ...(l.monto !== undefined ? { monto: l.monto } : { cantidad: l.cantidad }),
      notas: l.notas || null,
    }));
    const { error } = await supabase.rpc("enviar_pedido", { p_cuenta_id: cuenta.id, p_items: items });
    setEnviando(false);
    if (error) return setError(errorTexto(error));
    setLineas([]);
    onEnviado();
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-3 pt-3">
      <div className="mb-3 flex items-center justify-between">
        <button
          onClick={() => (!lineas.length || window.confirm("¿Descartar esta ronda?")) && onCancelar()}
          className="rounded-full px-2 py-1 text-sm font-semibold text-cafe-medio hover:bg-crema-oscuro"
        >
          ‹ Cancelar
        </button>
        <strong className="font-display text-xl">{nombreCuenta(cuenta)}</strong>
      </div>

      <div className="sticky top-0 z-[5] -mx-3 mb-3 flex gap-2 overflow-x-auto bg-crema px-3 py-2">
        {categorias.map((c) => (
          <button
            key={c.id}
            onClick={() => setCatId(c.id)}
            className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
              categoriaActiva === c.id ? "bg-cafe text-crema" : "border border-borde bg-white text-cafe"
            }`}
          >
            {c.nombre}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
        {productos
          .filter((p) => p.categoria_id === categoriaActiva)
          .map((p) => {
            const n = enRonda(p.id);
            return (
              <button
                key={p.id}
                onClick={() => tocarProducto(p)}
                disabled={!p.disponible}
                className={`relative min-h-[84px] rounded-2xl border-2 bg-white p-3 text-left transition-transform active:scale-[0.97] disabled:opacity-40 ${
                  n > 0 ? "border-paliacate" : "border-borde"
                }`}
              >
                {n > 0 && (
                  <span className="absolute right-2 top-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-paliacate px-1.5 text-xs font-bold text-white">
                    {n}
                  </span>
                )}
                <span className="block pr-6 font-semibold leading-snug">{p.nombre}</span>
                <span className="mt-1 block text-sm text-cafe-medio">
                  {p.disponible ? `${dinero(p.precio)}${p.unidad === "KG" ? " / kg" : ""}` : "Agotado"}
                </span>
              </button>
            );
          })}
      </div>

      <section className="mt-5 flex-1 space-y-2 pb-4">
        <h3 className="font-display text-lg font-bold">Esta ronda</h3>
        {lineas.length === 0 && (
          <p className="rounded-2xl border-2 border-dashed border-borde px-4 py-6 text-center text-sm text-cafe-medio">
            Toca un producto para agregarlo.
          </p>
        )}
        {lineas.map((l) => (
          <div key={l.clave} className="rounded-2xl border border-borde bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0">
                <span className="font-semibold">
                  {l.producto.nombre}
                  {l.opcion ? ` (${l.opcion.nombre})` : ""}
                </span>
                <span className="block text-xs text-cafe-medio">
                  {l.producto.unidad === "KG"
                    ? l.monto !== undefined
                      ? `${dinero(l.monto)} de producto (≈ ${(l.monto / Number(l.producto.precio)).toFixed(3)} kg)`
                      : `${(l.cantidad ?? 0).toFixed(3)} kg`
                    : `${l.cantidad} pz`}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                {l.producto.unidad === "PIEZA" && (
                  <>
                    <button
                      aria-label="Quitar uno"
                      className="h-10 w-10 rounded-xl border border-borde text-xl font-semibold"
                      onClick={() =>
                        setLineas((prev) =>
                          prev.flatMap((x) =>
                            x.clave !== l.clave
                              ? [x]
                              : (x.cantidad ?? 1) > 1
                              ? [{ ...x, cantidad: (x.cantidad ?? 1) - 1 }]
                              : []
                          )
                        )
                      }
                    >
                      −
                    </button>
                    <button
                      aria-label="Agregar uno"
                      className="h-10 w-10 rounded-xl border border-borde text-xl font-semibold"
                      onClick={() =>
                        setLineas((prev) =>
                          prev.map((x) => (x.clave === l.clave ? { ...x, cantidad: (x.cantidad ?? 0) + 1 } : x))
                        )
                      }
                    >
                      +
                    </button>
                  </>
                )}
                {l.producto.unidad === "KG" && (
                  <button
                    className="h-10 rounded-xl border border-borde px-3 text-sm font-semibold"
                    onClick={() => setLineas((prev) => prev.filter((x) => x.clave !== l.clave))}
                  >
                    Quitar
                  </button>
                )}
                <span className="w-20 text-right font-semibold tabular-nums">{dinero(importeLinea(l))}</span>
              </span>
            </div>
            <input
              placeholder="Nota (ej. sin cebolla)"
              value={l.notas}
              onChange={(e) =>
                setLineas((prev) =>
                  prev.map((x) => (x.clave === l.clave ? { ...x, notas: e.target.value } : x))
                )
              }
              className="mt-2 w-full rounded-xl border border-borde bg-crema/40 px-3 py-2 text-sm focus:border-cafe focus:outline-none"
            />
          </div>
        ))}
      </section>

      {error && (
        <p className="mb-2 rounded-xl bg-paliacate-claro px-3 py-2.5 text-sm font-medium text-paliacate-oscuro">{error}</p>
      )}
      <div className="sticky bottom-0 -mx-3 border-t border-borde bg-crema/95 px-3 pb-3 pt-2 backdrop-blur">
        <button
          onClick={enviar}
          disabled={!lineas.length || enviando}
          className="w-full rounded-xl bg-paliacate py-4 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-paliacate-oscuro disabled:opacity-40"
        >
          {enviando ? "Enviando…" : `Enviar a cocina · ${dinero(total)}`}
        </button>
      </div>

      {eligiendo && (
        <Selector
          producto={eligiendo}
          opciones={opciones.filter((o) => o.producto_id === eligiendo.id)}
          onCerrar={() => setEligiendo(null)}
          onElegir={(l) => {
            agregar({ producto: eligiendo, ...l });
            setEligiendo(null);
          }}
        />
      )}
    </main>
  );
}

// Ventana para elegir guisado o capturar peso / monto
function Selector({
  producto,
  opciones,
  onCerrar,
  onElegir,
}: {
  producto: Producto;
  opciones: Opcion[];
  onCerrar: () => void;
  onElegir: (l: { opcion: Opcion | null; cantidad?: number; monto?: number }) => void;
}) {
  const [peso, setPeso] = useState("");
  const [monto, setMonto] = useState("");
  const precio = Number(producto.precio);

  return (
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-cafe/50 sm:items-center" onClick={onCerrar}>
      <div
        className="max-h-[90vh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-3xl bg-crema p-5 shadow-xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-baseline justify-between">
          <h3 className="font-display text-2xl font-extrabold">{producto.nombre}</h3>
          <span className="text-sm text-cafe-medio">
            {dinero(precio)}
            {producto.unidad === "KG" ? " / kg" : ""}
          </span>
        </div>

        {producto.requiere_opcion && (
          <div className="grid grid-cols-2 gap-2.5">
            {opciones.map((o) => (
              <button
                key={o.id}
                className="rounded-2xl border-2 border-borde bg-white py-5 text-lg font-semibold active:scale-[0.97]"
                onClick={() => onElegir({ opcion: o, cantidad: 1 })}
              >
                {o.nombre}
              </button>
            ))}
          </div>
        )}

        {producto.unidad === "KG" && (
          <>
            <div className="grid grid-cols-4 gap-2">
              {[0.25, 0.5, 0.75, 1].map((k) => (
                <button
                  key={k}
                  className="rounded-2xl border-2 border-borde bg-white py-4 font-semibold active:scale-[0.97]"
                  onClick={() => onElegir({ opcion: null, cantidad: k })}
                >
                  {k === 1 ? "1 kg" : `${k * 1000} g`}
                </button>
              ))}
            </div>
            <label className="block text-sm font-semibold">
              Otro peso (kg)
              <div className="mt-1 flex gap-2">
                <input
                  inputMode="decimal"
                  value={peso}
                  onChange={(e) => setPeso(e.target.value)}
                  placeholder="0.350"
                  className="min-w-0 flex-1 rounded-xl border border-borde bg-white px-3 py-3 font-normal focus:border-cafe focus:outline-none"
                />
                <button
                  className="rounded-xl bg-paliacate px-5 font-semibold text-white disabled:opacity-40"
                  disabled={!(Number(peso) > 0)}
                  onClick={() =>
                    onElegir({ opcion: null, cantidad: Math.round(Number(peso) * 1000) / 1000 })
                  }
                >
                  Agregar
                </button>
              </div>
            </label>
            <label className="block text-sm font-semibold">
              Por monto ($)
              <div className="mt-1 flex gap-2">
                <input
                  inputMode="decimal"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="100"
                  className="min-w-0 flex-1 rounded-xl border border-borde bg-white px-3 py-3 font-normal focus:border-cafe focus:outline-none"
                />
                <button
                  className="rounded-xl bg-paliacate px-5 font-semibold text-white disabled:opacity-40"
                  disabled={!(Number(monto) > 0)}
                  onClick={() =>
                    onElegir({ opcion: null, monto: Math.round(Number(monto) * 100) / 100 })
                  }
                >
                  Agregar
                </button>
              </div>
              {Number(monto) > 0 && (
                <span className="mt-1 block text-xs font-normal text-cafe-medio">≈ {(Number(monto) / precio).toFixed(3)} kg</span>
              )}
            </label>
          </>
        )}
        <button className="w-full rounded-xl py-3 text-sm font-semibold text-cafe-medio hover:bg-crema-oscuro" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
    </div>
  );
}
