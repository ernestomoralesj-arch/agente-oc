// SAP simulado en memoria. Imita: numeración 45xxxxxxxx, mensajes S/W/E tipo BAPIRET2,
// idempotencia por referencia externa y clase de documento distinta para retroactivas.
import type { PayloadOC } from "../domain/controles";
import type { OrdenSap, ResultadoSap, SapAdapter } from "./adapter";

export class SapSimulado implements SapAdapter {
  private ordenes = new Map<string, OrdenSap>();
  private siguiente = 4500000001;

  async crearOrdenCompra(p: PayloadOC): Promise<ResultadoSap> {
    const existente = this.ordenes.get(p.referenciaExterna);
    if (existente) {
      return { ok: true, numeroOC: existente.numeroOC, creada: false, mensajes: [{ tipo: "W", texto: `Ya existe OC ${existente.numeroOC} para ${p.referenciaExterna}` }] };
    }
    if (!(p.total > 0)) return { ok: false, creada: false, mensajes: [{ tipo: "E", texto: "Total debe ser mayor a cero" }] };
    if (!p.items.length) return { ok: false, creada: false, mensajes: [{ tipo: "E", texto: "La OC no tiene posiciones" }] };

    const numeroOC = String(this.siguiente++);
    // NB = pedido estándar; ZRET = clase propuesta para regularización retroactiva (trazable en auditoría)
    const claseDocumento = p.retroactiva ? "ZRET" : "NB";
    this.ordenes.set(p.referenciaExterna, { numeroOC, referenciaExterna: p.referenciaExterna, creadaEn: new Date().toISOString(), claseDocumento, payload: p });
    return { ok: true, numeroOC, creada: true, mensajes: [{ tipo: "S", texto: `Pedido ${claseDocumento} ${numeroOC} creado` }] };
  }

  async consultarPorReferencia(ref: string) { return this.ordenes.get(ref) ?? null; }
  async listar() { return [...this.ordenes.values()]; }
}

export const sap: SapAdapter = new SapSimulado();
