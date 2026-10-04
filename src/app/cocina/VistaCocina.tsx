"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Conexion from "@/components/Conexion";
import { useTiempoReal } from "@/hooks/useTiempoReal";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { cantidadTexto, minutosDesde, nombreCuenta } from "@/lib/formato";
import type { Pedido } from "@/lib/tipos";

export default function VistaCocina() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [ahora, setAhora] = useState(Date.now());

  const cargar = useCallback(async () => {
    const { data } = await supabase
      .from("pedidos")
      .select("*, cuentas!inner(*, mesas(numero)), detalle_pedido(*, productos(descripcion))")
      .in("estado", ["ENVIADO", "PREPARANDO"])
      // Solo rondas de cuentas que siguen abiertas (al cobrar, desaparecen de esta pantalla)
      .in("cuentas.estado", ["ABIERTA", "CUENTA_SOLICITADA"])
      .order("creado_en");

    if (data) {
      const lista = data as Pedido[];
      setPedidos(lista);
    }
  }, [supabase]);

  const conectado = useTiempoReal("cocina", ["pedidos", "detalle_pedido"], cargar);

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
                          {d.productos?.descripcion && (
                            <p className="text-xs text-slate-500">{d.productos.descripcion}</p>
                          )}
                          {d.con_quesillo && (
                            <p className="mt-0.5 inline-block rounded bg-yellow-200 px-2 py-0.5 text-xs font-bold text-slate-900">
                              + CON QUESILLO
                            </p>
                          )}
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
                    onClick={() => marcarListo(p)}
                    className="w-full rounded-lg bg-emerald-600 py-3 text-lg font-bold text-white transition hover:bg-emerald-700 active:scale-[0.99]"
                  >
                    Listo (quitar de pantalla)
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
