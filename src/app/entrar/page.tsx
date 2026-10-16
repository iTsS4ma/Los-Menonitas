import { redirect } from "next/navigation";
import { obtenerPerfil, rutaPorRol } from "@/lib/perfil";

// Después de iniciar sesión: manda a cada quien a su pantalla
export default async function Entrar() {
  const perfil = await obtenerPerfil();
  if (!perfil) redirect("/login?error=sin-perfil");
  redirect(rutaPorRol[perfil.rol]);
}
