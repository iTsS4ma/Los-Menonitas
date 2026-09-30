"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";

function FormularioLogin() {
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(
    params.get("error") === "sin-perfil"
      ? "Tu usuario no tiene un perfil activo. Pide al administrador que te dé de alta."
      : ""
  );
  const [cargando, setCargando] = useState(false);

  async function entrar() {
    setError("");
    setCargando(true);
    const supabase = crearClienteNavegador();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError("Correo o contraseña incorrectos.");
      setCargando(false);
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="flex flex-1 flex-col">
      <div className="paliacate h-2" aria-hidden />
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center text-center">
            <Image
              src="/logo.png"
              alt="Los Menonitas"
              width={160}
              height={156}
              className="h-40 w-auto"
              priority
            />
            <h1 className="mt-3 font-display text-3xl font-extrabold">Los Menonitas</h1>
            <p className="text-sm text-cafe-medio">Entra con tu correo y contraseña</p>
          </div>

          <div className="space-y-4 rounded-2xl border border-borde bg-white p-5 shadow-sm">
            <label className="block">
              <span className="text-sm font-semibold">Correo</span>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-borde bg-crema/40 px-3 py-3 text-base focus:border-cafe focus:outline-none"
              />
            </label>

            <label className="block">
              <span className="text-sm font-semibold">Contraseña</span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && entrar()}
                className="mt-1 w-full rounded-xl border border-borde bg-crema/40 px-3 py-3 text-base focus:border-cafe focus:outline-none"
              />
            </label>

            {error && (
              <p className="rounded-xl bg-paliacate-claro px-3 py-2 text-sm font-medium text-paliacate-oscuro">
                {error}
              </p>
            )}

            <button
              onClick={entrar}
              disabled={cargando || !email || !password}
              className="w-full rounded-xl bg-paliacate py-3.5 text-lg font-semibold text-white transition-colors hover:bg-paliacate-oscuro disabled:opacity-40"
            >
              {cargando ? "Entrando…" : "Entrar"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <FormularioLogin />
    </Suspense>
  );
}
