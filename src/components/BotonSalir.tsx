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
    <button
      onClick={salir}
      className="shrink-0 rounded-full px-3 py-2 text-sm font-medium text-crema/70 underline-offset-4 transition-colors hover:text-crema hover:underline"
    >
      Cerrar sesión
    </button>
  );
}
