import { createClient } from "@supabase/supabase-js";

// SOLO para código de servidor (acciones de admin). Usa la llave secreta,
// que se salta RLS. Nunca importar este archivo desde un componente "use client".
export function crearClienteAdmin() {
  if (typeof window !== "undefined") throw new Error("crearClienteAdmin solo en servidor");
  const llave = process.env.SUPABASE_SECRET_KEY;
  if (!llave) throw new Error("Falta SUPABASE_SECRET_KEY en .env.local");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, llave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
