import Encabezado from "@/components/Encabezado";
import { exigirRol } from "@/lib/perfil";
import VistaMesero from "./VistaMesero";

export default async function MeseroPage({ searchParams }: { searchParams: Promise<{ cuenta?: string }> }) {
  const perfil = await exigirRol(["MESERO", "ADMIN"]);
  const { cuenta } = await searchParams;
  return (
    <>
      <Encabezado titulo="Mesero" perfil={perfil} />
      <VistaMesero perfil={perfil} cuentaInicial={cuenta ?? null} />
    </>
  );
}
