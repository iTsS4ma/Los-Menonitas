import { redirect } from "next/navigation";
import Encabezado from "@/components/Encabezado";
import { exigirRol, rutaPorRol } from "@/lib/perfil";
import VistaCaja from "./VistaCaja";

export default async function CajaPage({ searchParams }: { searchParams: Promise<{ cuenta?: string }> }) {
  const perfil = await exigirRol(["CAJERO", "MESERO", "ADMIN"]);
  // Solo cobra quien es ADMIN o tiene el permiso "puede cobrar"
  if (perfil.rol !== "ADMIN" && !perfil.puede_cobrar) redirect(rutaPorRol[perfil.rol] === "/caja" ? "/login?error=sin-perfil" : rutaPorRol[perfil.rol]);
  const { cuenta } = await searchParams;
  return (
    <>
      <Encabezado titulo="Caja" perfil={perfil} />
      <VistaCaja cuentaInicial={cuenta ?? null} />
    </>
  );
}
