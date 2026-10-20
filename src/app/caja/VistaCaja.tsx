"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Conexion from "@/components/Conexion";
import { useTiempoReal } from "@/hooks/useTiempoReal";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { diaMX, dinero, nombreCuenta, totalCuenta } from "@/lib/formato";
import type { Cuenta, MetodoPago, DetallePedido, Mesa, Pedido } from "@/lib/tipos";
import BotonImpresora from "@/components/BotonImpresora";
import CorteCaja from "./CorteCaja";
import ControlCaja, { type EstadoCaja } from "./ControlCaja";
import { elegirImpresora, ErrorImpresion, estadoImpresoras, imprimir, ticketCuenta as bytesTicketCuenta, DATOS_LOCAL } from "@/lib/impresoraBT";

type ItemAgrupado = {
  nombre: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  subtotal: number;
};

type CodigoDescuento = { codigo: string; tipo: "TOTAL" | "MONTO" | "PORCENTAJE"; valor: number | null };

// Mismo cálculo que hace la base de datos al cobrar
function calcularDescuento(c: CodigoDescuento | null, consumo: number) {
  if (!c) return 0;
  if (c.tipo === "TOTAL") return consumo;
  if (c.tipo === "MONTO") return Math.min(Number(c.valor), consumo);
  return Math.min(Math.round(consumo * Number(c.valor)) / 100, consumo);
}

const etiquetaCodigo = (c: CodigoDescuento) =>
  c.tipo === "TOTAL" ? "Cortesía" : c.tipo === "MONTO" ? `Descuento ${c.codigo}` : `Descuento ${Number(c.valor)}% (${c.codigo})`;

function calcularRedondeo50Centavos(monto: number) {
  const redondeado = Math.round(monto * 2) / 2;
  const diferencia = Number((redondeado - monto).toFixed(2));
  return { total: redondeado, redondeo: diferencia };
}

function horaActualMX() {
  return new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date());
}

// Productos de la cuenta agrupados para el ticket (sin rondas ni productos cancelados)
function agruparProductos(ticketCuenta: Cuenta | null): ItemAgrupado[] {
    if (!ticketCuenta) return [];

    const mapa = new Map<string, ItemAgrupado>();

    ticketCuenta.pedidos?.filter((p) => p.estado !== "CANCELADO").forEach((p) => {
      p.detalle_pedido
        ?.filter((d: any) => d.estado === "ACTIVO" || !d.estado)
        .forEach((d: any) => {
          const nombreCompleto = `${d.nombre_producto || "Producto"}${d.nombre_opcion ? ` (${d.nombre_opcion})` : ""}${d.con_quesillo ? " + quesillo" : ""}`;
          const cant = Number(d.cantidad) || 1;

          let pu = 0;
          if (d.precio_unitario !== undefined && d.precio_unitario !== null) {
            pu = Number(d.precio_unitario);
          } else if (d.precio !== undefined && d.precio !== null) {
            pu = Number(d.precio);
          } else if (d.subtotal !== undefined && d.subtotal !== null) {
            pu = Number(d.subtotal) / cant;
          }

          if (isNaN(pu)) pu = 0;

          // El importe guardado ya incluye el quesillo
          const sub = !isNaN(Number(d.importe)) ? Number(d.importe) : cant * pu;

          const clave = `${nombreCompleto}_${pu}`;

          const previo = mapa.get(clave) || {
            nombre: nombreCompleto,
            cantidad: 0,
            unidad: d.unidad || "PZA",
            precio_unitario: pu,
            subtotal: 0,
          };

          previo.cantidad += cant;
          previo.subtotal += sub;
          mapa.set(clave, previo);
        });
    });

    return [...mapa.values()];
}

export default function VistaCaja({
  cuentaInicial = null,
}: {
  cuentaInicial?: string | null;
}) {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  // Cuentas que quedaron en $0 (rondas canceladas): solo se pueden cancelar
  const [cuentasCero, setCuentasCero] = useState<Cuenta[]>([]);
  // Código de descuento (opcional) y datos de tarjeta
  const [codigoTexto, setCodigoTexto] = useState("");
  const [codigo, setCodigo] = useState<CodigoDescuento | null>(null);
  const [revisandoCodigo, setRevisandoCodigo] = useState(false);
  const [referenciaClip, setReferenciaClip] = useState("");
  const [propina, setPropina] = useState("");
  // Descuento que se imprime en el ticket (si había un código aplicado al imprimir)
  const [ticketDescuento, setTicketDescuento] = useState<{ etiqueta: string; monto: number } | null>(null);
  const [cuentaIdSeleccionada, setCuentaIdSeleccionada] = useState<string | null>(cuentaInicial);
  const [metodo, setMetodo] = useState<MetodoPago>("EFECTIVO");
  // Estado de la caja de hoy: sin abrirla (o ya cerrada) no se cobra en efectivo
  const [estadoCaja, setEstadoCaja] = useState<EstadoCaja | null>(null);
  const cajaAbierta = estadoCaja?.estado === "ABIERTA";
  const [ticketCuenta, setTicketCuenta] = useState<Cuenta | null>(null);
  const [horaTicket, setHoraTicket] = useState<string>("");
  const [ordenImpresion, setOrdenImpresion] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState("");

  // Control de efectivo y cambio
  const [pagoCon, setPagoCon] = useState<string>("");

  const seleccionada = useMemo(
    () => [...cuentas, ...cuentasCero].find((c) => c.id === cuentaIdSeleccionada) || null,
    [cuentas, cuentasCero, cuentaIdSeleccionada]
  );

  const totalCalculado = useMemo(() => {
    if (!seleccionada) return 0;
    return totalCuenta(seleccionada.pedidos);
  }, [seleccionada]);

  const descuento = calcularDescuento(codigo, totalCalculado);
  const totalConDescuento = Number((totalCalculado - descuento).toFixed(2));
  const esCortesia = !!codigo && totalConDescuento <= 0;

  // Solo efectivo se redondea (a 50 centavos)
  const { total: totalFinalCobro, redondeo } = useMemo(() => {
    if (esCortesia) return { total: 0, redondeo: 0 };
    return metodo === "EFECTIVO"
      ? calcularRedondeo50Centavos(totalConDescuento)
      : { total: totalConDescuento, redondeo: 0 };
  }, [totalConDescuento, metodo, esCortesia]);

  const montoRecibido = Number(pagoCon) || 0;
  const cambio = Math.max(0, Number((montoRecibido - totalFinalCobro).toFixed(2)));
  const faltaDinero = metodo === "EFECTIVO" && montoRecibido > 0 && montoRecibido < totalFinalCobro;

  useEffect(() => {
    setPagoCon("");
  }, [cuentaIdSeleccionada, metodo]);

  // Al cambiar de cuenta se limpian código y datos de tarjeta
  useEffect(() => {
    setCodigo(null);
    setCodigoTexto("");
    setReferenciaClip("");
    setPropina("");
  }, [cuentaIdSeleccionada]);

  async function aplicarCodigo() {
    if (!codigoTexto.trim()) return;
    setRevisandoCodigo(true);
    const { data, error } = await supabase.rpc("revisar_codigo_descuento", { p_codigo: codigoTexto });
    setRevisandoCodigo(false);
    if (error) return alert(error.message.includes("inválido") ? "Código de descuento inválido o ya usado." : `Error: ${error.message}`);
    setCodigo(data as CodigoDescuento);
  }

  const cargar = useCallback(async () => {
    const resCuentas = await supabase
      .from("cuentas")
      .select("*")
      .in("estado", ["ABIERTA", "CUENTA_SOLICITADA"]);

    if (resCuentas.error) {
      setErrorCarga(resCuentas.error.message || "Error al leer cuentas");
      return;
    }

    const listaCuentasRaw = (resCuentas.data || []) as (Cuenta & { mesa_id?: string | null })[];
    if (listaCuentasRaw.length === 0) {
      setCuentasCero([]);
      setCuentas([]);
      setErrorCarga("");
      return;
    }

    const resMesas = await supabase.from("mesas").select("*");
    const listaMesas = (resMesas.data || []) as Mesa[];
    const mapaMesas = new Map<string, Mesa>();
    listaMesas.forEach((m) => mapaMesas.set(m.id, m));

    const idsCuentas = listaCuentasRaw.map((c) => c.id);
    const resPedidos = await supabase
      .from("pedidos")
      .select("*, detalle_pedido(*)")
      .in("cuenta_id", idsCuentas);

    const listaPedidos = (resPedidos.data || []) as Pedido[];

    const cuentasCompletas: Cuenta[] = listaCuentasRaw.map((c) => ({
      ...c,
      mesas: c.mesa_id ? mapaMesas.get(c.mesa_id) ?? null : null,
      pedidos: listaPedidos.filter((p) => p.cuenta_id === c.id),
    }));

    const porMesa = (a: Cuenta, b: Cuenta) => (a.mesas?.numero ?? 999) - (b.mesas?.numero ?? 999);
    const listaFinal = cuentasCompletas.filter((c) => totalCuenta(c.pedidos) > 0).sort(porMesa);
    const listaCero = cuentasCompletas.filter((c) => totalCuenta(c.pedidos) === 0).sort(porMesa);

    setErrorCarga("");
    setCuentas(listaFinal);
    setCuentasCero(listaCero);
  }, [supabase]);

  const conectado = useTiempoReal("caja", ["cuentas", "pedidos", "detalle_pedido"], cargar);

  const [errorImpresion, setErrorImpresion] = useState<{ cuenta: Cuenta; mensaje: string; sinPermiso: boolean } | null>(null);

  // Datos del ticket de cuenta. Los mismos se guardan al cobrar para poder reimprimirlo igual.
  function datosTicket(cuenta: Cuenta, desc: { etiqueta: string; monto: number } | null, hora: string) {
    const consumo = totalCuenta(cuenta.pedidos);
    return {
      cuenta: nombreCuenta(cuenta),
      fecha: `${diaMX()} ${hora}`,
      renglones: agruparProductos(cuenta).map((it) => ({
        cantidad: it.unidad === "KG" ? `${it.cantidad.toFixed(3)}kg` : `${it.cantidad}x`,
        nombre: it.nombre,
        importe: dinero(it.subtotal),
      })),
      total: dinero(consumo - (desc?.monto ?? 0)),
      subtotal: desc ? dinero(consumo) : undefined,
      descuento: desc ? { etiqueta: desc.etiqueta, monto: `-${dinero(desc.monto)}` } : undefined,
      cortesia: !!desc && consumo - desc.monto <= 0,
    };
  }

  // Ticket de cuenta: por la impresora Bluetooth de caja si hay una configurada;
  // si no, con la ventana de impresión del navegador.
  async function iniciarImpresion(cuenta: Cuenta, reconectar = false) {
    if (cuenta.estado !== "CUENTA_SOLICITADA") return;
    const consumo = totalCuenta(cuenta.pedidos);
    const desc = cuenta.id === seleccionada?.id && codigo ? { etiqueta: etiquetaCodigo(codigo), monto: calcularDescuento(codigo, consumo) } : null;
    setTicketDescuento(desc);
    const hora = horaActualMX();
    setHoraTicket(hora);
    setTicketCuenta(cuenta);

    if (!reconectar && estadoImpresoras("caja").impresoras.length === 0) {
      setOrdenImpresion((n) => n + 1);
      return;
    }

    const bytes = bytesTicketCuenta(datosTicket(cuenta, desc, hora));
    try {
      if (reconectar) await elegirImpresora("caja");
      await imprimir("caja", bytes);
      setErrorImpresion(null);
    } catch (e) {
      setErrorImpresion({
        cuenta,
        mensaje: e instanceof Error ? e.message : "Error al imprimir.",
        sinPermiso: e instanceof ErrorImpresion && (e.fallidas.length === 0 || e.fallidas.some((f) => f.sinPermiso)),
      });
    }
  }

  // No se borra el ticket tras imprimir: en iPhone/Android window.print() no espera
  // y si se quita el ticket, la vista previa sale en blanco.
  useEffect(() => {
    if (ordenImpresion === 0) return;
    const timer = setTimeout(() => window.print(), 300);
    return () => clearTimeout(timer);
  }, [ordenImpresion]);

  const productosAgrupados = useMemo(() => agruparProductos(ticketCuenta), [ticketCuenta]);

  async function cobrar() {
    if (!seleccionada) return;

    if (metodo === "EFECTIVO" && montoRecibido > 0 && montoRecibido < totalFinalCobro) {
      alert("El monto recibido en efectivo no cubre el total de la cuenta.");
      return;
    }

    // Registra el pago y cierra la cuenta en un solo paso (función cobrar_cuenta de la base):
    // guarda método, total, redondeo y fecha de cierre, que es lo que lee Reportes.
    if (!esCortesia && metodo === "TARJETA" && !referenciaClip.trim()) {
      alert("Escribe la referencia del comprobante de Clip.");
      return;
    }
    setCargando(true);
    // Ticket original (el que se le dio al cliente, o uno con la hora del cobro si no se imprimió)
    const original = datosTicket(
      seleccionada,
      codigo ? { etiqueta: etiquetaCodigo(codigo), monto: descuento } : null,
      ticketCuenta?.id === seleccionada.id && horaTicket ? horaTicket : horaActualMX()
    );
    const { error: updateError } = await supabase.rpc("cobrar_cuenta_v2", {
      p_cuenta_id: seleccionada.id,
      p_metodo: metodo,
      p_redondeo: redondeo,
      p_codigo: codigo?.codigo ?? null,
      p_referencia: metodo === "TARJETA" ? referenciaClip.trim() : null,
      p_propina: metodo === "TARJETA" ? Number(propina) || 0 : 0,
      p_recibido: metodo === "EFECTIVO" && montoRecibido > 0 ? montoRecibido : null,
    });

    setCargando(false);

    if (updateError) {
      alert(`Error al registrar el cobro: ${updateError.message}`);
      return;
    }
    // Se guarda el ticket para reimprimirlo igual desde Admin (si falla, el cobro ya quedó)
    await supabase.from("cuentas").update({ ticket: original }).eq("id", seleccionada.id);

    setCuentaIdSeleccionada(null);
    setPagoCon("");
    await cargar();
  }

  // ---------- Cuentas en $0: solo se cancelan (desaparecen sin registro) ----------
  async function cancelarCuentaCero() {
    if (!seleccionada) return;
    if (!window.confirm(`¿Cancelar ${nombreCuenta(seleccionada)}? No tiene productos y desaparecerá del sistema.`)) return;
    setCargando(true);
    const { error } = await supabase.rpc("cancelar_cuenta_vacia", { p_cuenta_id: seleccionada.id });
    setCargando(false);
    if (error) return alert(`No se pudo cancelar: ${error.message}`);
    setCuentaIdSeleccionada(null);
    await cargar();
  }

  const pidioCuentaSeleccionada = seleccionada?.estado === "CUENTA_SOLICITADA";

  const ETIQUETA_METODO: Record<MetodoPago, string> = {
    EFECTIVO: "Efectivo",
    TARJETA: "Tarjeta",
    TRANSFERENCIA: "Transferencia",
    PREFERENTE: "Preferente",
    CORTESIA: "Cortesía",
  };

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6">
      <Conexion conectado={conectado} />

      <div className="flex flex-wrap items-start gap-3">
        <div className="w-full max-w-md">
          <BotonImpresora destino="caja" />
        </div>
        {/* El corte (totales del día) solo aparece con la caja cerrada, para que el
            cajero no pueda calcular el efectivo esperado antes de contar */}
        {estadoCaja?.estado === "CERRADA" && <CorteCaja />}
      </div>
      <ControlCaja onCambio={setEstadoCaja} />

      {errorCarga && (
        <div className="rounded-xl bg-paliacate-claro px-4 py-3 text-sm text-paliacate-oscuro">
          <strong>No se pudieron cargar las cuentas:</strong> {errorCarga}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_400px]">
        {/* Lista de cuentas por cobrar */}
        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-2xl font-bold">Cuentas abiertas</h2>
            <span className="text-sm text-cafe-medio">
              {cuentas.length} {cuentas.length === 1 ? "cuenta" : "cuentas"}
            </span>
          </div>

          {cuentas.length === 0 ? (
            <p className="rounded-2xl border-2 border-dashed border-borde px-4 py-12 text-center text-cafe-medio">
              No hay cuentas con consumo en este momento.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cuentas.map((c) => {
                const total = totalCuenta(c.pedidos);
                const activo = seleccionada?.id === c.id;
                const pidioCuenta = c.estado === "CUENTA_SOLICITADA";

                return (
                  <button
                    key={c.id}
                    onClick={() => setCuentaIdSeleccionada(c.id)}
                    className={`flex flex-col justify-between rounded-2xl border-2 p-4 text-left transition-colors ${
                      activo
                        ? "border-cafe bg-cafe text-crema"
                        : pidioCuenta
                        ? "border-paliacate bg-white hover:bg-paliacate-claro/50"
                        : "border-borde bg-white hover:border-cafe-medio"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-display text-xl font-bold">{nombreCuenta(c)}</span>
                      {pidioCuenta && (
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                            activo ? "bg-queso text-cafe" : "bg-paliacate text-white"
                          }`}
                        >
                          Pide cuenta
                        </span>
                      )}
                    </div>
                    <div className="mt-5 flex items-end justify-between">
                      <span className={`text-xs ${activo ? "text-crema/70" : "text-cafe-medio"}`}>
                        {c.pedidos?.length || 0} {(c.pedidos?.length || 0) === 1 ? "ronda" : "rondas"}
                      </span>
                      <span className="font-display text-2xl font-bold tabular-nums">{dinero(total)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {cuentasCero.length > 0 && (
            <div className="space-y-3 pt-4">
              <div className="flex items-baseline justify-between">
                <h2 className="font-display text-xl font-bold">Cuentas en $0</h2>
                <span className="text-sm text-cafe-medio">Se cancelaron sus rondas: solo se pueden cancelar</span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {cuentasCero.map((c) => {
                  const activo = seleccionada?.id === c.id;
                  return (
                    <button
                      key={c.id}
                      onClick={() => setCuentaIdSeleccionada(c.id)}
                      className={`flex items-center justify-between rounded-2xl border-2 border-dashed p-4 text-left ${
                        activo ? "border-cafe bg-cafe text-crema" : "border-borde bg-white hover:border-cafe-medio"
                      }`}
                    >
                      <span className="font-display text-lg font-bold">{nombreCuenta(c)}</span>
                      <span className="font-display text-xl font-bold tabular-nums">{dinero(0)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        {/* Panel de cobro */}
        <section className="h-fit rounded-2xl border border-borde bg-white lg:sticky lg:top-4">
          {!seleccionada ? (
            <div className="px-6 py-16 text-center text-cafe-medio">
              <p className="font-display text-lg font-bold text-cafe">Selecciona una cuenta</p>
              <p className="mt-1 text-sm">Aquí verás el total, el ticket y el cobro.</p>
            </div>
          ) : totalCalculado === 0 ? (
            <div className="space-y-4 px-5 py-6">
              <div>
                <p className="text-sm text-cafe-medio">{nombreCuenta(seleccionada)}</p>
                <p className="font-display text-5xl font-extrabold tabular-nums leading-tight">{dinero(0)}</p>
              </div>
              <p className="rounded-xl bg-queso-claro px-4 py-3 text-sm">
                Esta cuenta se quedó sin productos (se cancelaron sus rondas). No hay nada que cobrar.
              </p>
              <button
                disabled={cargando}
                onClick={cancelarCuentaCero}
                className="w-full rounded-xl bg-paliacate py-4 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-paliacate-oscuro disabled:opacity-40"
              >
                {cargando ? "Cancelando…" : "Cancelar cuenta"}
              </button>
            </div>
          ) : (
            <div>
              <div className="border-b border-borde px-5 py-4">
                <p className="text-sm text-cafe-medio">{nombreCuenta(seleccionada)}</p>
                <p className="font-display text-5xl font-extrabold tabular-nums leading-tight">
                  {dinero(totalFinalCobro)}
                </p>
                {metodo === "EFECTIVO" && redondeo !== 0 && (
                  <p className="text-xs text-cafe-medio">
                    Redondeado desde {dinero(totalCalculado)} (efectivo, a 50 centavos)
                  </p>
                )}
              </div>

              <div className="space-y-5 px-5 py-5">
                {errorImpresion && (
                  <div className="space-y-2 rounded-xl border-2 border-paliacate bg-paliacate-claro p-3 text-sm text-paliacate-oscuro">
                    <p>
                      <strong>No se imprimió el ticket.</strong> {errorImpresion.mensaje}
                    </p>
                    <div className="flex gap-2">
                      <button
                        className="flex-1 rounded-lg bg-paliacate py-2 font-semibold text-white"
                        onClick={() => iniciarImpresion(errorImpresion.cuenta, errorImpresion.sinPermiso)}
                      >
                        {errorImpresion.sinPermiso ? "Conectar e imprimir" : "Reintentar"}
                      </button>
                      <button
                        className="rounded-lg border border-paliacate/40 px-3 font-semibold"
                        onClick={() => {
                          setErrorImpresion(null);
                          setOrdenImpresion((n) => n + 1);
                        }}
                      >
                        Usar ventana
                      </button>
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  disabled={!pidioCuentaSeleccionada}
                  onClick={() => iniciarImpresion(seleccionada)}
                  className={`w-full rounded-xl border-2 py-3 font-semibold transition-colors ${
                    pidioCuentaSeleccionada
                      ? "border-cafe text-cafe hover:bg-crema"
                      : "cursor-not-allowed border-borde text-cafe/40"
                  }`}
                >
                  {pidioCuentaSeleccionada ? "Imprimir ticket de cuenta" : "Esperando que el mesero pida la cuenta"}
                </button>

                {/* Código de descuento (opcional) */}
                <div className="space-y-2">
                  <span className="text-sm font-semibold">Código de descuento (opcional)</span>
                  {codigo ? (
                    <div className="flex items-center justify-between rounded-xl bg-hoja-claro px-4 py-3">
                      <span>
                        <strong className="block">{etiquetaCodigo(codigo)}</strong>
                        <span className="text-sm">
                          {dinero(totalCalculado)} − {dinero(descuento)} = <strong>{dinero(totalConDescuento)}</strong>
                        </span>
                      </span>
                      <button onClick={() => setCodigo(null)} className="text-sm font-semibold text-paliacate underline-offset-2 hover:underline">
                        Quitar
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        value={codigoTexto}
                        onChange={(e) => setCodigoTexto(e.target.value.toUpperCase())}
                        placeholder="Ej. K7M2PX"
                        autoCapitalize="characters"
                        autoComplete="off"
                        maxLength={10}
                        className="min-w-0 flex-1 rounded-xl border border-borde bg-white px-3 py-2.5 font-display text-lg font-bold uppercase tracking-[0.2em] focus:border-cafe focus:outline-none"
                      />
                      <button
                        disabled={revisandoCodigo || codigoTexto.trim().length < 6}
                        onClick={aplicarCodigo}
                        className="rounded-xl border-2 border-cafe px-4 font-semibold text-cafe hover:bg-crema disabled:opacity-40"
                      >
                        {revisandoCodigo ? "…" : "Aplicar"}
                      </button>
                    </div>
                  )}
                </div>

                {!esCortesia && (
                <div className="space-y-2">
                  <span className="text-sm font-semibold">Método de pago</span>
                  <div className="grid grid-cols-3 gap-1 rounded-xl bg-crema-oscuro p-1">
                    {(["EFECTIVO", "TARJETA", "TRANSFERENCIA"] as MetodoPago[]).map((m) => (
                      <button
                        key={m}
                        onClick={() => setMetodo(m)}
                        className={`rounded-lg py-2.5 text-sm font-semibold transition-colors ${
                          metodo === m ? "bg-white text-cafe shadow-sm" : "text-cafe-medio hover:text-cafe"
                        }`}
                      >
                        {ETIQUETA_METODO[m]}
                      </button>
                    ))}
                  </div>
                </div>

                )}

                {!esCortesia && metodo === "TARJETA" && (
                  <div className="space-y-3 rounded-xl bg-queso-claro p-4">
                    <p className="text-xs text-cafe-medio">Cobra primero en la terminal Clip. Ya aprobado, copia la referencia del comprobante.</p>
                    <label className="block">
                      <span className="text-sm font-semibold">Referencia del comprobante Clip</span>
                      <input
                        value={referenciaClip}
                        onChange={(e) => setReferenciaClip(e.target.value)}
                        inputMode="numeric"
                        autoComplete="off"
                        className="mt-1 w-full rounded-xl border border-borde bg-white px-3 py-2.5 font-display text-xl font-bold tracking-wider focus:border-cafe focus:outline-none"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm font-semibold">Propina en la terminal (opcional)</span>
                      <div className="relative mt-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold text-cafe-medio">$</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={propina}
                          onChange={(e) => setPropina(e.target.value)}
                          className="w-full rounded-xl border border-borde bg-white py-2.5 pl-7 pr-3 font-display text-xl font-bold tabular-nums focus:border-cafe focus:outline-none"
                        />
                      </div>
                    </label>
                  </div>
                )}

                {!esCortesia && metodo === "EFECTIVO" && (
                  <div className="space-y-3 rounded-xl bg-queso-claro p-4">
                    <label className="block">
                      <span className="text-sm font-semibold">Recibido</span>
                      <div className="relative mt-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-lg font-bold text-cafe-medio">$</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={pagoCon}
                          onChange={(e) => setPagoCon(e.target.value)}
                          className="w-full rounded-xl border border-borde bg-white py-3 pl-8 pr-3 font-display text-2xl font-bold tabular-nums focus:border-cafe focus:outline-none"
                        />
                      </div>
                    </label>

                    <div className="grid grid-cols-4 gap-2">
                      {[50, 100, 200, 500].map((b) => (
                        <button
                          key={b}
                          type="button"
                          onClick={() => setPagoCon(String(b))}
                          className="rounded-lg border border-borde bg-white py-2 text-sm font-semibold hover:border-cafe-medio"
                        >
                          ${b}
                        </button>
                      ))}
                    </div>

                    <div className="flex items-baseline justify-between border-t border-queso/60 pt-3">
                      <span className="text-sm font-semibold">{faltaDinero ? "Faltan" : "Cambio"}</span>
                      <span
                        className={`font-display text-3xl font-extrabold tabular-nums ${
                          faltaDinero ? "text-paliacate" : cambio > 0 ? "text-hoja" : "text-cafe"
                        }`}
                      >
                        {faltaDinero ? dinero(totalFinalCobro - montoRecibido) : dinero(cambio)}
                      </span>
                    </div>
                  </div>
                )}

                <button
                  disabled={
                    cargando ||
                    (!esCortesia && (faltaDinero || (metodo === "TARJETA" && !referenciaClip.trim()) || (metodo === "EFECTIVO" && !cajaAbierta)))
                  }
                  onClick={cobrar}
                  className="w-full rounded-xl bg-paliacate py-4 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-paliacate-oscuro disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {cargando ? "Procesando…" : esCortesia ? "Cerrar como cortesía" : `Cobrar ${dinero(totalFinalCobro)}`}
                </button>
                {!esCortesia && metodo === "EFECTIVO" && !cajaAbierta && (
                  <p className="text-center text-sm text-paliacate">
                    {estadoCaja?.estado === "CERRADA" ? "La caja de hoy ya se cerró: cobra con tarjeta o transferencia." : "Abre la caja (arriba) para cobrar en efectivo."}
                  </p>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* TICKET DE CUENTA FORMATEADO */}
      {ticketCuenta && (
        <div
          id="ticket-cuenta"
          style={{
            position: "relative",
            minHeight: "380px",
            overflow: "hidden",
            boxSizing: "border-box",
          }}
        >
          {/* MARCA DE AGUA */}
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              opacity: 0.35,
              pointerEvents: "none",
              zIndex: 0,
              width: "190px",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <img
              src="/logo.png"
              alt="Marca de agua"
              style={{
                width: "100%",
                height: "auto",
                objectFit: "contain",
                filter: "grayscale(100%) contrast(140%)",
                WebkitFilter: "grayscale(100%) contrast(140%)",
              }}
              onError={(e) => {
                (e.target as HTMLElement).style.display = "none";
              }}
            />
          </div>

          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ textAlign: "center", borderBottom: "1px dashed #000", paddingBottom: "6px" }}>
              <h1 style={{ margin: "0", fontSize: "18px", fontWeight: "900", letterSpacing: "0.5px" }}>
                LOS MENONITAS
              </h1>
              {DATOS_LOCAL.map((l) => (
                <p key={l} style={{ margin: "1px 0", fontSize: "11px", lineHeight: "1.2" }}>
                  {l}
                </p>
              ))}
              <div style={{ marginTop: "6px", borderTop: "1px dotted #000", paddingTop: "4px" }}>
                <p style={{ margin: "1px 0", fontSize: "14px", fontWeight: "bold" }}>
                  {nombreCuenta(ticketCuenta)}
                </p>
                <p style={{ margin: "1px 0", fontSize: "11px" }}>
                  Fecha: {diaMX()} · {horaTicket || horaActualMX()}
                </p>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: "11px",
                fontWeight: "bold",
                borderBottom: "1px solid #000",
                padding: "4px 2px",
                marginTop: "4px",
              }}
            >
              <span style={{ width: "20%" }}>CANT</span>
              <span style={{ width: "50%" }}>DESCRIPCIÓN</span>
              <span style={{ width: "30%", textAlign: "right" }}>IMPORTE</span>
            </div>

            <div style={{ margin: "6px 0" }}>
              {productosAgrupados.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: "12px",
                    marginBottom: "4px",
                    lineHeight: "1.2",
                    padding: "0 2px",
                  }}
                >
                  <span style={{ width: "20%", fontWeight: "bold" }}>
                    {item.unidad === "KG" ? item.cantidad.toFixed(3) : `${item.cantidad}x`}
                  </span>
                  <span style={{ width: "50%", wordBreak: "break-word" }}>
                    {item.nombre}
                  </span>
                  <span style={{ width: "30%", textAlign: "right", fontWeight: "bold" }}>
                    {dinero(item.subtotal)}
                  </span>
                </div>
              ))}
            </div>

            <div style={{ borderTop: "1px dashed #000", paddingTop: "6px", padding: "6px 2px 0 2px" }}>
              {ticketDescuento && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span>Subtotal:</span>
                    <span>{dinero(totalCuenta(ticketCuenta.pedidos))}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
                    <span>{ticketDescuento.etiqueta}:</span>
                    <span>-{dinero(ticketDescuento.monto)}</span>
                  </div>
                </>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "16px", fontWeight: "900" }}>
                <span>TOTAL:</span>
                <span>{dinero(totalCuenta(ticketCuenta.pedidos) - (ticketDescuento?.monto ?? 0))}</span>
              </div>
              {ticketDescuento && totalCuenta(ticketCuenta.pedidos) - ticketDescuento.monto <= 0 && (
                <p style={{ margin: "6px 0 0 0", fontSize: "13px", fontWeight: "900", textAlign: "center" }}>
                  CORTESIA: SIN COBRO
                </p>
              )}
              <p style={{ margin: "2px 0 0 0", fontSize: "10px", color: "#333", textAlign: "right" }}>
                (Consumo total de {ticketCuenta.pedidos?.length || 0} rondas)
              </p>
            </div>

            <div style={{ borderTop: "1px dotted #000", marginTop: "10px", paddingTop: "6px", textAlign: "center", fontSize: "11px" }}>
              <p style={{ margin: "2px 0", fontWeight: "bold" }}>¡Gracias por su visita y preferencia!</p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
