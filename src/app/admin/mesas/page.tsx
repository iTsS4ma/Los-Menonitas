"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { errorTexto } from "@/lib/formato";
import type { Mesa } from "@/lib/tipos";

export default function MesasPage() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [mesas, setMesas] = useState<Mesa[]>([]);
  const [numero, setNumero] = useState("");
  const [capacidad, setCapacidad] = useState("");
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const { data, error } = await supabase.from("mesas").select("*").order("numero");
    if (error) return setError(errorTexto(error));
    setMesas(data as Mesa[]);
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

  async function agregar() {
    const ok = await ejecutar(
      supabase.from("mesas").insert({ numero: Number(numero), capacidad: capacidad ? Number(capacidad) : null })
    );
    if (ok) { setNumero(""); setCapacidad(""); }
  }

  async function agregarVarias() {
    const n = Number(window.prompt("¿Cuántas mesas? Se numeran después de la última.") ?? 0);
    if (!(n > 0)) return;
    const ultimo = Math.max(0, ...mesas.map((m) => m.numero));
    await ejecutar(supabase.from("mesas").insert(Array.from({ length: n }, (_, i) => ({ numero: ultimo + i + 1 }))));
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Mesas</h2>
      {error && <p className="rounded bg-rose-50 p-2 text-sm text-rose-700">{error}</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">Número<input inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} className="block w-24 rounded border px-2 py-2" /></label>
        <label className="text-sm">Personas<input inputMode="numeric" value={capacidad} onChange={(e) => setCapacidad(e.target.value)} className="block w-24 rounded border px-2 py-2" /></label>
        <button onClick={agregar} disabled={!(Number(numero) > 0)} className="rounded bg-orange-600 hover:bg-orange-700 px-4 py-2 text-white disabled:opacity-40">Agregar</button>
        <button onClick={agregarVarias} className="rounded border px-4 py-2">Agregar varias</button>
      </div>
      <ul className="divide-y">
        {mesas.map((m) => (
          <li key={m.id} className="flex items-center justify-between py-2">
            <span className={m.activa ? "" : "text-slate-400"}>
              Mesa {m.numero}{m.capacidad ? ` · ${m.capacidad} personas` : ""}{m.activa ? "" : " (inactiva)"}
            </span>
            <button onClick={() => ejecutar(supabase.from("mesas").update({ activa: !m.activa }).eq("id", m.id))} className="rounded border px-3 py-1 text-sm">
              {m.activa ? "Desactivar" : "Activar"}
            </button>
          </li>
        ))}
      </ul>
      <p className="text-sm text-slate-600">Las mesas no se borran para no perder su historial; desactívalas.</p>
    </div>
  );
}
