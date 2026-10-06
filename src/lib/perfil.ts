import { redirect } from "next/navigation";
import { crearClienteServidor } from "@/lib/supabase/server";

export type Rol = "ADMIN" | "MESERO" | "CAJERO";

export type Perfil = {
  id: string;
  nombre: string;
  rol: Rol;
  puede_cobrar: boolean;
};

export const rutaPorRol: Record<Rol, string> = {
  ADMIN: "/admin",
  MESERO: "/mesero",
  CAJERO: "/caja",
};

// Devuelve el perfil del usuario con sesión, o null
export async function obtenerPerfil(): Promise<Perfil | null> {
  const supabase = await crearClienteServidor();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("usuarios")
    .select("id, nombre, rol, puede_cobrar")
    .eq("id", user.id)
    .eq("activo", true)
    .eq("eliminado", false)
    .single();

  return (data as Perfil) ?? null;
}

// Protege una página: si el rol no está permitido, lo manda a su pantalla
export async function exigirRol(permitidos: Rol[]): Promise<Perfil> {
  const perfil = await obtenerPerfil();
  if (!perfil) redirect("/login?error=sin-perfil");
  // Un rol que ya no existe (p. ej. el antiguo de cocina) no tiene pantalla
  if (!rutaPorRol[perfil.rol]) redirect("/login?error=sin-perfil");
  if (!permitidos.includes(perfil.rol)) redirect(rutaPorRol[perfil.rol]);
  return perfil;
}
