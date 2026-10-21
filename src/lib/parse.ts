// Utilidades de parseo deterministas (montos, NIT, fechas). Sin LLM.

/** Convierte "$2.380.000", "2,380,000.50", "2.380.000,50" o 2380000 a número. */
export function parseMonto(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v !== "string") return undefined;
  let s = v.replace(/[^\d.,-]/g, "");
  if (!s || !/\d/.test(s)) return undefined;
  const hasDot = s.includes("."), hasComma = s.includes(",");
  if (hasDot && hasComma) {
    // El último separador es el decimal
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (hasDot || hasComma) {
    const sep = hasDot ? "." : ",";
    const parts = s.split(sep);
    const last = parts[parts.length - 1]!;
    // "2.380.000" o "380.000" -> miles; "1500.50" -> decimal
    if (parts.length > 2 || last.length === 3) s = parts.join("");
    else s = parts.join(".");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** NIT base sin dígito de verificación ni separadores. */
export function normNit(v: unknown): string {
  if (v == null) return "";
  const s = String(v).trim();
  const base = s.includes("-") ? s.split("-")[0]! : s;
  return base.replace(/\D/g, "");
}

/** Compara NITs tolerando presencia/ausencia del dígito de verificación. */
export function nitIgual(a: unknown, b: unknown): boolean {
  const x = normNit(a), y = normNit(b);
  if (!x || !y) return false;
  return x === y || x.slice(0, -1) === y || y.slice(0, -1) === x;
}

const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

/** Acepta ISO, dd/mm/yyyy, dd-mm-yyyy y "8 de mayo de 2026". Devuelve Date UTC o undefined. */
export function parseFecha(v: unknown): Date | undefined {
  if (v instanceof Date) return v;
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return utc(+m[1]!, +m[2]!, +m[3]!);
  m = s.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m) return utc(+m[3]!, +m[2]!, +m[1]!);
  m = s.toLowerCase().match(/(\d{1,2})\s+de\s+([a-záéíóú]+)\s+(?:de|del)\s+(\d{4})/);
  if (m && MESES[m[2]!]) return utc(+m[3]!, MESES[m[2]!]!, +m[1]!);
  return undefined;
}

/** Busca la primera fecha reconocible dentro de un texto libre. */
export function buscarFecha(texto: string): Date | undefined {
  const pats = [
    /\d{4}-\d{2}-\d{2}/,
    /\d{1,2}[\/-]\d{1,2}[\/-]\d{4}/,
    /\d{1,2}\s+de\s+[a-záéíóú]+\s+(?:de|del)\s+\d{4}/i,
  ];
  for (const p of pats) {
    const m = texto.match(p);
    if (m) return parseFecha(m[0]);
  }
  return undefined;
}

function utc(y: number, mo: number, d: number): Date | undefined {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

export const iso = (d?: Date) => (d ? d.toISOString().slice(0, 10) : undefined);
export const redondear = (n: number) => Math.round(n * 100) / 100;

/** Igualdad de montos con tolerancia (1 unidad o 0,1%). */
export function cuadra(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.001);
}

/** Lee un campo probando varias rutas ("a.b.c"). Útil para tolerar variaciones de esquema. */
export function pick<T = unknown>(obj: unknown, ...rutas: string[]): T | undefined {
  for (const ruta of rutas) {
    let cur: any = obj;
    for (const k of ruta.split(".")) {
      if (cur == null || typeof cur !== "object") { cur = undefined; break; }
      cur = cur[k];
    }
    if (cur !== undefined && cur !== null && cur !== "") return cur as T;
  }
  return undefined;
}

export const normTexto = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase();
