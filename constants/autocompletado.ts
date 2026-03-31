export const LIDERES: Record<string, string> = {
  '11111111': 'Ana García',
  '22222222': 'Pedro Ramírez',
  '33333333': 'María López',
};

export const PRODUCTOS: Record<string, {
  descripcion: string;
  cantidad: number;
  material: string;
  cavidades: number;
  ciclos: number;
}> = {
  '1': {
    descripcion: 'Tapa rosca 28mm azul',
    cantidad: 5000,
    material: 'Polipropileno PP',
    cavidades: 8,
    ciclos: 12,
  },
  '2': {
    descripcion: 'Envase 500ml transparente',
    cantidad: 3000,
    material: 'PET',
    cavidades: 4,
    ciclos: 18,
  },
  '3': {
    descripcion: 'Tapa flip top 24mm',
    cantidad: 8000,
    material: 'Polietileno HDPE',
    cavidades: 16,
    ciclos: 8,
  },
};