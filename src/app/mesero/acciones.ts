"use server";

import { exigirRol } from "@/lib/perfil";
import { crearClienteAdmin } from "@/lib/supabase/admin";

type Suscripcion = { endpoint: string; keys: { p256dh: string; auth: string } };

// Guarda (o actualiza) el "domicilio" de notificaciones de este celular
export async function guardarSuscripcion(sub: Suscripcion) {
  const perfil = await exigirRol(["MESERO", "ADMIN"]);
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return { ok: false, error: "Suscripción inválida" };

  const { error } = await crearClienteAdmin()
    .from("push_suscripciones")
    .upsert(
      { usuario_id: perfil.id, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      { onConflict: "endpoint" }
    );
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function borrarSuscripcion(endpoint: string) {
  const perfil = await exigirRol(["MESERO", "ADMIN"]);
  await crearClienteAdmin().from("push_suscripciones").delete().eq("endpoint", endpoint).eq("usuario_id", perfil.id);
  return { ok: true };
}
