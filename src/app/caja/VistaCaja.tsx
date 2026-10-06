"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Conexion from "@/components/Conexion";
import { useTiempoReal } from "@/hooks/useTiempoReal";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { diaMX, dinero, nombreCuenta, totalCuenta } from "@/lib/formato";
import type { Cuenta, MetodoPago, DetallePedido, Mesa, Pedido } from "@/lib/tipos";
import BotonImpresora from "@/components/BotonImpresora";
import { elegirImpresora, ErrorImpresion, estadoImpresoras, imprimir, ticketCuenta as bytesTicketCuenta, DATOS_LOCAL } from "@/lib/impresoraBT";

type ItemAgrupado = {
  nombre: string;
  cantidad: number;
  unidad: string;
  precio_unitario: number;
  subtotal: number;
};

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
  const [codigoPreferente, setCodigoPreferente] = useState("");
  const [ticketPreferente, setTicketPreferente] = useState(false);
  const [cuentaIdSeleccionada, setCuentaIdSeleccionada] = useState<string | null>(cuentaInicial);
  const [metodo, setMetodo] = useState<MetodoPago>("EFECTIVO");
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

  // Preferente y tarjeta: sin redondeo
  const { total: totalFinalCobro, redondeo } = useMemo(() => {
    return metodo === "EFECTIVO"
      ? calcularRedondeo50Centavos(totalCalculado)
      : { total: totalCalculado, redondeo: 0 };
  }, [totalCalculado, metodo]);

  const montoRecibido = Number(pagoCon) || 0;
  const cambio = Math.max(0, Number((montoRecibido - totalFinalCobro).toFixed(2)));
  const faltaDinero = metodo === "EFECTIVO" && montoRecibido > 0 && montoRecibido < totalFinalCobro;

  useEffect(() => {
    setPagoCon("");
    setCodigoPreferente("");
  }, [cuentaIdSeleccionada, metodo]);

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

  const [errorImpresion, setErrorImpresion] = useState<{ cuenta: Cuenta; mensaje: string; sinPermiso: boolean; preferente?: boolean } | null>(null);

  // Ticket de cuenta: por la impresora Bluetooth de caja si hay una configurada;
  // si no, con la ventana de impresión del navegador.
  async function iniciarImpresion(cuenta: Cuenta, reconectar = false, preferente = false) {
    if (cuenta.estado !== "CUENTA_SOLICITADA" && !preferente) return;
    setTicketPreferente(preferente);
    const hora = horaActualMX();
    setHoraTicket(hora);
    setTicketCuenta(cuenta);

    if (!reconectar && estadoImpresoras("caja").impresoras.length === 0) {
      setOrdenImpresion((n) => n + 1);
      return;
    }

    const bytes = bytesTicketCuenta({
      cuenta: nombreCuenta(cuenta),
      fecha: `${diaMX()} ${hora}`,
      renglones: agruparProductos(cuenta).map((it) => ({
        cantidad: it.unidad === "KG" ? `${it.cantidad.toFixed(3)}kg` : `${it.cantidad}x`,
        nombre: it.nombre,
        importe: dinero(it.subtotal),
      })),
      total: dinero(totalCuenta(cuenta.pedidos)),
      preferente,
    });
    try {
      if (reconectar) await elegirImpresora("caja", true);
      await imprimir("caja", bytes);
      setErrorImpresion(null);
    } catch (e) {
      setErrorImpresion({
        cuenta,
        mensaje: e instanceof Error ? e.message : "Error al imprimir.",
        preferente,
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

    setCargando(true);

    // Registra el pago y cierra la cuenta en un solo paso (función cobrar_cuenta de la base):
    // guarda método, total, redondeo y fecha de cierre, que es lo que lee Reportes.
    const { error: updateError } = await supabase.rpc("cobrar_cuenta", {
      p_cuenta_id: seleccionada.id,
      p_metodo: metodo,
      p_total: totalFinalCobro,
      p_redondeo: redondeo,
    });

    setCargando(false);

    if (updateError) {
      alert(`Error al registrar el cobro: ${updateError.message}`);
      return;
    }

    setCuentaIdSeleccionada(null);
    setPagoCon("");
    await cargar();
  }

  // ---------- Preferente: cuenta sin cobro con contraseña de un solo uso ----------
  async function cerrarPreferente() {
    if (!seleccionada || !codigoPreferente.trim()) return;
    setCargando(true);
    const { error } = await supabase.rpc("cobrar_preferente", {
      p_cuenta_id: seleccionada.id,
      p_codigo: codigoPreferente,
    });
    setCargando(false);
    if (error) {
      alert(error.message.includes("inválida") ? "Contraseña Preferente inválida o ya usada." : `Error: ${error.message}`);
      return;
    }
    const cerrada = seleccionada;
    setCodigoPreferente("");
    setCuentaIdSeleccionada(null);
    await cargar();
    iniciarImpresion(cerrada, false, true); // ticket con la leyenda "PREFERENTE: SIN COBRO"
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
  };

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6">
      <Conexion conectado={conectado} />

      <div className="max-w-md">
        <BotonImpresora destino="caja" titulo="Impresora de tickets (caja)" />
      </div>

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
                        onClick={() => iniciarImpresion(errorImpresion.cuenta, errorImpresion.sinPermiso, errorImpresion.preferente)}
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

                <div className="space-y-2">
                  <span className="text-sm font-semibold">Método de pago</span>
                  <div className="grid grid-cols-2 gap-1 rounded-xl bg-crema-oscuro p-1 sm:grid-cols-4">
                    {(["EFECTIVO", "TARJETA", "TRANSFERENCIA", "PREFERENTE"] as MetodoPago[]).map((m) => (
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

                {metodo === "EFECTIVO" && (
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

                {metodo === "PREFERENTE" ? (
                  <div className="space-y-3 rounded-xl border-2 border-cafe/20 bg-crema p-4">
                    <label className="block">
                      <span className="text-sm font-semibold">Contraseña Preferente</span>
                      <input
                        value={codigoPreferente}
                        onChange={(e) => setCodigoPreferente(e.target.value.toUpperCase())}
                        placeholder="Ej. K7M2PX"
                        autoCapitalize="characters"
                        autoComplete="off"
                        maxLength={10}
                        className="mt-1 w-full rounded-xl border border-borde bg-white px-3 py-3 text-center font-display text-2xl font-bold uppercase tracking-[0.3em] focus:border-cafe focus:outline-none"
                      />
                    </label>
                    <p className="text-xs text-cafe-medio">
                      La cuenta se cierra sin cobro y el consumo queda registrado. Cada contraseña sirve una sola vez.
                    </p>
                    <button
                      disabled={cargando || codigoPreferente.trim().length < 6}
                      onClick={cerrarPreferente}
                      className="w-full rounded-xl bg-cafe py-4 text-lg font-semibold text-crema shadow-sm transition-colors hover:bg-cafe/90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {cargando ? "Validando…" : "Validar y cerrar sin cobro"}
                    </button>
                  </div>
                ) : (
                  <button
                    disabled={cargando || faltaDinero}
                    onClick={cobrar}
                    className="w-full rounded-xl bg-paliacate py-4 text-lg font-semibold text-white shadow-sm transition-colors hover:bg-paliacate-oscuro disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {cargando ? "Procesando…" : `Cobrar ${dinero(totalFinalCobro)}`}
                  </button>
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
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "16px", fontWeight: "900" }}>
                <span>{ticketPreferente ? "CONSUMO:" : "TOTAL:"}</span>
                <span>{dinero(totalCuenta(ticketCuenta.pedidos))}</span>
              </div>
              {ticketPreferente && (
                <p style={{ margin: "6px 0 0 0", fontSize: "13px", fontWeight: "900", textAlign: "center" }}>
                  PREFERENTE: SIN COBRO
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