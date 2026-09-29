"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Conexion from "@/components/Conexion";
import { useTiempoReal } from "@/hooks/useTiempoReal";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { diaMX, dinero, nombreCuenta, totalCuenta } from "@/lib/formato";
import type { Cuenta, Pedido, Mesa } from "@/lib/tipos";

type ResumenVentas = {
  totalIngresos: number;
  totalCuentas: number;
  totalEfectivo: number;
  totalTarjeta: number;
  totalTransferencia: number;
};

export default function PaginaAdmin() {
  const supabase = useMemo(() => crearClienteNavegador(), []);

  const [fechaDesde, setFechaDesde] = useState<string>("");
  const [fechaHasta, setFechaHasta] = useState<string>("");

  const [cuentasCerradas, setCuentasCerradas] = useState<Cuenta[]>([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState("");

  const cargarDatos = useCallback(async () => {
    setCargando(true);

    try {
      // 1. Cargar mesas
      const resMesas = await supabase.from("mesas").select("*");
      const listaMesas = (resMesas.data || []) as Mesa[];
      const mapaMesas = new Map<string, Mesa>();
      listaMesas.forEach((m) => mapaMesas.set(m.id, m));

      // 2. Cargar todas las cuentas (tanto abiertas como cerradas)
      const { data: dataCuentas, error: errCuentas } = await supabase
        .from("cuentas")
        .select("*");

      if (errCuentas) {
        console.error("Detalle exacto error cuentas:", JSON.stringify(errCuentas, null, 2));
        setErrorCarga(errCuentas.message || "Error de permisos (RLS) al leer cuentas en Supabase");
        setCargando(false);
        return;
      }

      // Filtrar únicamente las cuentas que fueron cobradas / cerradas
      const cuentasRaw = ((dataCuentas || []) as any[]).filter(
        (c) => c.estado === "CERRADA"
      ) as (Cuenta & { mesa_id?: string | null })[];

      if (cuentasRaw.length === 0) {
        setCuentasCerradas([]);
        setErrorCarga("");
        setCargando(false);
        return;
      }

      // 3. Cargar pedidos asociados
      const idsCuentas = cuentasRaw.map((c) => c.id);
      const resPedidos = await supabase
        .from("pedidos")
        .select("*, detalle_pedido(*)")
        .in("cuenta_id", idsCuentas);

      const pedidosList = (resPedidos.data || []) as Pedido[];

      // 4. Vincular mesas y pedidos
      const cuentasCompletas: Cuenta[] = cuentasRaw.map((c) => ({
        ...c,
        mesas: c.mesa_id ? mapaMesas.get(c.mesa_id) ?? null : null,
        pedidos: pedidosList.filter((p) => p.cuenta_id === c.id),
      }));

      // 5. Filtrar por rango de fechas solo si el usuario especificó alguna
      const filtradas = cuentasCompletas.filter((c: any) => {
        const fechaReferencia = c.cerrado_en || c.creado_en || c.created_at;
        if (!fechaReferencia) return true;

        const fechaDia = fechaReferencia.split("T")[0];
        if (fechaDesde && fechaDia < fechaDesde) return false;
        if (fechaHasta && fechaDia > fechaHasta) return false;
        return true;
      });

      setCuentasCerradas(filtradas);
      setErrorCarga("");
    } catch (err: any) {
      console.error("Excepción en admin:", err);
      setErrorCarga(err?.message || "Error al conectar con la base de datos");
    } finally {
      setCargando(false);
    }
  }, [supabase, fechaDesde, fechaHasta]);

  const conectado = useTiempoReal("admin", ["cuentas", "pedidos", "detalle_pedido"], cargarDatos);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  // Totales
  const resumen: ResumenVentas = useMemo(() => {
    let totalIngresos = 0;
    let totalEfectivo = 0;
    let totalTarjeta = 0;
    let totalTransferencia = 0;

    cuentasCerradas.forEach((c: any) => {
      const monto = Number(c.total_final ?? c.total ?? totalCuenta(c.pedidos));
      totalIngresos += monto;

      const metodo = c.metodo_pago ?? "EFECTIVO";
      if (metodo === "EFECTIVO") totalEfectivo += monto;
      else if (metodo === "TARJETA") totalTarjeta += monto;
      else if (metodo === "TRANSFERENCIA") totalTransferencia += monto;
    });

    return {
      totalIngresos,
      totalCuentas: cuentasCerradas.length,
      totalEfectivo,
      totalTarjeta,
      totalTransferencia,
    };
  }, [cuentasCerradas]);

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 p-4">
      <Conexion conectado={conectado} />

      <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Panel de Administración</h1>
          <p className="text-sm text-slate-500">Historial completo desde la primera venta registrada</p>
        </div>

        {/* Filtros de fecha */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <span>Desde:</span>
            <input
              type="date"
              value={fechaDesde}
              onChange={(e) => setFechaDesde(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
            <span>Hasta:</span>
            <input
              type="date"
              value={fechaHasta}
              onChange={(e) => setFechaHasta(e.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm focus:border-blue-500 focus:outline-none"
            />
          </div>

          <button
            onClick={() => {
              setFechaDesde("");
              setFechaHasta("");
            }}
            className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-100"
          >
            Ver todo el histórico
          </button>
        </div>
      </div>

      {errorCarga && (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          <strong>Aviso:</strong> {errorCarga}
        </div>
      )}

      {/* Tarjetas de Métricas Globales */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Ventas Totales</span>
          <p className="mt-1 text-2xl font-black text-slate-900">{dinero(resumen.totalIngresos)}</p>
          <span className="text-xs text-slate-400">{resumen.totalCuentas} cuentas cobradas</span>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">Efectivo</span>
          <p className="mt-1 text-2xl font-black text-emerald-700">{dinero(resumen.totalEfectivo)}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-blue-600">Tarjeta</span>
          <p className="mt-1 text-2xl font-black text-blue-700">{dinero(resumen.totalTarjeta)}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">Transferencia</span>
          <p className="mt-1 text-2xl font-black text-indigo-700">{dinero(resumen.totalTransferencia)}</p>
        </div>
      </div>

      {/* Tabla de registros */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b px-5 py-3">
          <h2 className="text-base font-bold text-slate-800">
            Registro de Cuentas Cobradas ({cuentasCerradas.length})
          </h2>
        </div>

        {cargando ? (
          <div className="py-12 text-center text-sm text-slate-400">Cargando registros...</div>
        ) : cuentasCerradas.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">
            No hay registros de ventas finalizadas en el sistema todavía.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-700">
              <thead className="border-b bg-slate-50 text-xs font-bold uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-3">Fecha y Hora</th>
                  <th className="px-5 py-3">Cuenta / Mesa</th>
                  <th className="px-5 py-3">Método</th>
                  <th className="px-5 py-3">Rondas</th>
                  <th className="px-5 py-3 text-right">Total Cobrado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cuentasCerradas.map((c: any) => {
                  const fechaStr = c.cerrado_en || c.creado_en || c.created_at;
                  const fechaFormateada = fechaStr
                    ? new Date(fechaStr).toLocaleString("es-MX", {
                        dateStyle: "short",
                        timeStyle: "short",
                        hour12: true,
                      })
                    : diaMX();

                  const total = Number(c.total_final ?? c.total ?? totalCuenta(c.pedidos));
                  const metodo = c.metodo_pago ?? "EFECTIVO";

                  return (
                    <tr key={c.id} className="hover:bg-slate-50/60">
                      <td className="whitespace-nowrap px-5 py-3 font-mono text-xs">{fechaFormateada}</td>
                      <td className="px-5 py-3 font-semibold text-slate-900">{nombreCuenta(c)}</td>
                      <td className="px-5 py-3">
                        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                          {metodo}
                        </span>
                      </td>
                      <td className="px-5 py-3">{c.pedidos?.length || 0}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right font-bold text-slate-900">
                        {dinero(total)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}