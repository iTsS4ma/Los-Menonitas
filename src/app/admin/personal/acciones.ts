"use server";

import { revalidatePath } from "next/cache";
import { exigirRol, type Rol } from "@/lib/perfil";
import { crearClienteAdmin } from "@/lib/supabase/admin";

type Resultado = { ok: true } | { ok: false; error: string };
const ROLES: Rol[] = ["ADMIN", "MESERO", "COCINA", "CAJERO"];

export async function crearPersonal(datos: {
  nombre: string; email: string; password: string; rol: Rol; puede_cobrar: boolean;
}): Promise<Resultado> {
  await exigirRol(["ADMIN"]);
  const nombre = datos.nombre.trim();
  const email = datos.email.trim().toLowerCase();
  if (!nombre || !email) return { ok: false, error: "Nombre y correo son obligatorios" };
  if (datos.password.length < 8) return { ok: false, error: "La contraseña debe tener al menos 8 caracteres" };
  if (!ROLES.includes(datos.rol)) return { ok: false, error: "Rol no válido" };

  const admin = crearClienteAdmin();
  const { data, error } = await admin.auth.admin.createUser({ email, password: datos.password, email_confirm: true });
  if (error || !data.user) return { ok: false, error: error?.message ?? "No se pudo crear el usuario" };

  const { error: e2 } = await admin.from("usuarios").insert({
    id: data.user.id, nombre, email, rol: datos.rol,
    puede_cobrar: datos.rol === "ADMIN" || datos.rol === "CAJERO" ? true : datos.puede_cobrar,
  });
  if (e2) {
    await admin.auth.admin.deleteUser(data.user.id); // no dejar usuarios a medias
    return { ok: false, error: e2.message };
  }
  revalidatePath("/admin/personal");
  return { ok: true };
}

export async function actualizarPersonal(id: string, cambios: {
  rol?: Rol; puede_cobrar?: boolean; activo?: boolean; nombre?: string;
}): Promise<Resultado> {
  const yo = await exigirRol(["ADMIN"]);
  if (id === yo.id && (cambios.activo === false || (cambios.rol && cambios.rol !== "ADMIN")))
    return { ok: false, error: "No puedes quitarte a ti mismo el acceso de administrador" };
  if (cambios.rol && !ROLES.includes(cambios.rol)) return { ok: false, error: "Rol no válido" };
  const datos = { ...cambios };
  if (datos.rol === "ADMIN" || datos.rol === "CAJERO") datos.puede_cobrar = true;

  const { error } = await crearClienteAdmin().from("usuarios").update(datos).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/personal");
  return { ok: true };
}

export async function cambiarPassword(id: string, password: string): Promise<Resultado> {
  await exigirRol(["ADMIN"]);
  if (password.length < 8) return { ok: false, error: "La contraseña debe tener al menos 8 caracteres" };
  const { error } = await crearClienteAdmin().auth.admin.updateUserById(id, { password });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
