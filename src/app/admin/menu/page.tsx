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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold">Menú</h1>
          <p className="max-w-2xl text-sm text-cafe-medio">
            &quot;Agotado&quot; lo bloquea por hoy en la pantalla del mesero. Quitar &quot;Visible en el menú&quot; lo retira sin borrar su historial.
            Los cambios de precio no afectan ventas ya registradas.
          </p>
        </div>
        <button onClick={nuevaCategoria} className="rounded-xl border-2 border-cafe px-4 py-2 font-semibold hover:bg-crema-oscuro">
          Nueva categoría
        </button>
      </div>

      {error && <p className="rounded-xl bg-paliacate-claro px-4 py-3 text-sm text-paliacate-oscuro">{error}</p>}

      {categorias.length === 0 && (
        <p className="rounded-2xl border-2 border-dashed border-borde px-4 py-10 text-center text-cafe-medio">
          Aún no hay categorías. Crea la primera con <strong>Nueva categoría</strong>.
        </p>
      )}

      {categorias.map((c) => {
        const lista = productos.filter((p) => p.categoria_id === c.id);
        return (
          <section key={c.id} className="overflow-hidden rounded-2xl border border-borde bg-white">
            <div className="flex items-center justify-between border-b border-borde bg-crema/60 px-4 py-3">
              <h2 className="font-display text-xl font-bold">
                {c.nombre} <span className="text-sm font-normal text-cafe-medio">({lista.length})</span>
              </h2>
              <button
                onClick={() => nuevoProducto(c.id)}
                className="rounded-lg bg-paliacate px-3 py-1.5 text-sm font-semibold text-white hover:bg-paliacate-oscuro"
              >
                Agregar producto
              </button>
            </div>
            {lista.length === 0 && <p className="px-4 py-4 text-sm text-cafe-medio">Sin productos.</p>}
            <ul className="divide-y divide-borde/70">
              {lista.map((p) => (
                <li key={p.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className={`flex items-center gap-2 ${p.activo ? "" : "text-cafe/40 line-through"}`}>
                      <span className="font-semibold">{p.nombre}</span>
                      <span className="tabular-nums text-cafe-medio">
                        {dinero(p.precio)}
                        {p.unidad === "KG" ? "/kg" : ""}
                      </span>
                      {!p.disponible && p.activo && (
                        <span className="rounded-full bg-paliacate-claro px-2 py-0.5 text-xs font-semibold text-paliacate-oscuro">Agotado</span>
                      )}
                      {!p.activo && <span className="text-xs no-underline">(oculto)</span>}
                    </span>
                    <span className="flex gap-2">
                      <button
                        onClick={() => ejecutar(supabase.from("productos").update({ disponible: !p.disponible }).eq("id", p.id))}
                        className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                          p.disponible ? "border-borde hover:border-cafe-medio" : "border-hoja text-hoja hover:bg-hoja-claro"
                        }`}
                      >
                        {p.disponible ? "Marcar agotado" : "Hay de nuevo"}
                      </button>
                      <button onClick={() => setEditando(p)} className="rounded-lg border border-borde px-3 py-1.5 text-sm font-semibold hover:border-cafe-medio">
                        Editar
                      </button>
                    </span>
                  </div>
                  {p.requiere_opcion && (
                    <Opciones producto={p} opciones={opciones.filter((o) => o.producto_id === p.id)} ejecutar={ejecutar} />
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      {editando && <Formulario producto={editando} categorias={categorias} onCerrar={() => setEditando(null)} onGuardar={guardar} />}
    </div>
  );
}

function Opciones({ producto, opciones, ejecutar }: {
  producto: Producto; opciones: Opcion[]; ejecutar: (p: PromiseLike<{ error: unknown }>) => Promise<boolean>;
}) {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-sm">
      <span className="mr-1 text-cafe-medio">Opciones:</span>
      {opciones.map((o) => (
        <button key={o.id} onClick={() => ejecutar(supabase.from("opciones_producto").update({ activo: !o.activo }).eq("id", o.id))}
          className={`rounded-full border px-3 py-1 ${o.activo ? "border-queso bg-queso-claro" : "border-borde text-cafe/40 line-through"}`}
          title="Tocar para activar o desactivar">
          {o.nombre}
        </button>
      ))}
      <button className="rounded-full border border-dashed border-cafe-medio px-3 py-1 text-cafe-medio hover:text-cafe" onClick={() => {
        const nombre = window.prompt("Nueva opción (ej. Maciza)")?.trim();
        if (nombre) ejecutar(supabase.from("opciones_producto").insert({ producto_id: producto.id, nombre }));
      }}>+ Agregar opción</button>
    </div>
  );
}

function Formulario({ producto, categorias, onCerrar, onGuardar }: {
  producto: Producto; categorias: Categoria[]; onCerrar: () => void; onGuardar: (p: Producto) => void;
}) {
  const [p, setP] = useState(producto);
  const cambiar = <K extends keyof Producto>(k: K, v: Producto[K]) => setP((x) => ({ ...x, [k]: v }));
  const campo = "mt-1 block w-full rounded-xl border border-borde bg-white px-3 py-2.5 font-normal focus:border-cafe focus:outline-none";
  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-cafe/50 p-3" onClick={onCerrar}>
      <div className="w-full max-w-md space-y-4 rounded-3xl bg-crema p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-2xl font-extrabold">{p.id ? "Editar producto" : "Nuevo producto"}</h3>
        <label className="block text-sm font-semibold">Nombre<input value={p.nombre} onChange={(e) => cambiar("nombre", e.target.value)} className={campo} /></label>
        <label className="block text-sm font-semibold">Categoría
          <select value={p.categoria_id} onChange={(e) => cambiar("categoria_id", e.target.value)} className={campo}>
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-semibold">Precio ($)<input inputMode="decimal" value={p.precio || ""} onChange={(e) => cambiar("precio", Number(e.target.value))} className={campo} /></label>
          <label className="block text-sm font-semibold">Se vende por
            <select value={p.unidad} onChange={(e) => cambiar("unidad", e.target.value as Unidad)} className={campo}>
              <option value="PIEZA">Pieza</option><option value="KG">Kilo</option>
            </select>
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-paliacate" checked={p.requiere_opcion} onChange={(e) => cambiar("requiere_opcion", e.target.checked)} />Obliga a elegir opción (ej. guisado)</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-paliacate" checked={p.activo} onChange={(e) => cambiar("activo", e.target.checked)} />Visible en el menú</label>
        <label className="block text-sm font-semibold">Orden en la lista<input inputMode="numeric" value={p.orden} onChange={(e) => cambiar("orden", Number(e.target.value))} className={`${campo} w-24`} /></label>
        <div className="flex gap-2 pt-1">
          <button onClick={() => onGuardar(p)} disabled={!p.nombre.trim() || !(Number(p.precio) > 0)} className="flex-1 rounded-xl bg-paliacate py-3 font-semibold text-white hover:bg-paliacate-oscuro disabled:opacity-40">Guardar</button>
          <button onClick={onCerrar} className="flex-1 rounded-xl border-2 border-borde py-3 font-semibold hover:border-cafe-medio">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
