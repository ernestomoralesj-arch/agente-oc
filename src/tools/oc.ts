// Herramientas del agente, tipadas con zod. Son la ÚNICA superficie de acción del LLM.
// Principio clave: el modelo nunca envía montos ni datos maestros; solo IDs.
// El backend reconstruye el payload desde los datos y re-valida antes de escribir en SAP.
import { z } from "zod";
import { cargarCaso, listarCasos } from "../data/maestros";
import { evaluar } from "../domain/controles";
import { compactar, extraerCotizacion, extraerFactura } from "../domain/extractores";
import { normalizarAprobacion, normalizarSolicitud } from "../domain/normalizar";
import { leerBitacora, registrar } from "../lib/bitacora";
import { iso } from "../lib/parse";
import { sap } from "../sap/simulado";

export interface ToolDef<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  /** Si true, el loop del agente pausa y pide confirmación humana antes de ejecutar. */
  requiresConfirmation?: boolean;
  execute: (input: z.infer<S>) => unknown | Promise<unknown>;
  /** Lo que se le muestra al humano en la tarjeta de confirmación. */
  preview?: (input: z.infer<S>) => unknown | Promise<unknown>;
}

const defineTool = <S extends z.ZodType>(t: ToolDef<S>) => t;

const SolicitudId = z.object({
  solicitudId: z.string().regex(/^[\w-]+$/).describe("ID de la carpeta de la solicitud, ej. sol-001"),
});

export const listarSolicitudes = defineTool({
  name: "listar_solicitudes",
  description: "Lista las solicitudes de compra pendientes con su asunto de correo y si ya tienen OC.",
  input: z.object({}),
  async execute() {
    const ids = listarCasos();
    const solicitudes = await Promise.all(ids.map(async (id) => {
      const caso = cargarCaso(id);
      const oc = await sap.consultarPorReferencia(id);
      return {
        id,
        asunto: caso.correo?.asunto ?? caso.correo?.subject ?? null,
        remitente: caso.correo?.de ?? caso.correo?.from ?? null,
        tieneFactura: !!caso.facturaTexto,
        ocExistente: oc?.numeroOC ?? null,
      };
    }));
    return { total: solicitudes.length, solicitudes };
  },
});

export const leerSolicitud = defineTool({
  name: "leer_solicitud",
  description: "Lee una solicitud: correo, datos normalizados de la solicitud, aprobación y qué documentos tiene.",
  input: SolicitudId,
  execute({ solicitudId }) {
    const caso = cargarCaso(solicitudId);
    const sol = normalizarSolicitud(solicitudId, caso.solicitud ?? {});
    const apr = normalizarAprobacion(caso.aprobacion);
    return {
      correo: caso.correo,
      solicitud: { ...sol, fecha: iso(sol.fecha) },
      aprobacion: { ...apr, fecha: iso(apr.fecha) },
      documentos: caso.archivos,
    };
  },
});

export const extraerDocumentos = defineTool({
  name: "extraer_documentos",
  description: "Extrae de forma determinista los campos de la cotización (y la factura si existe) con nivel de confianza por campo.",
  input: SolicitudId,
  execute({ solicitudId }) {
    const caso = cargarCaso(solicitudId);
    return {
      cotizacion: caso.cotizacionTexto ? compactar(extraerCotizacion(caso.cotizacionTexto) as any) : null,
      factura: caso.facturaTexto ? compactar(extraerFactura(caso.facturaTexto) as any) : null,
    };
  },
});

export const validarControles = defineTool({
  name: "validar_controles",
  description:
    "Ejecuta la matriz completa de controles sobre la solicitud y devuelve la decisión (APROBAR | RECHAZAR | REVISION_HUMANA), " +
    "los motivos, el resultado por control y el payload propuesto de la OC.",
  input: SolicitudId,
  execute({ solicitudId }) {
    const ev = evaluar(solicitudId);
    registrar("validar_controles", solicitudId, { decision: ev.decision, motivos: ev.motivos });
    return ev;
  },
});

export const crearOrdenCompra = defineTool({
  name: "crear_orden_compra",
  description:
    "Crea la orden de compra en SAP para una solicitud. REQUIERE confirmación humana (el sistema la solicita automáticamente). " +
    "Solo procede si la decisión es APROBAR, o REVISION_HUMANA con justificación. Es idempotente por solicitud.",
  input: SolicitudId.extend({
    justificacion: z.string().min(10).optional()
      .describe("Obligatoria si la solicitud requiere revisión humana (p. ej. compra retroactiva): por qué se regulariza."),
  }),
  requiresConfirmation: true,
  preview({ solicitudId }) {
    const ev = evaluar(solicitudId);
    return { decision: ev.decision, retroactiva: ev.retroactiva, motivos: ev.motivos, payload: ev.payload };
  },
  async execute({ solicitudId, justificacion }) {
    // Re-validación en el backend: no confiamos en lo que el modelo "cree" que pasó.
    const ev = evaluar(solicitudId);
    if (ev.decision === "RECHAZAR" || !ev.payload) {
      return { creada: false, motivo: "La solicitud no supera los controles bloqueantes", motivos: ev.motivos };
    }
    if (ev.decision === "REVISION_HUMANA" && !justificacion) {
      return { creada: false, motivo: "Requiere justificación explícita para crear la OC", motivos: ev.motivos };
    }
    const r = await sap.crearOrdenCompra(ev.payload);
    registrar("crear_orden_compra", solicitudId, { resultado: r, justificacion, retroactiva: ev.retroactiva });
    return { ...r, retroactiva: ev.retroactiva, total: ev.payload.total };
  },
});

export const consultarOrdenCompra = defineTool({
  name: "consultar_orden_compra",
  description: "Consulta si ya existe una OC en SAP para la solicitud.",
  input: SolicitudId,
  async execute({ solicitudId }) {
    return (await sap.consultarPorReferencia(solicitudId)) ?? { existe: false };
  },
});

export const registrarEscalamiento = defineTool({
  name: "registrar_escalamiento",
  description: "Registra un escalamiento (rechazo o revisión) con su motivo y destinatario sugerido, para seguimiento y auditoría.",
  input: SolicitudId.extend({
    motivo: z.string().min(5),
    destinatario: z.string().describe("Rol o correo: solicitante, líder del centro, compras, control interno"),
  }),
  execute({ solicitudId, motivo, destinatario }) {
    registrar("escalamiento", solicitudId, { motivo, destinatario });
    return { registrado: true, solicitudId, destinatario };
  },
});

export const consultarBitacora = defineTool({
  name: "consultar_bitacora",
  description: "Devuelve la bitácora de auditoría (validaciones, OCs creadas, escalamientos), opcionalmente filtrada por solicitud.",
  input: z.object({ solicitudId: z.string().optional() }),
  execute({ solicitudId }) { return leerBitacora(solicitudId); },
});

export const tools: ToolDef<any>[] = [
  listarSolicitudes, leerSolicitud, extraerDocumentos, validarControles,
  crearOrdenCompra, consultarOrdenCompra, registrarEscalamiento, consultarBitacora,
];

export const toolsByName: Record<string, ToolDef<any>> = Object.fromEntries(tools.map((t) => [t.name, t]));

/** Definiciones en formato de la API de Anthropic (JSON Schema generado desde zod). */
export const anthropicToolDefs = tools.map((t) => {
  const schema = z.toJSONSchema(t.input) as Record<string, unknown>;
  delete schema.$schema;
  return { name: t.name, description: t.description, input_schema: schema as any };
});

/** Ejecuta una herramienta validando el input con zod. Usado por el agente, el demo y la API directa. */
export async function ejecutarTool(name: string, rawInput: unknown) {
  const tool = toolsByName[name];
  if (!tool) throw new Error(`Herramienta desconocida: ${name}`);
  const input = tool.input.parse(rawInput ?? {});
  return tool.execute(input);
}
