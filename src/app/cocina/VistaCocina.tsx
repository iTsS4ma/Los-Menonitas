"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Conexion from "@/components/Conexion";
import { useTiempoReal } from "@/hooks/useTiempoReal";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { cantidadTexto, diaMX, minutosDesde, nombreCuenta } from "@/lib/formato";
import type { Pedido } from "@/lib/tipos";

export default function VistaCocina() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [ahora, setAhora] = useState(Date.now());
  const [ticketActual, setTicketActual] = useState<Pedido | null>(null);
  const [impresionActiva, setImpresionActiva] = useState(false);

  // Registro de rondas para controlar qué se imprime
  const idsProcesadosRef = useRef<Set<string>>(new Set());
  const inicializadoRef = useRef(false);

  // Cola: si llegan varias rondas juntas, se imprimen todas en orden
  const [cola, setCola] = useState<Pedido[]>([]);
  const imprimirComanda = (pedido: Pedido) => {
    setCola((prev) => [...prev, pedido]);
  };

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from("pedidos")
      .select("*, cuentas(*, mesas(numero)), detalle_pedido(*)")
      .in("estado", ["ENVIADO", "PREPARANDO"])
      .order("creado_en");

    if (data) {
      const lista = data as Pedido[];
      setPedidos(lista);

      // En la primera carga registramos los existentes para no imprimir pedidos viejos
      if (!inicializadoRef.current) {
        lista.forEach((p) => idsProcesadosRef.current.add(p.id));
        inicializadoRef.current = true;
        return;
      }

      // Si entra una orden nueva que no esté registrada
      const nuevos = lista.filter((p) => !idsProcesadosRef.current.has(p.id));
      nuevos.forEach((nuevo) => {
        idsProcesadosRef.current.add(nuevo.id);
        imprimirComanda(nuevo);
      });
    }
  }, [supabase]);

  const conectado = useTiempoReal("cocina", ["pedidos", "detalle_pedido"], cargar);

  // El ticket no se borra al imprimir (en celulares window.print() no espera);
  // se reemplaza por el siguiente de la cola.
  useEffect(() => {
    if (cola.length === 0) return;
    setTicketActual(cola[0]);
    const timer = setTimeout(() => {
      window.print();
      setCola((prev) => prev.slice(1));
    }, 300);
    return () => clearTimeout(timer);
  }, [cola]);

  // Actualiza minutos transcurridos cada 10s
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  async function marcarListo(pedido: Pedido) {
    // 1. Quitar visualmente de inmediato para respuesta ágil
    setPedidos((prev) => prev.filter((p) => p.id !== pedido.id));

    // 2. Si el pedido sigue en ENVIADO, transicionar primero por PREPARANDO
    if (pedido.estado === "ENVIADO") {
      const { error: errPreparando } = await supabase
        .from("pedidos")
        .update({ estado: "PREPARANDO" })
        .eq("id", pedido.id);

      if (errPreparando) {
        console.error("Error al pasar a PREPARANDO:", errPreparando);
        alert(`Error al guardar en base de datos: ${errPreparando.message}`);
        await cargar();
        return;
      }
    }

    // 3. Transicionar al estado final LISTO
    const { error: errListo } = await supabase
      .from("pedidos")
      .update({ estado: "LISTO" })
      .eq("id", pedido.id);

    if (errListo) {
      console.error("Error al pasar a LISTO:", errListo);
      alert(`Error al guardar en base de datos: ${errListo.message}`);
      await cargar();
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 p-4">
      <Conexion conectado={conectado} />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div>
          <h1 className="text-2xl font-bold">Cocina</h1>
          <span className="text-sm text-slate-500">
            {pedidos.length} {pedidos.length === 1 ? "pedido pendiente" : "pedidos pendientes"}
          </span>
        </div>

        {!impresionActiva ? (
          <button
            onClick={() => setImpresionActiva(true)}
            className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-orange-700"
          >
            🔔 Activar auto-impresión y alertas
          </button>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Auto-impresión lista
          </span>
        )}
      </div>

      {pedidos.length === 0 ? (
        <div className="py-20 text-center text-slate-500">
          No hay órdenes pendientes en este momento.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pedidos.map((p) => {
            const minutos = minutosDesde(p.creado_en, ahora);
            const esLlevar = p.cuentas?.tipo === "PARA_LLEVAR";

            return (
              <div
                key={p.id}
                className={`flex flex-col justify-between rounded-xl border-2 bg-white p-4 shadow-sm ${
                  minutos >= 15
                    ? "border-rose-500 ring-1 ring-rose-500"
                    : esLlevar
                    ? "border-amber-500"
                    : "border-slate-200"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between border-b pb-2">
                    <span className="text-xl font-bold text-slate-900">
                      {p.cuentas ? nombreCuenta(p.cuentas) : "Sin cuenta"}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-bold ${
                        minutos >= 15
                          ? "bg-rose-100 text-rose-700"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {minutos} min
                    </span>
                  </div>

                  <p className="mt-1 text-xs text-slate-500">Ronda #{p.numero_ronda}</p>

                  <ul className="mt-3 space-y-2">
                    {p.detalle_pedido
                      ?.filter((d) => d.estado === "ACTIVO")
                      .map((d) => (
                        <li key={d.id} className="text-sm">
                          <div className="font-semibold text-slate-800">
                            {cantidadTexto(d)} {d.nombre_producto}
                            {d.nombre_opcion ? ` (${d.nombre_opcion})` : ""}
                          </div>
                          {d.notas && (
                            <p className="mt-0.5 rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-900">
                              Nota: {d.notas}
                            </p>
                          )}
                        </li>
                      ))}
                  </ul>
                </div>

                <div className="mt-6 space-y-2 border-t pt-3">
                  <button
                    type="button"
                    onClick={() => imprimirComanda(p)}
                    className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
                  >
                    🖨️ Reimprimir ticket
                  </button>

                  <button
                    onClick={() => marcarListo(p)}
                    className="w-full rounded-lg bg-emerald-600 py-3 text-lg font-bold text-white transition hover:bg-emerald-700 active:scale-[0.99]"
                  >
                    ¡Listo para entregar!
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Ticket térmico formateado para impresión */}
      {ticketActual && (
        <div id="ticket-impresion">
          <div style={{ textAlign: "center", borderBottom: "2px dashed #000", paddingBottom: "6px", marginBottom: "8px" }}>
            <h1 style={{ margin: "0", fontSize: "22px", fontWeight: "900", letterSpacing: "0.5px" }}>
              {ticketActual.cuentas ? nombreCuenta(ticketActual.cuentas) : "COMANDA"}
            </h1>
            <p style={{ margin: "4px 0 0 0", fontSize: "14px", fontWeight: "bold" }}>
              Ronda #{ticketActual.numero_ronda} · {diaMX()}
            </p>
          </div>

          <div style={{ margin: "10px 0" }}>
            {ticketActual.detalle_pedido
              ?.filter((d) => d.estado === "ACTIVO")
              .map((d) => (
                <div key={d.id} style={{ marginBottom: "10px" }}>
                  <div style={{ fontWeight: "bold", fontSize: "16px" }}>
                    {cantidadTexto(d)} {d.nombre_producto}
                    {d.nombre_opcion ? ` (${d.nombre_opcion})` : ""}
                  </div>
                  {d.notas && (
                    <div style={{ fontSize: "13px", fontWeight: "bold", fontStyle: "italic", marginLeft: "12px", marginTop: "2px" }}>
                      * {d.notas}
                    </div>
                  )}
                </div>
              ))}
          </div>

          <div style={{ borderTop: "2px dashed #000", paddingTop: "6px", textAlign: "center", fontSize: "12px", fontWeight: "bold" }}>
            --- FIN COMANDA ---
          </div>
        </div>
      )}
    </main>
  );
}