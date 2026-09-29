"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Rol } from "@/lib/perfil";
import { actualizarPersonal, cambiarPassword, crearPersonal } from "./acciones";

export type Persona = { id: string; nombre: string; email: string | null; rol: Rol; puede_cobrar: boolean; activo: boolean };

const ROLES: { valor: Rol; texto: string }[] = [
  { valor: "MESERO", texto: "Mesero" }, { valor: "COCINA", texto: "Cocina" },
  { valor: "CAJERO", texto: "Cajero" }, { valor: "ADMIN", texto: "Administrador" },
];

export default function Personal({ personas }: { personas: Persona[] }) {
  const router = useRouter();
  const [pendiente, iniciar] = useTransition();
  const [mensaje, setMensaje] = useState("");
  const [nuevo, setNuevo] = useState({ nombre: "", email: "", password: "", rol: "MESERO" as Rol, puede_cobrar: false });

  function correr(accion: () => Promise<{ ok: boolean; error?: string }>, exito: string) {
    iniciar(async () => {
      const r = await accion();
      setMensaje(r.ok ? exito : `Error: ${r.error}`);
      if (r.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Personal</h2>
      {mensaje && <p className={`rounded p-2 text-sm ${mensaje.startsWith("Error") ? "bg-rose-50 text-rose-700" : "bg-emerald-50"}`}>{mensaje}</p>}

      <section className="space-y-2 rounded border p-3">
        <h3 className="font-semibold">Agregar persona</h3>
        <p className="text-sm text-slate-600">
          El correo solo sirve para iniciar sesión; no se envía ningún mensaje. Si alguien no tiene correo, puedes inventar uno, por ejemplo juan@mirestaurante.com.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <input placeholder="Nombre" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} className="rounded border px-2 py-2" />
          <input placeholder="Correo" type="email" value={nuevo.email} onChange={(e) => setNuevo({ ...nuevo, email: e.target.value })} className="rounded border px-2 py-2" />
          <input placeholder="Contraseña (mínimo 8)" value={nuevo.password} onChange={(e) => setNuevo({ ...nuevo, password: e.target.value })} className="rounded border px-2 py-2" />
          <select value={nuevo.rol} onChange={(e) => setNuevo({ ...nuevo, rol: e.target.value as Rol })} className="rounded border px-2 py-2">
            {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.texto}</option>)}
          </select>
        </div>
        {nuevo.rol === "MESERO" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={nuevo.puede_cobrar} onChange={(e) => setNuevo({ ...nuevo, puede_cobrar: e.target.checked })} />
            Puede cobrar
          </label>
        )}
        <button
          disabled={pendiente}
          onClick={() => correr(async () => {
            const r = await crearPersonal(nuevo);
            if (r.ok) setNuevo({ nombre: "", email: "", password: "", rol: "MESERO", puede_cobrar: false });
            return r;
          }, "Persona agregada. Ya puede iniciar sesión.")}
          className="rounded bg-orange-600 hover:bg-orange-700 px-4 py-2 text-white disabled:opacity-40"
        >
          Agregar
        </button>
      </section>

      <ul className="divide-y">
        {personas.map((p) => (
          <li key={p.id} className={`flex flex-wrap items-center justify-between gap-2 py-3 ${p.activo ? "" : "text-slate-400"}`}>
            <span>
              <strong>{p.nombre}</strong>
              <span className="block text-sm">{p.email}</span>
            </span>
            <span className="flex flex-wrap items-center gap-2 text-sm">
              <select value={p.rol} disabled={pendiente}
                onChange={(e) => correr(() => actualizarPersonal(p.id, { rol: e.target.value as Rol }), "Rol actualizado")}
                className="rounded border px-2 py-1">
                {ROLES.map((r) => <option key={r.valor} value={r.valor}>{r.texto}</option>)}
              </select>
              {p.rol === "MESERO" && (
                <label className="flex items-center gap-1">
                  <input type="checkbox" checked={p.puede_cobrar} disabled={pendiente}
                    onChange={(e) => correr(() => actualizarPersonal(p.id, { puede_cobrar: e.target.checked }), "Permiso actualizado")} />
                  Cobra
                </label>
              )}
              <button className="rounded border px-2 py-1" disabled={pendiente} onClick={() => {
                const nueva = window.prompt(`Nueva contraseña para ${p.nombre} (mínimo 8)`);
                if (nueva) correr(() => cambiarPassword(p.id, nueva), "Contraseña cambiada");
              }}>Contraseña</button>
              <button className="rounded border px-2 py-1" disabled={pendiente}
                onClick={() => correr(() => actualizarPersonal(p.id, { activo: !p.activo }), p.activo ? "Acceso desactivado" : "Acceso activado")}>
                {p.activo ? "Desactivar" : "Activar"}
              </button>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm text-slate-600">Desactivar quita el acceso sin borrar su historial de ventas.</p>
    </div>
  );
}
