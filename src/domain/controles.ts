// Motor de controles: lista declarativa de controles + decisión determinista.
// Agregar/quitar un control = agregar/quitar un objeto en CONTROLES. La matriz de SOLUCION.md sale de aquí.
import {
  buscarCentro, buscarCondicion, buscarIva, buscarProveedor, cargarCaso, cargarMaestros,
  type CasoCrudo, type CentroCosto, type CondicionPago, type IndicadorIva, type Lider, type Maestros, type Proveedor,
} from "../data/maestros";
import { cuadra, iso, normTexto, parseFecha, redondear } from "../lib/parse";
import { extraerCotizacion, extraerFactura, type Cotizacion, type Factura } from "./extractores";
import { normalizarAprobacion, normalizarSolicitud, type AprobacionNorm, type SolicitudNorm } from "./normalizar";

export type Severidad = "BLOQUEANTE" | "ALERTA";
export type Estado = "OK" | "FALLA" | "REVISAR" | "NO_APLICA";
export type Decision = "APROBAR" | "RECHAZAR" | "REVISION_HUMANA";

export interface ResultadoControl {
  id: string;
  nombre: string;
  severidad: Severidad;
  estado: Estado;
  detalle: string;
}

export interface Contexto {
  caso: CasoCrudo;
  sol: SolicitudNorm;
  apr: AprobacionNorm;
  cot: Cotizacion | null;
  fac: Factura | null;
  m: Maestros;
  proveedor?: Proveedor;
  centro?: CentroCosto;
  lider?: Lider;
  indicadorIva?: string;
  ivaInd?: IndicadorIva;
  condicionPago?: string;
  condPago?: CondicionPago;
  usaDefaults: string[];
  totales: { subtotal?: number; tasa?: number; iva?: number; total?: number };
}

interface Control {
  id: string;
  nombre: string;
  severidad: Severidad;
  evaluar: (c: Contexto) => { estado: Estado; detalle: string };
}

const ok = (detalle: string) => ({ estado: "OK" as const, detalle });
const falla = (detalle: string) => ({ estado: "FALLA" as const, detalle });
const revisar = (detalle: string) => ({ estado: "REVISAR" as const, detalle });
const na = (detalle: string) => ({ estado: "NO_APLICA" as const, detalle });
const $ = (n?: number) => (n === undefined ? "?" : n.toLocaleString("es-CO", { maximumFractionDigits: 2 }));

const ESTADOS_ACTIVOS = ["ACTIVO", "HABILITADO", "ACTIVE", "VIGENTE"];
const DECISIONES_APROBADAS = ["APROBADO", "APROBADA", "APPROVED", "SI", "OK"];

// ⚠️ AJUSTAR AL PRD: ¿el tope se compara contra total con IVA o subtotal? Aquí: total con IVA.
const montoParaTope = (c: Contexto) => c.totales.total;

export const CONTROLES: Control[] = [
  {
    id: "C01", nombre: "Proveedor existe en maestro", severidad: "BLOQUEANTE",
    evaluar: (c) => c.proveedor
      ? ok(`${c.proveedor.razonSocial ?? c.proveedor.id} (NIT ${c.proveedor.nit})`)
      : falla(`NIT ${c.sol.nitProveedor ?? c.cot?.nit.valor ?? "no informado"} no está en el maestro`),
  },
  {
    id: "C02", nombre: "Proveedor activo", severidad: "BLOQUEANTE",
    evaluar: (c) => !c.proveedor ? na("Sin proveedor")
      : ESTADOS_ACTIVOS.includes(normTexto(c.proveedor.estado)) ? ok(`Estado ${c.proveedor.estado}`)
      : falla(`Estado ${c.proveedor.estado ?? "desconocido"}`),
  },
  {
    id: "C03", nombre: "NIT de la cotización coincide con el proveedor", severidad: "BLOQUEANTE",
    evaluar: (c) => {
      if (!c.cot) return revisar("No hay cotización");
      if (!c.cot.nit.valor) return revisar("No se pudo leer el NIT en la cotización");
      if (!c.proveedor) return na("Sin proveedor en maestro");
      return normNitEq(c.cot.nit.valor, c.proveedor.nit)
        ? ok(`Cotización NIT ${c.cot.nit.valor}`)
        : falla(`Cotización NIT ${c.cot.nit.valor} ≠ maestro ${c.proveedor.nit}`);
    },
  },
  {
    id: "C04", nombre: "Centro de costo válido", severidad: "BLOQUEANTE",
    evaluar: (c) => c.centro ? ok(`${c.centro.codigo} ${c.centro.nombre ?? ""}`.trim())
      : falla(`Centro ${c.sol.centroCosto ?? "no informado"} no existe`),
  },
  {
    id: "C05", nombre: "Subárea pertenece al centro", severidad: "BLOQUEANTE",
    evaluar: (c) => {
      if (!c.centro) return na("Sin centro");
      if (!c.sol.subarea) return na("Solicitud sin subárea");
      const subs = (c.centro.subareas ?? []).map((s) => normTexto(typeof s === "string" ? s : s.codigo ?? s.nombre));
      if (!subs.length) return na("El centro no define subáreas");
      return subs.includes(normTexto(c.sol.subarea)) ? ok(c.sol.subarea) : falla(`${c.sol.subarea} no pertenece a ${c.centro.codigo}`);
    },
  },
  {
    id: "C06", nombre: "Evidencia de aprobación", severidad: "BLOQUEANTE",
    evaluar: (c) => {
      if (!c.apr.presente) return falla("No hay aprobación");
      if (c.apr.decision && !DECISIONES_APROBADAS.includes(normTexto(c.apr.decision))) return falla(`Decisión: ${c.apr.decision}`);
      return ok(`Aprobado por ${c.apr.aprobador ?? "?"} el ${iso(c.apr.fecha) ?? "?"}`);
    },
  },
  {
    id: "C07", nombre: "Aprobador es líder del centro", severidad: "BLOQUEANTE",
    evaluar: (c) => {
      if (!c.apr.presente || !c.centro) return na("Sin aprobación o sin centro");
      return c.lider ? ok(`${c.lider.nombre ?? c.lider.correo}`) : falla(`${c.apr.aprobador ?? "?"} no es líder de ${c.centro.codigo}`);
    },
  },
  {
    id: "C08", nombre: "Monto dentro del tope del líder", severidad: "BLOQUEANTE",
    evaluar: (c) => {
      const monto = montoParaTope(c);
      if (!c.lider) return na("Sin líder válido");
      if (monto === undefined) return revisar("No se pudo calcular el monto");
      return monto <= c.lider.tope ? ok(`${$(monto)} ≤ tope ${$(c.lider.tope)}`) : falla(`${$(monto)} excede tope ${$(c.lider.tope)}`);
    },
  },
  {
    id: "C09", nombre: "Monto aprobado cubre la compra", severidad: "BLOQUEANTE",
    evaluar: (c) => {
      if (c.apr.monto === undefined) return na("La aprobación no indica monto");
      const t = c.totales.total;
      if (t === undefined) return revisar("No se pudo calcular el total");
      return t <= c.apr.monto || cuadra(t, c.apr.monto) ? ok(`${$(t)} ≤ aprobado ${$(c.apr.monto)}`) : falla(`${$(t)} > aprobado ${$(c.apr.monto)}`);
    },
  },
  {
    id: "C10", nombre: "Indicador de IVA válido", severidad: "BLOQUEANTE",
    evaluar: (c) => !c.indicadorIva ? falla("Sin indicador (ni en solicitud ni default del proveedor)")
      : c.ivaInd ? ok(`${c.ivaInd.codigo} = ${redondear(c.ivaInd.tasa * 100)}%${c.usaDefaults.includes("indicadorIva") ? " (default proveedor)" : ""}`)
      : falla(`Indicador ${c.indicadorIva} no existe`),
  },
  {
    id: "C11", nombre: "IVA de la cotización cuadra con la tasa", severidad: "ALERTA",
    evaluar: (c) => {
      const ivaCot = c.cot?.iva.valor;
      if (ivaCot === undefined || c.totales.iva === undefined) return na("Sin IVA en cotización o sin tasa");
      return cuadra(ivaCot, c.totales.iva) ? ok(`IVA ${$(ivaCot)}`) : falla(`Cotización ${$(ivaCot)} vs calculado ${$(c.totales.iva)}`);
    },
  },
  {
    id: "C12", nombre: "Total cuadra con la cotización", severidad: "BLOQUEANTE",
    evaluar: (c) => {
      const tCot = c.cot?.total.valor;
      if (tCot === undefined) return revisar("No se pudo leer el total de la cotización");
      if (c.totales.total === undefined) return revisar("No se pudo calcular el total de la solicitud");
      return cuadra(tCot, c.totales.total) ? ok(`Total ${$(tCot)}`) : falla(`Cotización ${$(tCot)} vs solicitud ${$(c.totales.total)}`);
    },
  },
  {
    id: "C13", nombre: "Condición de pago válida", severidad: "BLOQUEANTE",
    evaluar: (c) => !c.condicionPago ? falla("Sin condición (ni en solicitud ni default)")
      : c.condPago ? ok(`${c.condPago.codigo} ${c.condPago.descripcion ?? ""}${c.usaDefaults.includes("condicionPago") ? " (default proveedor)" : ""}`.trim())
      : falla(`Condición ${c.condicionPago} no existe`),
  },
  {
    id: "C14", nombre: "Cotización vigente al aprobar", severidad: "ALERTA",
    evaluar: (c) => {
      const f = parseFecha(c.cot?.fecha.valor), dias = c.cot?.validezDias.valor;
      const ref = c.apr.fecha ?? c.sol.fecha;
      if (!f || dias === undefined || !ref) return na("Sin fecha/validez de cotización o fecha de referencia");
      const vence = new Date(f.getTime() + dias * 86400000);
      return ref <= vence ? ok(`Vence ${iso(vence)}`) : falla(`Venció ${iso(vence)}, referencia ${iso(ref)}`);
    },
  },
  {
    id: "C15", nombre: "Compra no retroactiva (OC antes que factura)", severidad: "ALERTA",
    evaluar: (c) => {
      if (!c.fac) return ok("No hay factura previa");
      const fFac = parseFecha(c.fac.fecha.valor);
      const ref = c.apr.fecha ?? c.sol.fecha;
      const detalle = `Factura ${c.fac.numero.valor ?? "?"} del ${iso(fFac) ?? "?"}; aprobación ${iso(c.apr.fecha) ?? "?"}`;
      // Que exista factura antes de crear la OC ya es el desvío; si además es anterior a la aprobación, es más grave.
      if (fFac && ref && fFac < ref) return falla(`RETROACTIVA: factura anterior a la aprobación. ${detalle}`);
      return falla(`RETROACTIVA: ya existe factura antes de la OC. ${detalle}`);
    },
  },
];

const normNitEq = (a: string, b: string) => {
  const x = a.split("-")[0]!.replace(/\D/g, ""), y = b.split("-")[0]!.replace(/\D/g, "");
  return x === y || x.slice(0, -1) === y || y.slice(0, -1) === x;
};

export function construirContexto(id: string): Contexto {
  const caso = cargarCaso(id);
  const m = cargarMaestros();
  const sol = normalizarSolicitud(id, caso.solicitud ?? {});
  const apr = normalizarAprobacion(caso.aprobacion);
  const cot = caso.cotizacionTexto ? extraerCotizacion(caso.cotizacionTexto) : null;
  const fac = caso.facturaTexto ? extraerFactura(caso.facturaTexto) : null;

  const proveedor = buscarProveedor(m, sol.nitProveedor ?? cot?.nit.valor);
  const centro = buscarCentro(m, sol.centroCosto);
  const lider = centro?.lideres?.find((l) => normTexto(l.correo) === normTexto(apr.aprobador));

  const usaDefaults: string[] = [];
  let indicadorIva = sol.indicadorIva;
  if (!indicadorIva && proveedor?.defaults?.indicadorIva) { indicadorIva = proveedor.defaults.indicadorIva; usaDefaults.push("indicadorIva"); }
  let condicionPago = sol.condicionPago;
  if (!condicionPago && proveedor?.defaults?.condicionPago) { condicionPago = proveedor.defaults.condicionPago; usaDefaults.push("condicionPago"); }
  const ivaInd = buscarIva(m, indicadorIva);
  const condPago = buscarCondicion(m, condicionPago);

  const sumaItems = sol.items.length ? sol.items.reduce((a, i) => a + i.cantidad * i.valorUnitario, 0) : undefined;
  const subtotal = sol.subtotal ?? sumaItems ?? cot?.subtotal.valor;
  const tasa = ivaInd?.tasa;
  const iva = subtotal !== undefined && tasa !== undefined ? redondear(subtotal * tasa) : undefined;
  const total = subtotal !== undefined && iva !== undefined ? redondear(subtotal + iva) : undefined;

  return { caso, sol, apr, cot, fac, m, proveedor, centro, lider, indicadorIva, ivaInd, condicionPago, condPago, usaDefaults, totales: { subtotal, tasa, iva, total } };
}

export interface Evaluacion {
  solicitudId: string;
  decision: Decision;
  retroactiva: boolean;
  motivos: string[];
  resultados: ResultadoControl[];
  payload: PayloadOC | null;
}

export interface PayloadOC {
  referenciaExterna: string; // id de la solicitud -> llave de idempotencia
  proveedor: { id?: string; nit: string; razonSocial?: string };
  centroCosto: string;
  subarea?: string;
  indicadorIva: string;
  condicionPago: string;
  moneda: string;
  items: { descripcion: string; cantidad: number; valorUnitario: number }[];
  subtotal: number;
  iva: number;
  total: number;
  aprobador?: string;
  fechaAprobacion?: string;
  retroactiva: boolean;
  facturaReferencia?: string;
}

export function evaluar(id: string): Evaluacion {
  const c = construirContexto(id);
  const resultados: ResultadoControl[] = CONTROLES.map((ctl) => {
    try {
      return { id: ctl.id, nombre: ctl.nombre, severidad: ctl.severidad, ...ctl.evaluar(c) };
    } catch (e) {
      return { id: ctl.id, nombre: ctl.nombre, severidad: ctl.severidad, estado: "REVISAR", detalle: `Error evaluando: ${(e as Error).message}` };
    }
  });

  const bloqueos = resultados.filter((r) => r.severidad === "BLOQUEANTE" && r.estado === "FALLA");
  const alertas = resultados.filter((r) => (r.severidad === "ALERTA" && r.estado === "FALLA") || r.estado === "REVISAR");
  const retroactiva = resultados.find((r) => r.id === "C15")?.estado === "FALLA";

  const decision: Decision = bloqueos.length ? "RECHAZAR" : alertas.length ? "REVISION_HUMANA" : "APROBAR";
  const motivos = [...bloqueos, ...alertas].map((r) => `${r.id} ${r.nombre}: ${r.detalle}`);

  const payload: PayloadOC | null =
    decision !== "RECHAZAR" && c.proveedor && c.centro && c.indicadorIva && c.condicionPago && c.totales.total !== undefined
      ? {
          referenciaExterna: id,
          proveedor: { id: c.proveedor.id, nit: c.proveedor.nit, razonSocial: c.proveedor.razonSocial },
          centroCosto: c.centro.codigo,
          subarea: c.sol.subarea,
          indicadorIva: c.indicadorIva,
          condicionPago: c.condicionPago,
          moneda: c.sol.moneda,
          items: c.sol.items.length ? c.sol.items : [{ descripcion: c.sol.descripcion ?? id, cantidad: 1, valorUnitario: c.totales.subtotal! }],
          subtotal: c.totales.subtotal!,
          iva: c.totales.iva!,
          total: c.totales.total,
          aprobador: c.apr.aprobador,
          fechaAprobacion: iso(c.apr.fecha),
          retroactiva,
          facturaReferencia: c.fac?.numero.valor,
        }
      : null;

  return { solicitudId: id, decision, retroactiva, motivos, resultados, payload };
}
