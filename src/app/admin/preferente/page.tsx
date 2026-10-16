"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";
import { errorTexto } from "@/lib/formato";

type Tipo = "TOTAL" | "MONTO" | "PORCENTAJE";
type Contrasena = { id: string; codigo: string; creada_en: string; tipo: Tipo; valor: number | null };

const textoDescuento = (tipo: Tipo, valor: number | null) =>
  tipo === "TOTAL" ? "Cuenta gratis" : tipo === "MONTO" ? `$${Number(valor).toFixed(2)} de descuento` : `${Number(valor)}% de descuento`;

// Códigos de descuento: cada uno sirve para UNA cuenta. Puede ser cuenta gratis,
// un monto fijo o un porcentaje. Solo se muestran los que siguen sin usar.
export default function PreferentePage() {
  const supabase = useMemo(() => crearClienteNavegador(), []);
  const [activas, setActivas] = useState<Contrasena[]>([]);
  const [nueva, setNueva] = useState<{ codigo: string; texto: string } | null>(null);
  const [formulario, setFormulario] = useState(false);
  const [tipo, setTipo] = useState<Tipo>("PORCENTAJE");
  const [valor, setValor] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(async () => {
    const { data, error } = await supabase
      .from("contrasenas_preferente")
      .select("id, codigo, creada_en, tipo, valor")
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
    const v = tipo === "TOTAL" ? null : Number(valor);
    const { data, error } = await supabase.rpc("generar_codigo_descuento", { p_tipo: tipo, p_valor: v });
    setOcupado(false);
    if (error) return setError(errorTexto(error));
    setNueva({ codigo: data as string, texto: textoDescuento(tipo, v) });
    setFormulario(false);
    setValor("");
    await cargar();
  }

  async function anular(c: Contrasena) {
    if (!window.confirm(`¿Anular el código ${c.codigo}? Ya no servirá en caja.`)) return;
    setOcupado(true);
    const { error } = await supabase.rpc("anular_contrasena_preferente", { p_id: c.id });
    setOcupado(false);
    if (error) return setError(errorTexto(error));
    if (nueva?.codigo === c.codigo) setNueva(null);
    await cargar();
  }

  const fecha = (iso: string) =>
    new Date(iso).toLocaleString("es-MX", { timeZone: "America/Mexico_City", dateStyle: "short", timeStyle: "short", hour12: true });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-extrabold">Códigos de descuento</h1>
        <p className="text-sm text-cafe-medio">
          El cliente le dice el código a caja y se descuenta de su cuenta: gratis, un monto fijo o un porcentaje. Cada
          código sirve una sola vez y no caduca hasta que se usa. Todo queda registrado en Reportes.
        </p>
      </div>

      {error && <p className="rounded-xl bg-paliacate-claro px-4 py-3 text-sm font-medium text-paliacate-oscuro">{error}</p>}

      <section className="space-y-4 rounded-2xl border border-borde bg-white p-5">
        {!formulario ? (
          <button
            onClick={() => setFormulario(true)}
            className="rounded-xl bg-paliacate px-6 py-3 font-semibold text-white hover:bg-paliacate-oscuro"
          >
            Generar código
          </button>
        ) : (
          <div className="space-y-3">
            <span className="text-sm font-semibold">¿Qué descuento da este código?</span>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-crema-oscuro p-1">
              {(
                [
                  ["PORCENTAJE", "Porcentaje"],
                  ["MONTO", "Monto fijo"],
                  ["TOTAL", "Cuenta gratis"],
                ] as [Tipo, string][]
              ).map(([t, texto]) => (
                <button
                  key={t}
                  onClick={() => setTipo(t)}
                  className={`rounded-lg py-2.5 text-sm font-semibold ${tipo === t ? "bg-white text-cafe shadow-sm" : "text-cafe-medio"}`}
                >
                  {texto}
                </button>
              ))}
            </div>
            {tipo !== "TOTAL" && (
              <label className="block max-w-xs">
                <span className="text-sm">{tipo === "PORCENTAJE" ? "Porcentaje (1 a 100)" : "Monto en pesos"}</span>
                <div className="mt-1 flex items-center gap-2">
                  {tipo === "MONTO" && <span className="font-display text-2xl">$</span>}
                  <input
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={tipo === "PORCENTAJE" ? 100 : undefined}
                    value={valor}
                    onChange={(e) => setValor(e.target.value)}
                    className="w-full rounded-xl border border-borde bg-white px-3 py-2.5 font-display text-2xl focus:border-cafe focus:outline-none"
                  />
                  {tipo === "PORCENTAJE" && <span className="font-display text-2xl">%</span>}
                </div>
              </label>
            )}
            <p className="text-xs text-cafe-medio">
              {tipo === "TOTAL"
                ? "La cuenta completa queda sin cobro."
                : tipo === "MONTO"
                ? "Si la cuenta es menor que el monto, queda en $0 (el resto no se guarda)."
                : "Se descuenta ese porcentaje del total de la cuenta."}
            </p>
            <div className="flex gap-2">
              <button
                disabled={ocupado || (tipo !== "TOTAL" && !(Number(valor) > 0))}
                onClick={generar}
                className="rounded-xl bg-paliacate px-6 py-3 font-semibold text-white hover:bg-paliacate-oscuro disabled:opacity-40"
              >
                {ocupado ? "Generando…" : "Generar"}
              </button>
              <button onClick={() => setFormulario(false)} className="rounded-xl border border-borde px-5 py-3 font-semibold">
                Cancelar
              </button>
            </div>
          </div>
        )}
        {nueva && (
          <div className="rounded-2xl bg-queso-claro px-5 py-4">
            <span className="text-sm text-cafe-medio">Nuevo código · {nueva.texto}</span>
            <p className="font-display text-4xl font-extrabold tracking-[0.25em]">{nueva.codigo}</p>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-borde bg-white">
        <h2 className="border-b border-borde px-5 py-3 font-display text-lg font-bold">
          Activas <span className="text-sm font-normal text-cafe-medio">({activas.length})</span>
        </h2>
        {activas.length === 0 ? (
          <p className="px-5 py-8 text-center text-cafe-medio">No hay códigos sin usar.</p>
        ) : (
          <ul className="divide-y divide-borde/70">
            {activas.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <span>
                  <strong className="font-display text-2xl tracking-[0.2em]">{c.codigo}</strong>
                  <span className="block text-sm font-semibold">{textoDescuento(c.tipo, c.valor)}</span>
                  <span className="block text-xs text-cafe-medio">Generado {fecha(c.creada_en)}</span>
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
