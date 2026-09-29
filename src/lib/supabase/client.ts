import { createBrowserClient } from "@supabase/ssr";

// Cliente para componentes que corren en el navegador ("use client")
export function crearClienteNavegador() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}
