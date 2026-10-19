export type Unidad = "PIEZA" | "KG";
export type Estacion = "COCINA" | "GARNACHAS";
export type EstadoCuenta = "ABIERTA" | "CUENTA_SOLICITADA" | "PAGADA" | "CANCELADA";
export type EstadoPedido = "ENVIADO" | "PREPARANDO" | "LISTO" | "ENTREGADO" | "CANCELADO";
export type Metodo = "EFECTIVO" | "TARJETA" | "TRANSFERENCIA" | "PREFERENTE" | "CORTESIA";

export type Mesa = { id: string; numero: number; capacidad: number | null; activa: boolean };
export type Categoria = { id: string; nombre: string; orden: number };
export type Opcion = { id: string; producto_id: string; nombre: string; activo: boolean };
export type Producto = {
  id: string; categoria_id: string; nombre: string; precio: number; unidad: Unidad;
  requiere_opcion: boolean; disponible: boolean; activo: boolean; orden: number;
  descripcion?: string | null; pregunta_quesillo?: boolean;
  estaciones?: Estacion[]; lleva_verdura?: boolean; sopes_por_medio_kilo?: boolean;
};
export type Detalle = {
  id: string; pedido_id: string; producto_id: string; nombre_producto: string;
  nombre_opcion: string | null; cantidad: number; unidad: Unidad; precio_unitario: number;
  modo_captura: "CANTIDAD" | "PESO" | "MONTO"; importe: number; notas: string | null;
  estado: "ACTIVO" | "CANCELADO"; motivo_cancelacion: string | null;
  con_quesillo?: boolean;
  plato?: number; sin_cebolla?: boolean; sin_cilantro?: boolean; estaciones?: Estacion[];
  // Solo viene cuando la consulta hace join con productos
  productos?: { descripcion: string | null } | null;
};
export type Pedido = {
  id: string; cuenta_id: string; numero_ronda: number; estado: EstadoPedido;
  creado_en: string; listo_en: string | null; detalle_pedido: Detalle[];
  motivo_cancelacion?: string | null; comandas?: Comanda[];
  // Solo viene cuando la consulta hace join con cuentas (vista de cocina)
  cuentas?: Omit<Cuenta, "pedidos"> | null;
};
export type Cuenta = {
  id: string; tipo: "MESA" | "PARA_LLEVAR"; mesa_id: string | null; nombre_cliente: string | null;
  numero_orden: number | null; estado: EstadoCuenta; abierta_en: string;
  mesas: { numero: number } | null; pedidos: Pedido[];
};

// Alias usados en caja y mesero
export type MetodoPago = Metodo;
export type DetallePedido = Detalle;

// Lo que imprime y muestra la estación de cocina (una por estación y ronda, más avisos de cancelación)
export type Comanda = {
  id: string; pedido_id: string; estacion: Estacion; tipo: "PEDIDO" | "CANCELACION";
  renglones: string[] | null; motivo: string | null; creada_en: string;
  impresa_en: string | null; lista_en: string | null;
};
