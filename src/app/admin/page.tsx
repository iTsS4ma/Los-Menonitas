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
        const fechaReferencia = c.cerrada_en || c.abierta_en;
        if (!fechaReferencia) return true;

        // Día en hora de CDMX (evita que ventas de la noche caigan en el día siguiente)
        const fechaDia = new Date(fechaReferencia).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
        if (fechaDesde && fechaDia < fechaDesde) return false;
        if (fechaHasta && fechaDia > fechaHasta) return false;
        return true;
      });

      filtradas.sort((a: any, b: any) =>
        String(b.cerrada_en || b.abierta_en).localeCompare(String(a.cerrada_en || a.abierta_en))
      );
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

  const ETIQUETA_METODO: Record<string, string> = {
    EFECTIVO: "Efectivo",
    TARJETA: "Tarjeta",
    TRANSFERENCIA: "Transferencia",
  };

  const hoy = diaMX();
  const rango = (desde: string, hasta: string) => {
    setFechaDesde(desde);
    setFechaHasta(hasta);
  };

  const inputFecha =
    "rounded-lg border border-borde bg-white px-2.5 py-2 text-sm text-cafe focus:border-cafe focus:outline-none";

  return (
    <div className="space-y-6">
      <Conexion conectado={conectado} />

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Ventas</h1>
          <p className="text-sm text-cafe-medio">
            {fechaDesde || fechaHasta ? "Periodo filtrado" : "Todo el histórico"}
          </p>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <button
            onClick={() => rango(hoy, hoy)}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
              fechaDesde === hoy && fechaHasta === hoy ? "border-cafe bg-cafe text-crema" : "border-borde bg-white hover:border-cafe-medio"
            }`}
          >
            Hoy
          </button>
          <label className="text-xs font-semibold text-cafe-medio">
            Desde
            <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} className={`block ${inputFecha}`} />
          </label>
          <label className="text-xs font-semibold text-cafe-medio">
            Hasta
            <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} className={`block ${inputFecha}`} />
          </label>
          <button
            onClick={() => rango("", "")}
            className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
              !fechaDesde && !fechaHasta ? "border-cafe bg-cafe text-crema" : "border-borde bg-white hover:border-cafe-medio"
            }`}
          >
            Todo
          </button>
        </div>
      </div>

      {errorCarga && (
        <div className="rounded-xl bg-paliacate-claro px-4 py-3 text-sm text-paliacate-oscuro">
          <strong>No se pudieron cargar las ventas:</strong> {errorCarga}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl bg-cafe p-5 text-crema">
          <span className="text-sm text-crema/75">Vendido</span>
          <p className="mt-1 font-display text-3xl font-extrabold tabular-nums">{dinero(resumen.totalIngresos)}</p>
          <span className="text-xs text-crema/60">
            {resumen.totalCuentas} {resumen.totalCuentas === 1 ? "cuenta cobrada" : "cuentas cobradas"}
          </span>
        </div>
        {[
          ["Efectivo", resumen.totalEfectivo],
          ["Tarjeta", resumen.totalTarjeta],
          ["Transferencia", resumen.totalTransferencia],
        ].map(([texto, monto]) => (
          <div key={texto as string} className="rounded-2xl border border-borde bg-white p-5">
            <span className="text-sm text-cafe-medio">{texto}</span>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums">{dinero(monto as number)}</p>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-2xl border border-borde bg-white">
        <div className="border-b border-borde px-5 py-3">
          <h2 className="font-display text-lg font-bold">Cuentas cobradas ({cuentasCerradas.length})</h2>
        </div>

        {cargando ? (
          <div className="py-12 text-center text-sm text-cafe-medio">Cargando ventas…</div>
        ) : cuentasCerradas.length === 0 ? (
          <div className="py-12 text-center text-sm text-cafe-medio">No hay ventas en este periodo.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-borde bg-crema/60 text-xs font-semibold text-cafe-medio">
                <tr>
                  <th className="px-5 py-3">Fecha y hora</th>
                  <th className="px-5 py-3">Cuenta</th>
                  <th className="px-5 py-3">Método</th>
                  <th className="px-5 py-3">Rondas</th>
                  <th className="px-5 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borde/70">
                {cuentasCerradas.map((c: any) => {
                  const fechaStr = c.cerrada_en || c.abierta_en;
                  const fechaFormateada = fechaStr
                    ? new Date(fechaStr).toLocaleString("es-MX", {
                        timeZone: "America/Mexico_City",
                        dateStyle: "short",
                        timeStyle: "short",
                        hour12: true,
                      })
                    : diaMX();

                  const total = Number(c.total_final ?? c.total ?? totalCuenta(c.pedidos));
                  const metodo = c.metodo_pago ?? "EFECTIVO";

                  return (
                    <tr key={c.id} className="hover:bg-crema/50">
                      <td className="whitespace-nowrap px-5 py-3 tabular-nums text-cafe-medio">{fechaFormateada}</td>
                      <td className="px-5 py-3 font-semibold">{nombreCuenta(c)}</td>
                      <td className="px-5 py-3">
                        <span className="rounded-full bg-crema-oscuro px-2.5 py-0.5 text-xs font-semibold">
                          {ETIQUETA_METODO[metodo] ?? metodo}
                        </span>
                      </td>
                      <td className="px-5 py-3 tabular-nums">{c.pedidos?.length || 0}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right font-display font-bold tabular-nums">
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
    </div>
  );
}
