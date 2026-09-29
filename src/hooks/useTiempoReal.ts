"use client";

import { useEffect, useRef, useState } from "react";
import { crearClienteNavegador } from "@/lib/supabase/client";

// Escucha cambios en las tablas y llama a `alCambiar`. También recarga al
// reconectar y al volver a la app (celulares que se bloquean).
export function useTiempoReal(clave: string, tablas: string[], alCambiar: () => void) {
  const [conectado, setConectado] = useState(false);
  const callback = useRef(alCambiar);
  const listaTablas = useRef(tablas);

  useEffect(() => {
    callback.current = alCambiar;
  }, [alCambiar]);

  useEffect(() => {
    const supabase = crearClienteNavegador();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelado = false;
    const disparar = () => {
      clearTimeout(timer);
      timer = setTimeout(() => callback.current(), 250);
    };

    const canal = supabase.channel(`rt-${clave}`);
    listaTablas.current.forEach((tabla) =>
      canal.on("postgres_changes", { event: "*", schema: "public", table: tabla }, disparar)
    );

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelado) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      canal.subscribe((status) => {
        setConectado(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") disparar();
      });
    })();

    const alVolver = () => document.visibilityState === "visible" && disparar();
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("online", disparar);

    return () => {
      cancelado = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("online", disparar);
      supabase.removeChannel(canal);
    };
  }, [clave]);

  return conectado;
}
