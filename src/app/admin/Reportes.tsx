"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { diaMX, dinero, errorTexto } from "@/lib/formato";

type Diaria = { dia: string; tipo: string; metodo: string; cuentas: number; cobrado: number; redondeo: number };
type PorProducto = { dia: string; nombre_producto: string; nombre_opcion: string | null; unidad: string; cantidad: number; importe: number };
type PorHora = { dia: string; hora: number; cuentas: number; cobrado: number };
type PorMesero = { dia: string; mesero: string; cuentas: number; cobrado: number };

function sumarPor<T>(filas: T[], clave: (f: T) => string, valor: (f: T) => number) {
  const m = new Map<string, number>();
  filas.forEach((f) => m.set(clave(f), (m.get(clave(f)) ?? 0) + Number(valor(f))));
  return [...m.entries()].map(([nombre, total]) => ({ nombre, total }));
}

function restarDias(dia: string, n: number) {
  const d = new Date(`${dia}T12:00:00-06:00`);
  d.setDate(d.getDate() - n);
  return diaMX(d);
}

export default function Reportes() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const hoy = diaMX();
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [diarias, setDiarias] = useState<Diaria[]>([]);
  const [productos, setProductos] = useState<PorProducto[]>([]);
  const [horas, setHoras] = useState<PorHora[]>([]);
  const [meseros, setMeseros] = useState<PorMesero[]>([]);
  const [criterioProductos, setCriterioProductos] = useState<"IMPORTE" | "CANTIDAD">("IMPORTE");
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const rango = <Q extends { gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(q: Q) =>
      q.gte("dia", desde).lte("dia", hasta);
    const [d, p, h, m] = await Promise.all([
      rango(supabase.from("v_ventas_diarias").select("*")),
      rango(supabase.from("v_ventas_por_producto").select("*")),
      rango(supabase.from("v_ventas_por_hora").select("*")),
      rango(supabase.from("v_ventas_por_mesero").select("*")),
    ]);
    const e = d.error || p.error || h.error || m.error;
    if (e) return setError(errorTexto(e));
    setError("");
    setDiarias(d.data as Diaria[]);
    setProductos(p.data as PorProducto[]);
    setHoras(h.data as PorHora[]);
    setMeseros(m.data as PorMesero[]);
  }, [supabase, desde, hasta]);

  useEffect(() => {
    const t = setTimeout(cargar, 0);
    return () => clearTimeout(t);
  }, [cargar]);

  const total = diarias.reduce((s, f) => s + Number(f.cobrado), 0);
  const numCuentas = diarias.reduce((s, f) => s + Number(f.cuentas), 0);
  const redondeo = diarias.reduce((s, f) => s + Number(f.redondeo), 0);

  const porDia = sumarPor(diarias, (f) => f.dia, (f) => f.cobrado).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const porMetodo = sumarPor(diarias, (f) => f.metodo, (f) => f.cobrado);
  const porTipo = sumarPor(diarias, (f) => (f.tipo === "MESA" ? "Mesa" : "Para llevar"), (f) => f.cobrado);
  const porHora = sumarPor(horas, (f) => `${String(f.hora).padStart(2, "0")}:00`, (f) => f.cobrado).sort((a, b) => a.nombre.localeCompare(b.nombre));
  const porMesero = sumarPor(meseros, (f) => f.mesero, (f) => f.cobrado).sort((a, b) => b.total - a.total);

  const tablaProductos = useMemo(() => {
    const m = new Map<string, { nombre: string; unidad: string; cantidad: number; importe: number }>();
    productos.forEach((f) => {
      const nombre = f.nombre_producto + (f.nombre_opcion ? ` (${f.nombre_opcion})` : "");
      const x = m.get(nombre) ?? { nombre, unidad: f.unidad, cantidad: 0, importe: 0 };
      x.cantidad += Number(f.cantidad);
      x.importe += Number(f.importe);
      m.set(nombre, x);
    });
    return [...m.values()].sort((a, b) => b.importe - a.importe);
  }, [productos]);

  const datosGraficaProductos = useMemo(() => {
    const copia = [...tablaProductos];
    if (criterioProductos === "CANTIDAD") {
      copia.sort((a, b) => b.cantidad - a.cantidad);
      return copia.slice(0, 10).map((p) => ({
        nombre: p.nombre,
        total: Math.round(p.cantidad * 1000) / 1000,
        unidad: p.unidad,
      }));
    }
    copia.sort((a, b) => b.importe - a.importe);
    return copia.slice(0, 10).map((p) => ({
      nombre: p.nombre,
      total: p.importe,
      unidad: p.unidad,
    }));
  }, [tablaProductos, criterioProductos]);

  const rapido = (dias: number) => { setDesde(restarDias(hoy, dias)); setHasta(hoy); };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-2">
        <button className="rounded border px-3 py-2" onClick={() => rapido(0)}>Hoy</button>
        <button className="rounded border px-3 py-2" onClick={() => rapido(6)}>7 días</button>
        <button className="rounded border px-3 py-2" onClick={() => rapido(29)}>30 días</button>
        <label className="text-sm">Desde<input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="block rounded border px-2 py-1" /></label>
        <label className="text-sm">Hasta<input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="block rounded border px-2 py-1" /></label>
        <button className="rounded bg-orange-600 hover:bg-orange-700 px-3 py-2 text-white" onClick={cargar}>Actualizar</button>
      </div>
      {error && <p className="rounded bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Vendido", dinero(total)], ["Cuentas", String(numCuentas)], ["Ticket promedio", dinero(numCuentas ? total / numCuentas : 0)], ["Redondeo efectivo", dinero(redondeo)]].map(([t, v]) => (
          <div key={t} className="rounded border p-3">
            <p className="text-sm text-slate-600">{t}</p>
            <p className="text-2xl font-semibold">{v}</p>
          </div>
        ))}
      </div>

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Productos más vendidos</h2>
          <div className="flex rounded border bg-slate-100 p-0.5 text-xs font-medium">
            <button
              onClick={() => setCriterioProductos("IMPORTE")}
              className={`rounded px-3 py-1.5 transition-colors ${
                criterioProductos === "IMPORTE"
                  ? "bg-white text-orange-600 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Por importe ($)
            </button>
            <button
              onClick={() => setCriterioProductos("CANTIDAD")}
              className={`rounded px-3 py-1.5 transition-colors ${
                criterioProductos === "CANTIDAD"
                  ? "bg-white text-orange-600 shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Por cantidad vendida
            </button>
          </div>
        </div>

        <Grafica
          titulo=""
          datos={datosGraficaProductos}
          horizontal
          esMoneda={criterioProductos === "IMPORTE"}
        />
      </section>

      <Grafica titulo="Ventas por día" datos={porDia} />
      <Grafica titulo="Ventas por hora" datos={porHora} />
      <div className="grid gap-6 md:grid-cols-3">
        <Grafica titulo="Método de pago" datos={porMetodo} />
        <Grafica titulo="Mesa vs. para llevar" datos={porTipo} />
        <Grafica titulo="Por mesero" datos={porMesero} />
      </div>

      <section>
        <h2 className="mb-2 text-lg font-semibold">Detalle por producto</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">Producto</th>
                <th className="text-right">Cantidad</th>
                <th className="text-right">Importe</th>
              </tr>
            </thead>
            <tbody>
              {tablaProductos.map((p) => (
                <tr key={p.nombre} className="border-b">
                  <td className="py-2">{p.nombre}</td>
                  <td className="text-right">{p.unidad === "KG" ? `${p.cantidad.toFixed(3)} kg` : `${p.cantidad} pz`}</td>
                  <td className="text-right">{dinero(p.importe)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Grafica({
  titulo,
  datos,
  horizontal = false,
  esMoneda = true,
}: {
  titulo?: string;
  datos: { nombre: string; total: number; unidad?: string }[];
  horizontal?: boolean;
  esMoneda?: boolean;
}) {
  return (
    <section>
      {titulo && <h2 className="mb-2 text-lg font-semibold">{titulo}</h2>}
      {datos.length === 0 ? (
        <p className="text-sm text-slate-600">Sin ventas en este periodo.</p>
      ) : (
        <div style={{ height: horizontal ? Math.max(200, datos.length * 36) : 240 }}>
          <ResponsiveContainer width="100%" height="100%">
            {horizontal ? (
              <BarChart data={datos} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  type="number"
                  tickFormatter={(v) => (esMoneda ? `$${v}` : `${v}`)}
                />
                <YAxis type="category" dataKey="nombre" width={150} />
                <Tooltip
                  formatter={(v, _n, item) => [
                    esMoneda
                      ? dinero(Number(v))
                      : `${v} ${item?.payload?.unidad === "KG" ? "kg" : "pz"}`,
                    esMoneda ? "Total recaudado" : "Cantidad vendida",
                  ]}
                />
                <Bar dataKey="total" fill="#1f4e5f" radius={[0, 4, 4, 0]} />
              </BarChart>
            ) : (
              <BarChart data={datos}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="nombre" />
                <YAxis tickFormatter={(v) => (esMoneda ? `$${v}` : `${v}`)} />
                <Tooltip
                  formatter={(v) => [
                    esMoneda ? dinero(Number(v)) : String(v),
                    esMoneda ? "Cobrado" : "Total",
                  ]}
                />
                <Bar dataKey="total" fill="#1f4e5f" radius={[4, 4, 0, 0]} />
              </BarChart>
            )}
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}