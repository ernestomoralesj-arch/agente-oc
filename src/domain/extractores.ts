// Extracción determinista de cotización y factura a partir de texto (regex por línea).
// Cada campo trae nivel de confianza: "alta" (etiqueta encontrada), "ausente" (no encontrado).
import { buscarFecha, parseMonto, iso } from "../lib/parse";

type Confianza = "alta" | "media" | "ausente";
export interface Campo<T> { valor?: T; confianza: Confianza; linea?: string }

export interface Cotizacion {
  nit: Campo<string>;
  fecha: Campo<string>;
  subtotal: Campo<number>;
  iva: Campo<number>;
  total: Campo<number>;
  validezDias: Campo<number>;
  plazoPagoDias: Campo<number>;
}

export interface Factura {
  numero: Campo<string>;
  fecha: Campo<string>;
  total: Campo<number>;
  nit: Campo<string>;
}

const lineas = (t: string) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

/** Último monto numérico de la línea (evita tomar "19" de "IVA 19%"). */
function ultimoMonto(linea: string): number | undefined {
  const tokens = linea.replace(/\d+(?:[.,]\d+)?\s*%/g, " ").match(/\d[\d.,]*/g);
  if (!tokens) return undefined;
  return parseMonto(tokens[tokens.length - 1]!);
}

function montoPorEtiqueta(ls: string[], incluye: RegExp, excluye?: RegExp): Campo<number> {
  const l = ls.find((x) => incluye.test(x) && !(excluye && excluye.test(x)));
  const v = l ? ultimoMonto(l) : undefined;
  return v !== undefined ? { valor: v, confianza: "alta", linea: l } : { confianza: "ausente" };
}

function nitEn(ls: string[]): Campo<string> {
  for (const l of ls) {
    const m = l.match(/N\.?\s*I\.?\s*T\.?\s*[:#.\s]*\s*([\d][\d.\s]{5,}\d(?:\s*-\s*\d)?)/i);
    if (m) return { valor: m[1]!.replace(/\s/g, ""), confianza: "alta", linea: l };
  }
  return { confianza: "ausente" };
}

function fechaEn(ls: string[], incluye: RegExp, excluye?: RegExp): Campo<string> {
  const l = ls.find((x) => incluye.test(x) && !(excluye && excluye.test(x)));
  const d = l ? buscarFecha(l) : undefined;
  if (d) return { valor: iso(d), confianza: "alta", linea: l };
  // Respaldo: primera fecha del documento (confianza media)
  const any = buscarFecha(ls.join("\n"));
  return any ? { valor: iso(any), confianza: "media" } : { confianza: "ausente" };
}

function diasEn(ls: string[], incluye: RegExp): Campo<number> {
  const l = ls.find((x) => incluye.test(x));
  const m = l?.match(/(\d+)\s*d[ií]as/i);
  if (m) return { valor: Number(m[1]), confianza: "alta", linea: l };
  if (l && /contado|inmediato/i.test(l)) return { valor: 0, confianza: "alta", linea: l };
  return { confianza: "ausente" };
}

export function extraerCotizacion(texto: string): Cotizacion {
  const ls = lineas(texto);
  return {
    nit: nitEn(ls),
    fecha: fechaEn(ls, /fecha/i, /venc|validez|entrega/i),
    subtotal: montoPorEtiqueta(ls, /sub\s*-?\s*total|valor\s+antes\s+de\s+iva|base\s+gravable/i),
    iva: montoPorEtiqueta(ls, /\bIVA\b/i, /antes\s+de\s+iva|incluido|sin\s+iva|total/i),
    total: montoPorEtiqueta(ls, /\btotal\b/i, /sub\s*-?\s*total/i),
    validezDias: diasEn(ls, /validez|vigencia|v[aá]lida/i),
    plazoPagoDias: diasEn(ls, /pago|plazo|cr[eé]dito/i),
  };
}

export function extraerFactura(texto: string): Factura {
  const ls = lineas(texto);
  const lNum = ls.find((l) => /factura/i.test(l) && /(No\.?|N[°º]|#|n[uú]mero)/i.test(l));
  const mNum = lNum?.match(/(?:No\.?|N[°º]|#|n[uú]mero)[:\s]*([A-Z0-9-]{3,})/i);
  return {
    numero: mNum ? { valor: mNum[1], confianza: "alta", linea: lNum } : { confianza: "ausente" },
    fecha: fechaEn(ls, /emisi[oó]n|fecha\s+factura|fecha/i, /venc/i),
    total: montoPorEtiqueta(ls, /\btotal\b/i, /sub\s*-?\s*total/i),
    nit: nitEn(ls),
  };
}

/** Versión compacta (valor + confianza) para enviar al LLM. */
export function compactar(obj: Record<string, Campo<unknown>>) {
  return Object.fromEntries(Object.entries(obj).map(([k, c]) => [k, { valor: c.valor ?? null, confianza: c.confianza }]));
}
