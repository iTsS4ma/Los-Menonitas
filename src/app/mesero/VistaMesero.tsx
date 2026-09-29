"use client";

import { generarUUID } from "@/lib/formato";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Conexion from "@/components/Conexion";
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

function horaActualMX() {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
}

export default function VistaMesero({ perfil }: { perfil: Perfil }) {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [opciones, setOpciones] = useState<Opcion[]>([]);
  const [pestana, setPestana] = useState<"MESAS" | "LLEVAR">("MESAS");
  const [cuentaId, setCuentaId] = useState<string | null>(null);
  const [capturando, setCapturando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [solicitandoCuenta, setSolicitandoCuenta] = useState(false);

  // Estado para disparar la impresión del ticket de cancelación
  const [ticketCancelacion, setTicketCancelacion] = useState<DatosTicketCancelacion | null>(null);

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
  useEffect(() => {
    if (ticketCancelacion) {
      const timer = setTimeout(() => {
        window.print();
        setTicketCancelacion(null);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [ticketCancelacion]);

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
      <main className="mx-auto w-full max-w-2xl space-y-4 p-3">
        <Conexion conectado={conectado} />
        <button onClick={() => setCuentaId(null)} className="text-sm underline">
          Volver
        </button>
        <div className="flex items-baseline justify-between">
          <h2 className="text-2xl font-semibold">{nombreCuenta(cuenta)}</h2>
          <span className="text-2xl font-semibold">{dinero(total)}</span>
        </div>
        {cuenta.estado === "CUENTA_SOLICITADA" && (
          <p className="rounded bg-amber-50 p-2 text-sm text-amber-800 font-medium">
            🔔 Cuenta solicitada a caja. Si piden algo más, se reabre automáticamente.
          </p>
        )}
        {aviso && <p className="rounded bg-rose-50 p-2 text-sm text-rose-700 font-medium">{aviso}</p>}

        {rondas.length === 0 && <p className="text-slate-600">Sin productos todavía.</p>}
        {rondas.map((p) => {
          const estadoNorm = String(p.estado || "").toUpperCase().trim();
          return (
            <section key={p.id} className="rounded border p-3">
              <div className="mb-2 flex items-center justify-between">
                <strong>Ronda {p.numero_ronda}</strong>
                <span className={estadoNorm === "LISTO" ? "font-bold text-emerald-700" : "text-sm text-slate-600"}>
                  {ETIQUETA_PEDIDO[estadoNorm] || p.estado}
                </span>
              </div>
              <ul className="space-y-1">
                {(p.detalle_pedido || []).map((d) => (
                  <li
                    key={d.id}
                    className={`flex items-start justify-between gap-2 ${
                      d.estado === "CANCELADO" || estadoNorm === "CANCELADO" ? "text-slate-400 line-through" : ""
                    }`}
                  >
                    <span>
                      {cantidadTexto(d)} {d.nombre_producto}
                      {d.nombre_opcion ? ` (${d.nombre_opcion})` : ""}
                      {d.notas ? <em className="block text-xs text-slate-600">{d.notas}</em> : null}
                    </span>
                    <span className="flex items-center gap-2">
                      {dinero(d.importe)}
                      {d.estado === "ACTIVO" &&
                        estadoNorm !== "CANCELADO" &&
                        (perfil.rol === "ADMIN" || ["ENVIADO", "PREPARANDO"].includes(estadoNorm)) && (
                          <button
                            className="text-xs text-rose-600 underline font-semibold"
                            onClick={() => cancelarItemIndividual(d, p)}
                          >
                            Quitar
                          </button>
                        )}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex gap-2">
                {estadoNorm === "LISTO" && (
                  <button
                    className="flex-1 rounded bg-emerald-600 hover:bg-emerald-700 py-3 text-white font-semibold shadow"
                    onClick={() =>
                      ejecutar(() => supabase.from("pedidos").update({ estado: "ENTREGADO" }).eq("id", p.id))
                    }
                  >
                    Marcar entregado
                  </button>
                )}
                {["ENVIADO", "PREPARANDO"].includes(estadoNorm) && (
                  <button
                    className="rounded border px-3 py-2 text-sm text-rose-600 font-semibold"
                    onClick={() => cancelarRondaCompleta(p)}
                  >
                    Cancelar ronda
                  </button>
                )}
              </div>
            </section>
          );
        })}

        <div className="grid gap-2">
          <button
            className="rounded bg-orange-600 hover:bg-orange-700 py-4 text-lg text-white font-semibold"
            onClick={() => setCapturando(true)}
          >
            Agregar productos
          </button>

          {/* Bloque estricto para pedir la cuenta */}
          {cuenta.estado === "ABIERTA" && total > 0 && (
            <div className="space-y-1">
              <button
                disabled={!puedePedirCuenta}
                className={`w-full rounded border py-3 font-semibold transition ${
                  puedePedirCuenta
                    ? "bg-amber-500 hover:bg-amber-600 text-white border-amber-600 cursor-pointer shadow-sm"
                    : "bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed"
                }`}
                onClick={pedirCuentaSegura}
              >
                {solicitandoCuenta
                  ? "Verificando..."
                  : tieneEnPreparacion
                  ? "⏳ Cocina preparando platillos..."
                  : tieneListosPorEntregar
                  ? "⏳ Entrega los platillos listos primero"
                  : "Pedir la cuenta"}
              </button>
              {hayPendientes && (
                <p className="text-center text-xs text-amber-700 font-medium">
                  {tieneEnPreparacion
                    ? "Hay platillos en preparación en cocina."
                    : "Hay platillos listos en barra sin marcar como entregados."}
                </p>
              )}
            </div>
          )}

          {(perfil.puede_cobrar || perfil.rol === "ADMIN") && total > 0 && (
            <Link href={`/caja?cuenta=${cuenta.id}`} className="rounded border py-3 text-center font-medium">
              Cobrar
            </Link>
          )}

          {(total === 0 || perfil.rol === "ADMIN") && (
            <button
              className="py-2 text-sm text-rose-600 underline"
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
    <main className="mx-auto w-full max-w-3xl space-y-3 p-3">
      <Conexion conectado={conectado} />
      {aviso && <p className="rounded bg-rose-50 p-2 text-sm text-rose-700">{aviso}</p>}
      <div className="grid grid-cols-2 gap-2">
        {(["MESAS", "LLEVAR"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPestana(p)}
            className={`rounded py-3 ${
              pestana === p ? "bg-orange-600 hover:bg-orange-700 text-white font-medium" : "border"
            }`}
          >
            {p === "MESAS" ? "Mesas" : `Para llevar (${paraLlevar.length})`}
          </button>
        ))}
      </div>

      {pestana === "MESAS" ? (
        mesas.length === 0 ? (
          <p className="text-slate-600">No hay mesas. Dalas de alta en Admin → Mesas.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {mesas.map((m) => {
              const c = cuentas.find((x) => x.mesa_id === m.id);
              const listo = tieneListo(c);
              const enCocina = tieneEnCocina(c);
              return (
                <button
                  key={m.id}
                  onClick={() => abrirMesa(m)}
                  className={`relative flex aspect-square flex-col items-center justify-center rounded border-2 ${
                    listo
                      ? "border-emerald-600 bg-emerald-50"
                      : enCocina
                      ? "border-amber-500 bg-amber-50"
                      : c
                      ? "border-orange-600 bg-slate-100"
                      : "border-slate-200"
                  }`}
                >
                  {listo && enCocina && (
                    <span
                      className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-white"
                      title="Ronda en cocina pendiente"
                    />
                  )}
                  <span className="text-2xl font-semibold">{m.numero}</span>
                  <span className="text-xs font-medium">
                    {listo
                      ? enCocina
                        ? "¡Listo! (+ Cocina)"
                        : "¡Listo!"
                      : enCocina
                      ? "En cocina"
                      : c
                      ? c.estado === "CUENTA_SOLICITADA"
                        ? "Cuenta"
                        : dinero(totalCuenta(c.pedidos))
                      : "Libre"}
                  </span>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <div className="space-y-2">
          <button
            onClick={nuevaParaLlevar}
            className="w-full rounded bg-orange-600 hover:bg-orange-700 py-4 text-lg text-white font-medium"
          >
            Nueva orden para llevar
          </button>
          {paraLlevar.map((c) => (
            <button
              key={c.id}
              onClick={() => setCuentaId(c.id)}
              className={`flex w-full justify-between rounded border-2 p-3 ${
                tieneListo(c) ? "border-emerald-600 bg-emerald-50" : ""
              }`}
            >
              <span>{nombreCuenta(c)}</span>
              <span>{tieneListo(c) ? "¡Listo!" : dinero(totalCuenta(c.pedidos))}</span>
            </button>
          ))}
        </div>
      )}
    </main>
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
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col p-3">
      <div className="mb-2 flex items-center justify-between">
        <button
          onClick={() => (!lineas.length || window.confirm("¿Descartar esta ronda?")) && onCancelar()}
          className="text-sm underline"
        >
          Cancelar
        </button>
        <strong>{nombreCuenta(cuenta)}</strong>
      </div>

      <div className="mb-2 flex gap-2 overflow-x-auto pb-1">
        {categorias.map((c) => (
          <button
            key={c.id}
            onClick={() => setCatId(c.id)}
            className={`shrink-0 rounded px-3 py-2 font-medium ${
              categoriaActiva === c.id ? "bg-orange-600 hover:bg-orange-700 text-white" : "border"
            }`}
          >
            {c.nombre}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {productos
          .filter((p) => p.categoria_id === categoriaActiva)
          .map((p) => (
            <button
              key={p.id}
              onClick={() => tocarProducto(p)}
              disabled={!p.disponible}
              className="rounded border p-3 text-left disabled:opacity-40"
            >
              <span className="block font-medium">{p.nombre}</span>
              <span className="text-sm text-slate-600">
                {p.disponible ? `${dinero(p.precio)}${p.unidad === "KG" ? " / kg" : ""}` : "Agotado"}
              </span>
            </button>
          ))}
      </div>

      <section className="mt-4 flex-1 space-y-2">
        <h3 className="font-semibold">Esta ronda</h3>
        {lineas.length === 0 && <p className="text-sm text-slate-600">Toca un producto para agregarlo.</p>}
        {lineas.map((l) => (
          <div key={l.clave} className="rounded border p-2">
            <div className="flex items-center justify-between gap-2">
              <span>
                {l.producto.nombre}
                {l.opcion ? ` (${l.opcion.nombre})` : ""}
                <span className="block text-xs text-slate-600">
                  {l.producto.unidad === "KG"
                    ? l.monto !== undefined
                      ? `${dinero(l.monto)} de producto (≈ ${(l.monto / Number(l.producto.precio)).toFixed(3)} kg)`
                      : `${(l.cantidad ?? 0).toFixed(3)} kg`
                    : `${l.cantidad} pz`}
                </span>
              </span>
              <span className="flex items-center gap-1">
                {l.producto.unidad === "PIEZA" && (
                  <>
                    <button
                      className="h-9 w-9 rounded border"
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
                      className="h-9 w-9 rounded border"
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
                    className="h-9 rounded border px-2 text-sm"
                    onClick={() => setLineas((prev) => prev.filter((x) => x.clave !== l.clave))}
                  >
                    Quitar
                  </button>
                )}
                <span className="w-20 text-right">{dinero(importeLinea(l))}</span>
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
              className="mt-1 w-full rounded border px-2 py-1 text-sm"
            />
          </div>
        ))}
      </section>

      {error && <p className="mt-2 rounded bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
      <button
        onClick={enviar}
        disabled={!lineas.length || enviando}
        className="sticky bottom-2 mt-3 rounded bg-orange-600 hover:bg-orange-700 py-4 text-lg text-white font-semibold disabled:opacity-50"
      >
        {enviando ? "Enviando…" : `Enviar a cocina · ${dinero(total)}`}
      </button>

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
    <div className="fixed inset-0 z-10 flex items-end justify-center bg-slate-900/40 sm:items-center" onClick={onCerrar}>
      <div
        className="w-full max-w-md space-y-3 rounded-t-xl border border-slate-200 bg-white p-4 shadow-xl sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold">{producto.nombre}</h3>

        {producto.requiere_opcion && (
          <div className="grid grid-cols-2 gap-2">
            {opciones.map((o) => (
              <button
                key={o.id}
                className="rounded border py-4 font-medium"
                onClick={() => onElegir({ opcion: o, cantidad: 1 })}
              >
                {o.nombre}
              </button>
            ))}
          </div>
        )}

        {producto.unidad === "KG" && (
          <>
            <p className="text-sm text-slate-600">{dinero(precio)} por kilo</p>
            <div className="grid grid-cols-4 gap-2">
              {[0.25, 0.5, 0.75, 1].map((k) => (
                <button
                  key={k}
                  className="rounded border py-3 font-medium"
                  onClick={() => onElegir({ opcion: null, cantidad: k })}
                >
                  {k === 1 ? "1 kg" : `${k * 1000} g`}
                </button>
              ))}
            </div>
            <label className="block text-sm">
              Otro peso (kg)
              <div className="flex gap-2">
                <input
                  inputMode="decimal"
                  value={peso}
                  onChange={(e) => setPeso(e.target.value)}
                  placeholder="0.350"
                  className="flex-1 rounded border px-2 py-2"
                />
                <button
                  className="rounded bg-orange-600 hover:bg-orange-700 px-4 text-white font-medium disabled:opacity-40"
                  disabled={!(Number(peso) > 0)}
                  onClick={() =>
                    onElegir({ opcion: null, cantidad: Math.round(Number(peso) * 1000) / 1000 })
                  }
                >
                  Agregar
                </button>
              </div>
            </label>
            <label className="block text-sm">
              Por monto ($)
              <div className="flex gap-2">
                <input
                  inputMode="decimal"
                  value={monto}
                  onChange={(e) => setMonto(e.target.value)}
                  placeholder="100"
                  className="flex-1 rounded border px-2 py-2"
                />
                <button
                  className="rounded bg-orange-600 hover:bg-orange-700 px-4 text-white font-medium disabled:opacity-40"
                  disabled={!(Number(monto) > 0)}
                  onClick={() =>
                    onElegir({ opcion: null, monto: Math.round(Number(monto) * 100) / 100 })
                  }
                >
                  Agregar
                </button>
              </div>
              {Number(monto) > 0 && (
                <span className="text-xs text-slate-600">≈ {(Number(monto) / precio).toFixed(3)} kg</span>
              )}
            </label>
          </>
        )}
        <button className="w-full py-2 text-sm underline" onClick={onCerrar}>
          Cerrar
        </button>
      </div>
    </div>
  );
}