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
      className="rounded-full border border-crema/30 px-3.5 py-1.5 text-sm font-medium text-crema/85 transition-colors hover:bg-crema/10"
    >
      Cerrar sesión
    </button>
  );
}
