import { crearClienteServidor } from "@/lib/supabase/server";
import Personal, { type Persona } from "./Personal";

export default async function PersonalPage() {
  const supabase = await crearClienteServidor();
  const { data } = await supabase.from("usuarios").select("id, nombre, email, rol, puede_cobrar, activo")
    .eq("eliminado", false)
    .order("nombre");
  return <Personal personas={(data ?? []) as Persona[]} />;
}
