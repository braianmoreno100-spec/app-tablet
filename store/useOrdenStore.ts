import { TipoMaquina } from '../constants/listas';

export interface DatosOrden {
  cedulaLider: string;
  nombreLider: string;
  numeroOrden: string;
  codigoProducto: string;
  descripcionProducto: string;
  cantidadProducir: number;
  material: string;
  tipoMaquina: TipoMaquina;
  numeroMaquina: string;
  cavidades: number;
  ciclos: number;
  tienePigmento: boolean;
  numeroPigmento: string;
  descripcionPigmento: string;
}

let ordenGlobal: DatosOrden | null = null;

export function guardarOrdenGlobal(datos: DatosOrden) {
  ordenGlobal = datos;
}

export function obtenerOrdenGlobal(): DatosOrden | null {
  return ordenGlobal;
}

export function limpiarOrdenGlobal() {
  ordenGlobal = null;
}