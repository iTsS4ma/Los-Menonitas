"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { errorTexto } from "@/lib/formato";

type Contrasena = { id: string; codigo: string; creada_en: string };

// Contraseñas Preferente: cada una cierra UNA cuenta sin cobro (el consumo sí se registra).
// Solo se muestran las que siguen sin usar.
export default function PreferentePage() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [activas, setActivas] = useState<Contrasena[]>([]);
  const [nueva, setNueva] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const { data, error } = await supabase
      .from("contrasenas_preferente")
      .select("id, codigo, creada_en")
      .is("usada_en", null)
      .eq("anulada", false)
      .order("creada_en", { ascending: false });
    if (error) return setError(errorTexto(error));
    setActivas((data ?? []) as Contrasena[]);
  }, [supabase]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function generar() {
    setOcupado(true);
    setError("");
    const { data, error } = await supabase.rpc("generar_contrasena_preferente");
    setOcupado(false);
    if (error) return setError(errorTexto(error));
    setNueva(data as string);
    await cargar();
  }

  async function anular(c: Contrasena) {
    if (!window.confirm(`¿Anular la contraseña ${c.codigo}? Ya no servirá en caja.`)) return;
    setOcupado(true);
    const { error } = await supabase.rpc("anular_contrasena_preferente", { p_id: c.id });
    setOcupado(false);
    if (error) return setError(errorTexto(error));
    if (nueva === c.codigo) setNueva(null);
    await cargar();
  }

  const fecha = (iso: string) =>
    new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short", hour12: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold">Contraseñas Preferente</h1>
        <p className="text-sm text-cafe-medio">
          El cliente le dice la contraseña a caja y su cuenta se cierra sin cobro. El consumo sí queda registrado en
          Reportes. Cada contraseña sirve una sola vez y no caduca hasta que se usa.
        </p>
      </div>

      {error && <p className="rounded-xl bg-paliacate-claro px-4 py-3 text-sm font-medium text-paliacate-oscuro">{error}</p>}

      <section className="space-y-4 rounded-2xl border border-borde bg-white p-5">
        <button
          disabled={ocupado}
          onClick={generar}
          className="rounded-xl bg-paliacate px-6 py-3 font-semibold text-white hover:bg-paliacate-oscuro disabled:opacity-40"
        >
          {ocupado ? "Generando…" : "Generar contraseña"}
        </button>
        {nueva && (
          <div className="rounded-2xl bg-queso-claro px-5 py-4">
            <span className="text-sm text-cafe-medio">Nueva contraseña</span>
            <p className="font-display text-4xl font-extrabold tracking-[0.25em]">{nueva}</p>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-borde bg-white">
        <h2 className="border-b border-borde px-5 py-3 font-display text-lg font-bold">
          Activas <span className="text-sm font-normal text-cafe-medio">({activas.length})</span>
        </h2>
        {activas.length === 0 ? (
          <p className="px-5 py-8 text-center text-cafe-medio">No hay contraseñas sin usar.</p>
        ) : (
          <ul className="divide-y divide-borde/70">
            {activas.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span>
                  <strong className="font-display text-2xl tracking-[0.2em]">{c.codigo}</strong>
                  <span className="block text-xs text-cafe-medio">Generada {fecha(c.creada_en)}</span>
                </span>
                <button
                  disabled={ocupado}
                  onClick={() => anular(c)}
                  className="rounded-lg border border-paliacate/40 px-3 py-1.5 text-sm font-semibold text-paliacate hover:bg-paliacate-claro"
                >
                  Anular
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
