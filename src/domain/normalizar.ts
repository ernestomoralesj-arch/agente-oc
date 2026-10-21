// Mapea el JSON crudo de cada caso a un modelo normalizado.
// Este es EL punto donde se adaptan los nombres de campo reales del PRD (rutas en pick()).
import { parseFecha, parseMonto, pick } from "../lib/parse";

export interface Item { descripcion: string; cantidad: number; valorUnitario: number }

export interface SolicitudNorm {
  id: string;
  fecha?: Date;
  solicitante?: string;
  nitProveedor?: string;
  centroCosto?: string;
  subarea?: string;
  descripcion?: string;
  items: Item[];
  subtotal?: number;
  indicadorIva?: string;
  condicionPago?: string;
  moneda: string;
}

export interface AprobacionNorm {
  presente: boolean;
  aprobador?: string;
  fecha?: Date;
  decision?: string;
  monto?: number;
}

export function normalizarSolicitud(id: string, s: any): SolicitudNorm {
  const itemsRaw: any[] = pick<any[]>(s, "items", "posiciones", "detalle", "lineas") ?? [];
  const items: Item[] = itemsRaw.map((it) => ({
    descripcion: String(pick(it, "descripcion", "material", "texto") ?? ""),
    cantidad: parseMonto(pick(it, "cantidad", "qty")) ?? 1,
    valorUnitario: parseMonto(pick(it, "valorUnitario", "precioUnitario", "precio", "valor")) ?? 0,
  }));
  return {
    id,
    fecha: parseFecha(pick(s, "fecha", "fechaSolicitud", "fecha_solicitud")),
    solicitante: pick(s, "solicitante", "solicitante.correo", "solicitante.nombre"),
    nitProveedor: pick(s, "nitProveedor", "proveedor.nit", "nit", "proveedorNit"),
    centroCosto: pick(s, "centroCosto", "centro_costo", "centroCosto.codigo", "cc"),
    subarea: pick(s, "subarea", "subArea", "centroCosto.subarea"),
    descripcion: pick(s, "descripcion", "objeto", "justificacion"),
    items,
    subtotal: parseMonto(pick(s, "subtotal", "valorSubtotal", "montoSinIva", "valor")),
    indicadorIva: pick(s, "indicadorIva", "indicador_iva", "iva.codigo", "codigoIva"),
    condicionPago: pick(s, "condicionPago", "condicion_pago", "plazoPago"),
    moneda: pick(s, "moneda", "currency") ?? "COP",
  };
}

export function normalizarAprobacion(a: any): AprobacionNorm {
  if (!a) return { presente: false };
  return {
    presente: true,
    aprobador: pick(a, "aprobador", "aprobador.correo", "lider", "lider.correo", "correoAprobador"),
    fecha: parseFecha(pick(a, "fecha", "fechaAprobacion", "fecha_aprobacion")),
    decision: pick(a, "decision", "estado", "resultado"),
    monto: parseMonto(pick(a, "monto", "montoAprobado", "valor")),
  };
}
