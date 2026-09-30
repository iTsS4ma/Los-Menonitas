// Service worker de Los Menonitas: recibe notificaciones push y abre la mesa al tocarlas.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = { titulo: "Los Menonitas", cuerpo: event.data ? event.data.text() : "" };
  }

  const titulo = datos.titulo || "Los Menonitas";
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: datos.cuerpo || "",
      icon: "/icono-192.png",
      badge: "/icono-192.png",
      tag: datos.etiqueta || undefined, // evita duplicados de la misma ronda
      renotify: true,
      vibrate: [200, 100, 200],
      data: { url: datos.url || "/mesero" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = new URL(event.notification.data?.url || "/mesero", self.location.origin).href;

  event.waitUntil(
    (async () => {
      const ventanas = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const v of ventanas) {
        if (new URL(v.url).origin === self.location.origin) {
          await v.focus();
          if ("navigate" in v) return v.navigate(destino);
          return;
        }
      }
      return self.clients.openWindow(destino);
    })()
  );
});
