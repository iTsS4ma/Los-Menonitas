"use client";

import { useEffect, useState } from "react";
import { borrarSuscripcion, guardarSuscripcion } from "@/app/mesero/acciones";

type Estado = "cargando" | "no-soportado" | "iphone-sin-instalar" | "bloqueado" | "apagado" | "activo";

function llaveABytes(base64: string) {
  const relleno = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  return Uint8Array.from([...bin].map((c) => c.charCodeAt(0)));
}

const esIPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const instalada = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

export default function BotonNotificaciones() {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        return setEstado(esIPhone() && !instalada() ? "iphone-sin-instalar" : "no-soportado");
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      if (Notification.permission === "denied") return setEstado("bloqueado");
      const sub = await reg.pushManager.getSubscription();
      if (sub && Notification.permission === "granted") {
        // Re-sincroniza por si la base perdió el registro
        await guardarSuscripcion(sub.toJSON() as Parameters<typeof guardarSuscripcion>[0]);
        return setEstado("activo");
      }
      setEstado("apagado");
    })().catch(() => setEstado("no-soportado"));
  }, []);

  async function activar() {
    setTrabajando(true);
    setError("");
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado(permiso === "denied" ? "bloqueado" : "apagado");
        return;
      }
      const llave = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!llave) throw new Error("Falta configurar la llave de notificaciones en el servidor.");
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: llaveABytes(llave) }));
      const r = await guardarSuscripcion(sub.toJSON() as Parameters<typeof guardarSuscripcion>[0]);
      if (!r.ok) throw new Error(r.error);
      setEstado("activo");
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron activar las notificaciones.");
    } finally {
      setTrabajando(false);
    }
  }

  async function desactivar() {
    setTrabajando(true);
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await borrarSuscripcion(sub.endpoint);
      await sub.unsubscribe();
    }
    setEstado("apagado");
    setTrabajando(false);
  }

  if (estado === "cargando" || estado === "no-soportado") return null;

  if (estado === "activo") {
    return (
      <div className="flex items-center justify-between rounded-xl bg-hoja-claro px-3 py-2 text-sm">
        <span className="font-medium text-hoja">Notificaciones activas en este celular</span>
        <button onClick={desactivar} disabled={trabajando} className="text-xs font-semibold text-cafe-medio underline-offset-2 hover:underline">
          Desactivar
        </button>
      </div>
    );
  }

  if (estado === "iphone-sin-instalar") {
    return (
      <p className="rounded-xl bg-queso-claro px-3 py-2.5 text-sm">
        Para recibir avisos cuando una ronda esté lista: toca <strong>Compartir</strong> →{" "}
        <strong>Agregar a pantalla de inicio</strong>, y abre la app desde ese ícono.
      </p>
    );
  }

  if (estado === "bloqueado") {
    return (
      <p className="rounded-xl bg-paliacate-claro px-3 py-2.5 text-sm text-paliacate-oscuro">
        Las notificaciones están bloqueadas. Actívalas en los ajustes del navegador para este sitio.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={activar}
        disabled={trabajando}
        className="w-full rounded-xl border-2 border-cafe bg-white py-3 font-semibold hover:bg-crema-oscuro disabled:opacity-50"
      >
        {trabajando ? "Activando…" : "Activar notificaciones de rondas listas"}
      </button>
      {error && <p className="text-xs text-paliacate">{error}</p>}
    </div>
  );
}
