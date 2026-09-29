"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Conexion from "@/components/Conexion";
import { useTiempoReal } from "@/hooks/useTiempoReal";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { diaMX, dinero, nombreCuenta, totalCuenta } from "@/lib/formato";
import type { Cuenta, MetodoPago, DetallePedido, Mesa, Pedido } from "@/lib/tipos";

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

export default function VistaCaja({ cuentaInicial = null }: { cuentaInicial?: string | null }) {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [cuentas, setCuentas] = useState<Cuenta[]>([]);
  const [cuentaIdSeleccionada, setCuentaIdSeleccionada] = useState<string | null>(cuentaInicial);
  const [metodo, setMetodo] = useState<MetodoPago>("EFECTIVO");
  const [ticketCuenta, setTicketCuenta] = useState<Cuenta | null>(null);
  const [horaTicket, setHoraTicket] = useState<string>("");
  const [cargando, setCargando] = useState(false);
  const [errorCarga, setErrorCarga] = useState("");

  // Control de efectivo y cambio
  const [pagoCon, setPagoCon] = useState<string>("");

  const seleccionada = useMemo(
    () => cuentas.find((c) => c.id === cuentaIdSeleccionada) || null,
    [cuentas, cuentaIdSeleccionada]
  );

  const totalCalculado = useMemo(() => {
    if (!seleccionada) return 0;
    return totalCuenta(seleccionada.pedidos);
  }, [seleccionada]);

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

    const mapaPorMesa = new Map<string, Cuenta>();
    const cuentasParaLlevar: Cuenta[] = [];

    cuentasCompletas.forEach((c) => {
      const total = totalCuenta(c.pedidos);

      if (c.tipo === "PARA_LLEVAR" || !c.mesa_id) {
        if (total > 0 || (c.pedidos && c.pedidos.length > 0)) {
          cuentasParaLlevar.push(c);
        }
      } else {
        const existente = mapaPorMesa.get(c.mesa_id);
        if (!existente) {
          mapaPorMesa.set(c.mesa_id, c);
        } else {
          if (c.estado === "CUENTA_SOLICITADA" && existente.estado !== "CUENTA_SOLICITADA") {
            mapaPorMesa.set(c.mesa_id, c);
          } else {
            const totalExistente = totalCuenta(existente.pedidos);
            if (total > totalExistente) {
              mapaPorMesa.set(c.mesa_id, c);
            }
          }
        }
      }
    });

    const listaFinal = [
      ...Array.from(mapaPorMesa.values()).filter((c) => totalCuenta(c.pedidos) > 0),
      ...cuentasParaLlevar,
    ].sort((a, b) => {
      const numA = a.mesas?.numero ?? 999;
      const numB = b.mesas?.numero ?? 999;
      return numA - numB;
    });

    setErrorCarga("");
    setCuentas(listaFinal);
  }, [supabase]);

  const conectado = useTiempoReal("caja", ["cuentas", "pedidos", "detalle_pedido"], cargar);

  const iniciarImpresion = (cuenta: Cuenta) => {
    if (cuenta.estado !== "CUENTA_SOLICITADA") return;
    setHoraTicket(horaActualMX());
    setTicketCuenta(cuenta);
  };

  useEffect(() => {
    if (ticketCuenta) {
      const timer = setTimeout(() => {
        window.print();
        setTicketCuenta(null);
      }, 250);
      return () => clearTimeout(timer);
    }
  }, [ticketCuenta]);

  const productosAgrupados = useMemo(() => {
    if (!ticketCuenta) return [];

    const mapa = new Map<string, ItemAgrupado>();

    ticketCuenta.pedidos?.forEach((p) => {
      p.detalle_pedido
        ?.filter((d: any) => d.estado === "ACTIVO" || !d.estado)
        .forEach((d: any) => {
          const nombreCompleto = `${d.nombre_producto || "Producto"}${d.nombre_opcion ? ` (${d.nombre_opcion})` : ""}`;
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

          const sub =
            d.subtotal !== undefined && !isNaN(Number(d.subtotal))
              ? Number(d.subtotal)
              : cant * pu;

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
  }, [ticketCuenta]);

  async function cobrar() {
    if (!seleccionada) return;

    if (metodo === "EFECTIVO" && montoRecibido > 0 && montoRecibido < totalFinalCobro) {
      alert("El monto recibido en efectivo no cubre el total de la cuenta.");
      return;
    }

    setCargando(true);

    // 1. Intentar registrar en pagos de manera opcional (si la tabla existe)
    await supabase.from("pagos").insert({
      cuenta_id: seleccionada.id,
      metodo: metodo,
      total: totalFinalCobro,
      redondeo: redondeo,
    });

    // 2. Cerrar la cuenta actualizando únicamente el estado (columna universal)
    const { error: updateError } = await supabase
      .from("cuentas")
      .update({
        estado: "CERRADA",
      })
      .eq("id", seleccionada.id);

    setCargando(false);

    if (updateError) {
      alert(`Error al registrar el cobro: ${updateError.message}`);
      return;
    }

    setCuentaIdSeleccionada(null);
    setPagoCon("");
    await cargar();
  }

  const pidioCuentaSeleccionada = seleccionada?.estado === "CUENTA_SOLICITADA";

  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 p-4">
      <Conexion conectado={conectado} />

      <div className="flex items-center justify-between border-b pb-3">
        <h1 className="text-2xl font-bold">Caja</h1>
        <span className="text-sm text-slate-500">
          {cuentas.length} {cuentas.length === 1 ? "cuenta activa" : "cuentas activas"}
        </span>
      </div>

      {errorCarga && (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          <strong>Error en Caja:</strong> {errorCarga}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Lista de cuentas por cobrar */}
        <section className="space-y-3 lg:col-span-2">
          <h2 className="text-lg font-semibold text-slate-800">Cuentas activas en comedor</h2>
          {cuentas.length === 0 ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-slate-500">
              No hay cuentas abiertas con consumo actualmente.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {cuentas.map((c) => {
                const total = totalCuenta(c.pedidos);
                const activo = seleccionada?.id === c.id;
                const pidioCuenta = c.estado === "CUENTA_SOLICITADA";

                return (
                  <button
                    key={c.id}
                    onClick={() => setCuentaIdSeleccionada(c.id)}
                    className={`flex flex-col justify-between rounded-xl border-2 p-4 text-left transition-all ${
                      activo
                        ? "border-blue-600 bg-blue-50/70 ring-2 ring-blue-500 shadow-md scale-[1.01]"
                        : pidioCuenta
                        ? "border-amber-400 bg-amber-50/70 hover:border-amber-500"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-lg font-bold ${activo ? "text-blue-950" : "text-slate-900"}`}>
                        {nombreCuenta(c)}
                      </span>
                      {pidioCuenta && (
                        <span className="rounded-full bg-amber-200/80 px-2.5 py-0.5 text-xs font-black tracking-wide text-amber-900 shadow-sm animate-pulse">
                          🔔 Pide cuenta
                        </span>
                      )}
                    </div>
                    <div className="mt-4 flex items-end justify-between border-t border-slate-200/70 pt-2">
                      <span className={`text-xs ${activo ? "text-blue-700 font-medium" : "text-slate-500"}`}>
                        {c.pedidos?.length || 0} rondas
                      </span>
                      <span className={`text-xl font-black ${activo ? "text-blue-700" : "text-slate-900"}`}>
                        {dinero(total)}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Panel de detalle y cobro */}
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="border-b pb-3 text-lg font-semibold text-slate-800">Detalle de Cobro</h2>

          {!seleccionada ? (
            <p className="py-12 text-center text-sm text-slate-400">
              Selecciona una cuenta para ver el desglose, imprimir ticket o cobrar.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="flex justify-between text-base font-bold">
                <span className="text-blue-900">{nombreCuenta(seleccionada)}</span>
                <span className="text-blue-700">{dinero(totalFinalCobro)}</span>
              </div>

              {/* Botón de impresión */}
              <div className="space-y-1">
                <button
                  type="button"
                  disabled={!pidioCuentaSeleccionada}
                  onClick={() => iniciarImpresion(seleccionada)}
                  className={`w-full rounded-lg border py-2.5 text-sm font-semibold transition active:scale-[0.99] ${
                    pidioCuentaSeleccionada
                      ? "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100 shadow-sm cursor-pointer"
                      : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  {pidioCuentaSeleccionada
                    ? "🖨️ Imprimir ticket de cuenta"
                    : "⏳ Esperando solicitud de cuenta (Mesero)"}
                </button>
              </div>

              {/* Método de pago */}
              <div className="space-y-2 border-t pt-3">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Método de pago
                </span>
                <div className="grid grid-cols-3 gap-2 text-xs font-semibold">
                  {(["EFECTIVO", "TARJETA", "TRANSFERENCIA"] as MetodoPago[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => setMetodo(m)}
                      className={`rounded-lg border py-2 capitalize transition ${
                        metodo === m
                          ? "border-blue-600 bg-blue-600 text-white font-bold"
                          : "border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                      }`}
                    >
                      {m.toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Calculadora de Efectivo y Cambio */}
              {metodo === "EFECTIVO" && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5 space-y-3">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-600">
                    <span>Efectivo recibido:</span>
                    <span className="text-slate-400">Total: {dinero(totalFinalCobro)}</span>
                  </div>

                  <div className="relative">
                    <span className="absolute left-3 top-2 text-slate-400 font-bold">$</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={pagoCon}
                      onChange={(e) => setPagoCon(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-7 pr-3 text-lg font-bold text-slate-900 shadow-inner focus:border-blue-500 focus:outline-none"
                    />
                  </div>

                  {/* Atajos de billetes */}
                  <div className="grid grid-cols-4 gap-1.5 text-xs font-bold">
                    {[50, 100, 200, 500].map((b) => (
                      <button
                        key={b}
                        type="button"
                        onClick={() => setPagoCon(String(b))}
                        className="rounded border border-slate-200 bg-white py-1.5 text-slate-700 hover:bg-slate-100 shadow-sm"
                      >
                        ${b}
                      </button>
                    ))}
                  </div>

                  {/* Desglose de cambio */}
                  <div className="border-t border-amber-200/80 pt-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600">Cambio a entregar:</span>
                    <span
                      className={`text-lg font-black ${
                        faltaDinero
                          ? "text-rose-600"
                          : cambio > 0
                          ? "text-emerald-700"
                          : "text-slate-700"
                      }`}
                    >
                      {faltaDinero ? `Faltan ${dinero(totalFinalCobro - montoRecibido)}` : dinero(cambio)}
                    </span>
                  </div>
                </div>
              )}

              <button
                disabled={cargando || faltaDinero}
                onClick={cobrar}
                className="w-full rounded-lg bg-emerald-600 py-3 text-lg font-bold text-white shadow transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {cargando ? "Procesando..." : "Confirmar Cobro"}
              </button>
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
              <p style={{ margin: "3px 0 1px 0", fontSize: "11px", lineHeight: "1.2" }}>
                Norte 72, 3540 colonia la joya
              </p>
              <p style={{ margin: "1px 0", fontSize: "11px" }}>
                CP 07890, GAM, CDMX
              </p>
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
                <span>TOTAL:</span>
                <span>{dinero(totalCuenta(ticketCuenta.pedidos))}</span>
              </div>
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