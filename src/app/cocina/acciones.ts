"use server";

import { exigirRol } from "@/lib/perfil";
import { crearClienteAdmin } from "@/lib/supabase/admin";
import { avisarAMeseros } from "@/lib/push";
import { nombreCuenta } from "@/lib/formato";

// Cocina la llama al marcar una ronda como lista: avisa a todos los meseros.
export async function avisarPedidoListo(pedidoId: string) {
  await exigirRol(["COCINA", "ADMIN"]);

  const { data: pedido } = await crearClienteAdmin()
    .from("pedidos")
    .select("id, numero_ronda, estado, cuenta_id, cuentas(tipo, nombre_cliente, numero_orden, mesas(numero))")
    .eq("id", pedidoId)
    .single();

  if (!pedido || pedido.estado !== "LISTO") return { enviados: 0 };

  const cuenta = pedido.cuentas as unknown as Parameters<typeof nombreCuenta>[0] | null;
  const nombre = cuenta ? nombreCuenta(cuenta) : "Una orden";

  return avisarAMeseros({
    titulo: `${nombre} · ¡Listo!`,
    cuerpo: `Ronda ${pedido.numero_ronda} lista para entregar`,
    url: `/mesero?cuenta=${pedido.cuenta_id}`,
    etiqueta: `listo-${pedido.id}`,
  });
}
