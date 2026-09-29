"use client";

import { useRouter } from "next/navigation";
import { crearClienteNavegador } from "@/lib/supabase/client";

export default function BotonSalir() {
  const router = useRouter();
  async function salir() {
    await crearClienteNavegador().auth.signOut();
    router.replace("/login");
    router.refresh();
  }
  return (
    <button onClick={salir} className="rounded border px-3 py-2 text-sm">
      Cerrar sesión
    </button>
  );
}
