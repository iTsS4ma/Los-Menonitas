import webpush from "web-push";
import { crearClienteAdmin } from "@/lib/supabase/admin";

// SOLO servidor. Envía una notificación a todos los celulares suscritos de meseros activos.

type Aviso = { titulo: string; cuerpo: string; url: string; etiqueta?: string };

let configurado = false;
function configurar() {
  if (configurado) return true;
  const publica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privada = process.env.VAPID_PRIVATE_KEY;
  const contacto = process.env.VAPID_SUBJECT || "mailto:admin@losmenonitas.mx";
  if (!publica || !privada) return false;
  webpush.setVapidDetails(contacto, publica, privada);
  configurado = true;
  return true;
}

export async function avisarAMeseros(aviso: Aviso) {
  if (!configurar()) return { enviados: 0, error: "Faltan las llaves VAPID en las variables de entorno" };

  const admin = crearClienteAdmin();
  const { data: subs, error } = await admin
    .from("push_suscripciones")
    .select("id, endpoint, p256dh, auth, usuarios!inner(rol, activo)")
    .in("usuarios.rol", ["MESERO", "ADMIN"])
    .eq("usuarios.activo", true);

  if (error) return { enviados: 0, error: error.message };

  const carga = JSON.stringify(aviso);
  let enviados = 0;
  const caducas: string[] = [];

  await Promise.all(
    (subs ?? []).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          carga,
          { TTL: 60 * 10, urgency: "high" }
        );
        enviados++;
      } catch (e) {
        const codigo = (e as { statusCode?: number }).statusCode;
        // 404/410: el celular ya no acepta avisos (desinstaló, quitó el permiso, etc.)
        if (codigo === 404 || codigo === 410) caducas.push(s.id);
      }
    })
  );

  if (caducas.length) await admin.from("push_suscripciones").delete().in("id", caducas);
  return { enviados };
}
