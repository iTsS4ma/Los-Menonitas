"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { dinero, errorTexto } from "@/lib/formato";
import type { Categoria, Opcion, Producto, Unidad } from "@/lib/tipos";

export default function MenuPage() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [opciones, setOpciones] = useState<Opcion[]>([]);
  const [editando, setEditando] = useState<Producto | null>(null);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const [c, p, o] = await Promise.all([
      supabase.from("categorias").select("*").order("orden"),
      supabase.from("productos").select("*").order("orden"),
      supabase.from("opciones_producto").select("*").order("nombre"),
    ]);
    const e = c.error || p.error || o.error;
    if (e) return setError(errorTexto(e));
    setCategorias(c.data as Categoria[]);
    setProductos(p.data as Producto[]);
    setOpciones(o.data as Opcion[]);
  }, [supabase]);

  useEffect(() => {
    const t = setTimeout(cargar, 0);
    return () => clearTimeout(t);
  }, [cargar]);

  async function ejecutar(p: PromiseLike<{ error: unknown }>) {
    const { error } = await p;
    setError(error ? errorTexto(error) : "");
    await cargar();
    return !error;
  }

  function nuevaCategoria() {
    const nombre = window.prompt("Nombre de la categoría")?.trim();
    if (nombre) ejecutar(supabase.from("categorias").insert({ nombre, orden: categorias.length + 1 }));
  }

  function nuevoProducto(categoria_id: string) {
    setEditando({
      id: "", categoria_id, nombre: "", precio: 0, unidad: "PIEZA", requiere_opcion: false,
      disponible: true, activo: true, orden: productos.filter((p) => p.categoria_id === categoria_id).length + 1,
    });
  }

  async function guardar(p: Producto) {
    const datos = {
      categoria_id: p.categoria_id, nombre: p.nombre.trim(), precio: Number(p.precio), unidad: p.unidad,
      requiere_opcion: p.requiere_opcion, disponible: p.disponible, activo: p.activo, orden: p.orden,
    };
    const ok = await ejecutar(
      p.id ? supabase.from("productos").update(datos).eq("id", p.id) : supabase.from("productos").insert(datos)
    );
    if (ok) setEditando(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Menú</h2>
        <button onClick={nuevaCategoria} className="rounded border px-3 py-2">Nueva categoría</button>
      </div>
      <p className="text-sm text-slate-600">
        &quot;Agotado&quot; lo oculta por hoy en la pantalla del mesero. &quot;Quitar del menú&quot; lo retira sin borrar su historial de ventas.
        Los cambios de precio no afectan ventas ya registradas.
      </p>
      {error && <p className="rounded bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}

      {categorias.map((c) => (
        <section key={c.id} className="rounded border p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-lg font-semibold">{c.nombre}</h3>
            <button onClick={() => nuevoProducto(c.id)} className="rounded border px-3 py-1 text-sm">Agregar producto</button>
          </div>
          <ul className="divide-y">
            {productos.filter((p) => p.categoria_id === c.id).map((p) => (
              <li key={p.id} className="py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className={p.activo ? "" : "text-slate-400 line-through"}>
                    {p.nombre} · {dinero(p.precio)}{p.unidad === "KG" ? "/kg" : ""}
                    {!p.disponible && p.activo && <span className="ml-2 rounded bg-rose-50 px-2 text-xs text-rose-700">Agotado</span>}
                  </span>
                  <span className="flex gap-2">
                    <button onClick={() => ejecutar(supabase.from("productos").update({ disponible: !p.disponible }).eq("id", p.id))} className="rounded border px-2 py-1 text-sm">
                      {p.disponible ? "Marcar agotado" : "Hay de nuevo"}
                    </button>
                    <button onClick={() => setEditando(p)} className="rounded border px-2 py-1 text-sm">Editar</button>
                  </span>
                </div>
                {p.requiere_opcion && (
                  <Opciones producto={p} opciones={opciones.filter((o) => o.producto_id === p.id)} ejecutar={ejecutar} />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {editando && <Formulario producto={editando} categorias={categorias} onCerrar={() => setEditando(null)} onGuardar={guardar} />}
    </div>
  );
}

function Opciones({ producto, opciones, ejecutar }: {
  producto: Producto; opciones: Opcion[]; ejecutar: (p: PromiseLike<{ error: unknown }>) => Promise<boolean>;
}) {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <span className="text-slate-600">Opciones:</span>
      {opciones.map((o) => (
        <button key={o.id} onClick={() => ejecutar(supabase.from("opciones_producto").update({ activo: !o.activo }).eq("id", o.id))}
          className={`rounded border px-2 py-1 ${o.activo ? "" : "text-slate-400 line-through"}`} title="Tocar para activar o desactivar">
          {o.nombre}
        </button>
      ))}
      <button className="rounded border px-2 py-1" onClick={() => {
        const nombre = window.prompt("Nueva opción (ej. Maciza)")?.trim();
        if (nombre) ejecutar(supabase.from("opciones_producto").insert({ producto_id: producto.id, nombre }));
      }}>+ Agregar</button>
    </div>
  );
}

function Formulario({ producto, categorias, onCerrar, onGuardar }: {
  producto: Producto; categorias: Categoria[]; onCerrar: () => void; onGuardar: (p: Producto) => void;
}) {
  const [p, setP] = useState(producto);
  const cambiar = <K extends keyof Producto>(k: K, v: Producto[K]) => setP((x) => ({ ...x, [k]: v }));
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-slate-900/40 p-3" onClick={onCerrar}>
      <div className="w-full max-w-md space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">{p.id ? "Editar producto" : "Nuevo producto"}</h3>
        <label className="block text-sm">Nombre<input value={p.nombre} onChange={(e) => cambiar("nombre", e.target.value)} className="block w-full rounded border px-2 py-2" /></label>
        <label className="block text-sm">Categoría
          <select value={p.categoria_id} onChange={(e) => cambiar("categoria_id", e.target.value)} className="block w-full rounded border px-2 py-2">
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">Precio ($)<input inputMode="decimal" value={p.precio || ""} onChange={(e) => cambiar("precio", Number(e.target.value))} className="block w-full rounded border px-2 py-2" /></label>
          <label className="block text-sm">Se vende por
            <select value={p.unidad} onChange={(e) => cambiar("unidad", e.target.value as Unidad)} className="block w-full rounded border px-2 py-2">
              <option value="PIEZA">Pieza</option><option value="KG">Kilo</option>
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.requiere_opcion} onChange={(e) => cambiar("requiere_opcion", e.target.checked)} />Obliga a elegir opción (ej. guisado)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={p.activo} onChange={(e) => cambiar("activo", e.target.checked)} />Visible en el menú</label>
        <label className="block text-sm">Orden<input inputMode="numeric" value={p.orden} onChange={(e) => cambiar("orden", Number(e.target.value))} className="block w-24 rounded border px-2 py-2" /></label>
        <div className="flex gap-2">
          <button onClick={() => onGuardar(p)} disabled={!p.nombre.trim() || !(Number(p.precio) > 0)} className="flex-1 rounded bg-orange-600 hover:bg-orange-700 py-2 text-white disabled:opacity-40">Guardar</button>
          <button onClick={onCerrar} className="flex-1 rounded border py-2">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
