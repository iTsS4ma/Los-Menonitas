import { redirect } from "next/navigation";
import { obtenerPerfil, rutaPorRol } from "@/lib/perfil";

// La raíz solo reparte a cada quien a su pantalla
export default async function Inicio() {
  const perfil = await obtenerPerfil();
  if (!perfil) redirect("/login?error=sin-perfil");
  redirect(rutaPorRol[perfil.rol]);
}
