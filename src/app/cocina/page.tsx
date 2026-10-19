import Encabezado from "@/components/Encabezado";
import { exigirRol } from "@/lib/perfil";
import VistaCocina from "./VistaCocina";

export default async function CocinaPage() {
  const perfil = await exigirRol(["COCINA", "ADMIN"]);
  return (
    <>
      <Encabezado titulo="Cocina" perfil={perfil} />
      <VistaCocina />
    </>
  );
}
