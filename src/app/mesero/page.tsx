import Encabezado from "@/components/Encabezado";
import { exigirRol } from "@/lib/perfil";
import VistaMesero from "./VistaMesero";

export default async function MeseroPage() {
  const perfil = await exigirRol(["MESERO", "ADMIN"]);
  return (
    <>
      <Encabezado titulo="Mesero" perfil={perfil} />
      <VistaMesero perfil={perfil} />
    </>
  );
}
