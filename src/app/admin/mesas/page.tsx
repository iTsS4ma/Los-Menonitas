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

  const activas = mesas.filter((m) => m.activa).length;
  const campo = "block w-28 rounded-xl border border-borde bg-white px-3 py-2.5 focus:border-cafe focus:outline-none";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold">Mesas</h1>
        <p className="text-sm text-cafe-medio">
          {activas} {activas === 1 ? "mesa activa" : "mesas activas"}. Las mesas no se borran para no perder su historial; desactívalas.
        </p>
      </div>

      {error && <p className="rounded-xl bg-paliacate-claro px-4 py-3 text-sm text-paliacate-oscuro">{error}</p>}

      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-borde bg-white p-4">
        <label className="text-sm font-semibold">
          Número
          <input inputMode="numeric" value={numero} onChange={(e) => setNumero(e.target.value)} className={`mt-1 ${campo}`} />
        </label>
        <label className="text-sm font-semibold">
          Personas
          <input inputMode="numeric" value={capacidad} onChange={(e) => setCapacidad(e.target.value)} className={`mt-1 ${campo}`} />
        </label>
        <button
          onClick={agregar}
          disabled={!(Number(numero) > 0)}
          className="rounded-xl bg-paliacate px-5 py-2.5 font-semibold text-white hover:bg-paliacate-oscuro disabled:opacity-40"
        >
          Agregar mesa
        </button>
        <button onClick={agregarVarias} className="rounded-xl border-2 border-borde px-5 py-2 font-semibold hover:border-cafe-medio">
          Agregar varias
        </button>
      </div>

      {mesas.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-borde px-4 py-10 text-center text-cafe-medio">
          Aún no hay mesas. Usa <strong>Agregar varias</strong> para crearlas de una vez.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {mesas.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col items-center rounded-2xl border-2 bg-white p-4 ${m.activa ? "border-borde" : "border-dashed border-borde opacity-60"}`}
            >
              <span className="font-display text-4xl font-extrabold leading-none">{m.numero}</span>
              <span className="mt-1 text-xs text-cafe-medio">
                {m.activa ? (m.capacidad ? `${m.capacidad} personas` : "Activa") : "Inactiva"}
              </span>
              <button
                onClick={() => ejecutar(supabase.from("mesas").update({ activa: !m.activa }).eq("id", m.id))}
                className="mt-3 w-full rounded-lg border border-borde py-1.5 text-xs font-semibold hover:border-cafe-medio"
              >
                {m.activa ? "Desactivar" : "Activar"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
