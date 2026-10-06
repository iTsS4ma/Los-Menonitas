"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Conexion from "@/components/Conexion";
import { useTiempoReal } from "@/hooks/useTiempoReal";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { diaMX, dinero, nombreCuenta, totalCuenta } from "@/lib/formato";
import type { Cuenta, Pedido, Mesa } from "@/lib/tipos";

// Cuenta cerrada con los campos extra que guarda la base al cobrar
type CuentaCerrada = Cuenta & {
  mesa_id?: string | null;
  mesero_id?: string | null;
  cerrada_en?: string | null;
  total_final?: number | null;
  metodo_pago?: string | null;
};

type ProductoVendido = {
  nombre: string;
  unidad: "PIEZA" | "KG";
  cantidad: number;
  importe: number;
};

const ETIQUETA_METODO: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TARJETA: "Tarjeta",
  TRANSFERENCIA: "Transferencia",
  PREFERENTE: "Preferente",
};

// Día (YYYY-MM-DD) en hora de CDMX, para que las ventas de la noche no caigan en el día siguiente
const diaDe = (fecha: string) => new Date(fecha).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });

export default function PaginaAdmin() {
  const supabase = useMemo(() => crearClienteNavegador(), []);

  const [fechaDesde, setFechaDesde] = useState<string>("");
  const [fechaHasta, setFechaHasta] = useState<string>("");

  const [cuentasCerradas, setCuentasCerradas] = useState<CuentaCerrada[]>([]);
  const [nombres, setNombres] = useState<Map<string, string>>(new Map());
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState("");

  const [ordenProductos, setOrdenProductos] = useState<"importe" | "cantidad">("importe");
  const [verTodos, setVerTodos] = useState(false);

  const cargarDatos = useCallback(async () => {
    setCargando(true);

    try {
      // 1. Mesas y personal (para mostrar número de mesa y nombre del mesero)
      const [resMesas, resUsuarios] = await Promise.all([
        supabase.from("mesas").select("*"),
        supabase.from("usuarios").select("id, nombre"),
      ]);
      const mapaMesas = new Map<string, Mesa>();
      ((resMesas.data || []) as Mesa[]).forEach((m) => mapaMesas.set(m.id, m));
      const mapaNombres = new Map<string, string>();
      ((resUsuarios.data || []) as { id: string; nombre: string }[]).forEach((u) => mapaNombres.set(u.id, u.nombre));
      setNombres(mapaNombres);

      // 2. Solo cuentas cobradas
      const { data: dataCuentas, error: errCuentas } = await supabase
        .from("cuentas")
        .select("*")
        .eq("estado", "CERRADA");

      if (errCuentas) {
        setErrorCarga(errCuentas.message || "Error al leer cuentas");
        return;
      }

      // 3. Filtro de fechas (por día de cobro, hora CDMX)
      const cuentasRaw = ((dataCuentas || []) as CuentaCerrada[]).filter((c) => {
        const ref = c.cerrada_en || c.abierta_en;
        if (!ref) return true;
        const dia = diaDe(ref);
        if (fechaDesde && dia < fechaDesde) return false;
        if (fechaHasta && dia > fechaHasta) return false;
        return true;
      });

      if (cuentasRaw.length === 0) {
        setCuentasCerradas([]);
        setErrorCarga("");
        return;
      }

      // 4. Pedidos y productos de esas cuentas
      const { data: dataPedidos } = await supabase
        .from("pedidos")
        .select("*, detalle_pedido(*)")
        .in("cuenta_id", cuentasRaw.map((c) => c.id));
      const pedidos = (dataPedidos || []) as Pedido[];

      const completas: CuentaCerrada[] = cuentasRaw
        .map((c) => ({
          ...c,
          mesas: c.mesa_id ? mapaMesas.get(c.mesa_id) ?? null : null,
          pedidos: pedidos.filter((p) => p.cuenta_id === c.id),
        }))
        .sort((a, b) => String(b.cerrada_en || b.abierta_en).localeCompare(String(a.cerrada_en || a.abierta_en)));

      setCuentasCerradas(completas);
      setErrorCarga("");
    } catch (err) {
      setErrorCarga(err instanceof Error ? err.message : "Error al conectar con la base de datos");
    } finally {
      setCargando(false);
    }
  }, [supabase, fechaDesde, fechaHasta]);

  const conectado = useTiempoReal("admin", ["cuentas", "pedidos", "detalle_pedido"], cargarDatos);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const totalDe = (c: CuentaCerrada) => Number(c.total_final ?? totalCuenta(c.pedidos));

  // Totales por método
  const resumen = useMemo(() => {
    const r = { total: 0, cobradas: 0, EFECTIVO: 0, TARJETA: 0, TRANSFERENCIA: 0, PREFERENTE: 0, preferentes: 0 };
    cuentasCerradas.forEach((c) => {
      const monto = totalDe(c);
      // Preferente: se consumió pero no se cobró; no suma a lo vendido
      if (c.metodo_pago === "PREFERENTE") {
        r.PREFERENTE += monto;
        r.preferentes += 1;
        return;
      }
      r.total += monto;
      r.cobradas += 1;
      const metodo = (c.metodo_pago ?? "EFECTIVO") as keyof typeof r;
      if (metodo === "EFECTIVO" || metodo === "TARJETA" || metodo === "TRANSFERENCIA") r[metodo] += monto;
    });
    return r;
  }, [cuentasCerradas]);

  // Productos más vendidos (solo rondas y productos no cancelados)
  const productos = useMemo(() => {
    const mapa = new Map<string, ProductoVendido>();
    cuentasCerradas.forEach((c) =>
      c.pedidos
        .filter((p) => p.estado !== "CANCELADO")
        .forEach((p) =>
          p.detalle_pedido
            .filter((d) => d.estado === "ACTIVO")
            .forEach((d) => {
              const nombre = `${d.nombre_producto}${d.nombre_opcion ? ` (${d.nombre_opcion})` : ""}`;
              const previo = mapa.get(nombre) ?? { nombre, unidad: d.unidad, cantidad: 0, importe: 0 };
              previo.cantidad += Number(d.cantidad);
              previo.importe += Number(d.importe);
              mapa.set(nombre, previo);
            })
        )
    );
    return [...mapa.values()].sort((a, b) =>
      ordenProductos === "importe" ? b.importe - a.importe : b.cantidad - a.cantidad
    );
  }, [cuentasCerradas, ordenProductos]);

  const maxBarra = Math.max(1, ...productos.map((p) => (ordenProductos === "importe" ? p.importe : p.cantidad)));
  const productosVisibles = verTodos ? productos : productos.slice(0, 10);
  const cantidadTexto = (p: ProductoVendido) =>
    p.unidad === "KG" ? `${p.cantidad.toFixed(3)} kg` : `${p.cantidad} pz`;

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

      {/* Encabezado y filtros */}
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

      {/* Totales */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-2xl bg-cafe p-5 text-crema">
          <span className="text-sm text-crema/75">Vendido</span>
          <p className="mt-1 font-display text-3xl font-extrabold tabular-nums">{dinero(resumen.total)}</p>
          <span className="text-xs text-crema/60">
            {resumen.cobradas} {resumen.cobradas === 1 ? "cuenta cobrada" : "cuentas cobradas"}
          </span>
        </div>
        {(["EFECTIVO", "TARJETA", "TRANSFERENCIA"] as const).map((m) => (
          <div key={m} className="rounded-2xl border border-borde bg-white p-5">
            <span className="text-sm text-cafe-medio">{ETIQUETA_METODO[m]}</span>
            <p className="mt-1 font-display text-2xl font-bold tabular-nums">{dinero(resumen[m])}</p>
          </div>
        ))}
        <div className="rounded-2xl border border-dashed border-cafe/40 bg-crema p-5">
          <span className="text-sm text-cafe-medio">Preferente (sin cobro)</span>
          <p className="mt-1 font-display text-2xl font-bold tabular-nums">{dinero(resumen.PREFERENTE)}</p>
          <span className="text-xs text-cafe-medio">
            {resumen.preferentes} {resumen.preferentes === 1 ? "cuenta" : "cuentas"} · no suma a lo vendido
          </span>
        </div>
      </div>

      {/* Productos más vendidos */}
      <div className="overflow-hidden rounded-2xl border border-borde bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-borde px-5 py-3">
          <h2 className="font-display text-lg font-bold">Productos más vendidos</h2>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-crema-oscuro p-1 text-sm">
            {(["importe", "cantidad"] as const).map((o) => (
              <button
                key={o}
                onClick={() => setOrdenProductos(o)}
                className={`rounded-md px-3 py-1 font-semibold ${
                  ordenProductos === o ? "bg-white text-cafe shadow-sm" : "text-cafe-medio hover:text-cafe"
                }`}
              >
                {o === "importe" ? "Por dinero" : "Por cantidad"}
              </button>
            ))}
          </div>
        </div>

        {cargando ? (
          <div className="py-10 text-center text-sm text-cafe-medio">Cargando…</div>
        ) : productos.length === 0 ? (
          <div className="py-10 text-center text-sm text-cafe-medio">No hay productos vendidos en este periodo.</div>
        ) : (
          <>
            <ol className="divide-y divide-borde/70">
              {productosVisibles.map((p, i) => {
                const valor = ordenProductos === "importe" ? p.importe : p.cantidad;
                return (
                  <li key={p.nombre} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-5 py-2.5">
                    <span className="text-right font-display font-bold text-cafe-medio tabular-nums">{i + 1}</span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{p.nombre}</p>
                      <div className="mt-1 h-2 rounded-full bg-crema-oscuro">
                        <div
                          className={`h-2 rounded-full ${i === 0 ? "bg-paliacate" : "bg-queso"}`}
                          style={{ width: `${Math.max(3, (valor / maxBarra) * 100)}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right tabular-nums">
                      <p className="font-display font-bold">
                        {ordenProductos === "importe" ? dinero(p.importe) : cantidadTexto(p)}
                      </p>
                      <p className="text-xs text-cafe-medio">
                        {ordenProductos === "importe" ? cantidadTexto(p) : dinero(p.importe)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {productos.length > 10 && (
              <button
                onClick={() => setVerTodos((v) => !v)}
                className="w-full border-t border-borde py-2.5 text-sm font-semibold text-cafe-medio hover:bg-crema/60 hover:text-cafe"
              >
                {verTodos ? "Ver solo los 10 primeros" : `Ver los ${productos.length} productos`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Cuentas cobradas */}
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
                  <th className="px-5 py-3">Mesero</th>
                  <th className="px-5 py-3">Método</th>
                  <th className="px-5 py-3">Rondas</th>
                  <th className="px-5 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borde/70">
                {cuentasCerradas.map((c) => {
                  const fecha = c.cerrada_en || c.abierta_en;
                  const fechaFormateada = fecha
                    ? new Date(fecha).toLocaleString("es-MX", {
                        timeZone: "America/Mexico_City",
                        dateStyle: "short",
                        timeStyle: "short",
                        hour12: true,
                      })
                    : "—";
                  const metodo = c.metodo_pago ?? "EFECTIVO";
                  const mesero = c.mesero_id ? nombres.get(c.mesero_id) ?? "Usuario eliminado" : "—";

                  return (
                    <tr key={c.id} className="hover:bg-crema/50">
                      <td className="whitespace-nowrap px-5 py-3 tabular-nums text-cafe-medio">{fechaFormateada}</td>
                      <td className="px-5 py-3 font-semibold">{nombreCuenta(c)}</td>
                      <td className="px-5 py-3">{mesero}</td>
                      <td className="px-5 py-3">
                        <span className="rounded-full bg-crema-oscuro px-2.5 py-0.5 text-xs font-semibold">
                          {ETIQUETA_METODO[metodo] ?? metodo}
                        </span>
                      </td>
                      <td className="px-5 py-3 tabular-nums">{c.pedidos?.length || 0}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right font-display font-bold tabular-nums">
                        {dinero(totalDe(c))}
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
