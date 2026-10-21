// Carga de maestros y casos desde fixtures/reto-03.
// ⚠️ Los tipos son SUPUESTOS hasta ver el PRD real. Si los nombres de campo difieren,
//    ajusta SOLO este archivo y src/domain/normalizar.ts.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { normNit, normTexto, nitIgual } from "../lib/parse";

export const FIXTURES = resolve(process.env.FIXTURES_DIR ?? "fixtures/reto-03");
const DIR_MAESTROS = join(FIXTURES, "maestros");
const DIR_SOLICITUDES = join(FIXTURES, "solicitudes");

export interface Proveedor {
  id?: string;
  nit: string;
  razonSocial?: string;
  estado?: string;
  defaults?: { indicadorIva?: string; condicionPago?: string; moneda?: string };
  [k: string]: unknown;
}
export interface Lider { correo: string; nombre?: string; tope: number }
export interface CentroCosto {
  codigo: string;
  nombre?: string;
  subareas?: (string | { codigo?: string; nombre?: string })[];
  lideres?: Lider[];
  [k: string]: unknown;
}
export interface IndicadorIva { codigo: string; tasa: number; descripcion?: string }
export interface CondicionPago { codigo: string; dias?: number; descripcion?: string }

export interface Maestros {
  proveedores: Proveedor[];
  centros: CentroCosto[];
  iva: IndicadorIva[];
  condiciones: CondicionPago[];
}

export interface CasoCrudo {
  id: string;
  correo: any | null;
  solicitud: any | null;
  cotizacionTexto: string | null;
  aprobacion: any | null;
  facturaTexto: string | null;
  archivos: string[];
}

/** Acepta un arreglo directo o un objeto que envuelve el arreglo ({proveedores:[...]}). */
function asArray(json: any, ...keys: string[]): any[] {
  if (Array.isArray(json)) return json;
  if (json && typeof json === "object") {
    for (const k of keys) if (Array.isArray(json[k])) return json[k];
    const first = Object.values(json).find(Array.isArray);
    if (first) return first as any[];
  }
  return [];
}

const leerJson = (p: string) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
const leerTxt = (p: string) => (existsSync(p) ? readFileSync(p, "utf8") : null);

let cache: Maestros | null = null;
export function cargarMaestros(): Maestros {
  if (cache) return cache;
  const proveedores = asArray(leerJson(join(DIR_MAESTROS, "proveedores.json")), "proveedores");
  const centros = asArray(leerJson(join(DIR_MAESTROS, "centros-costo.json")), "centros", "centrosCosto");
  const iva = asArray(leerJson(join(DIR_MAESTROS, "indicadores-iva.json")), "indicadores").map((i: any) => ({
    ...i,
    // Normaliza tasa: 19 -> 0.19
    tasa: Number(i.tasa) > 1 ? Number(i.tasa) / 100 : Number(i.tasa),
  }));
  const condiciones = asArray(leerJson(join(DIR_MAESTROS, "condiciones-pago.json")), "condiciones");
  cache = { proveedores, centros, iva, condiciones };
  return cache;
}

export function listarCasos(): string[] {
  if (!existsSync(DIR_SOLICITUDES)) return [];
  return readdirSync(DIR_SOLICITUDES)
    .filter((d) => statSync(join(DIR_SOLICITUDES, d)).isDirectory())
    .sort();
}

export function cargarCaso(id: string): CasoCrudo {
  const dir = join(DIR_SOLICITUDES, id);
  if (!/^[\w-]+$/.test(id) || !existsSync(dir)) throw new Error(`No existe la solicitud ${id}`);
  return {
    id,
    correo: leerJson(join(dir, "correo.json")),
    solicitud: leerJson(join(dir, "solicitud.json")),
    cotizacionTexto: leerTxt(join(dir, "cotizacion.txt")),
    aprobacion: leerJson(join(dir, "aprobacion.json")),
    facturaTexto: leerTxt(join(dir, "factura.txt")),
    archivos: readdirSync(dir),
  };
}

// ---- Búsquedas en maestros ----
export const buscarProveedor = (m: Maestros, nit?: string) =>
  nit ? m.proveedores.find((p) => nitIgual(p.nit, nit)) : undefined;

export const buscarCentro = (m: Maestros, codigo?: string) =>
  codigo ? m.centros.find((c) => normTexto(c.codigo) === normTexto(codigo)) : undefined;

export const buscarIva = (m: Maestros, codigo?: string) =>
  codigo ? m.iva.find((i) => normTexto(i.codigo) === normTexto(codigo)) : undefined;

export const buscarCondicion = (m: Maestros, codigo?: string) =>
  codigo ? m.condiciones.find((c) => normTexto(c.codigo) === normTexto(codigo)) : undefined;

export const nitBase = normNit;
