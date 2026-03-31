import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Switch, Alert
} from 'react-native';
import { useRouter } from 'expo-router';
import { guardarOrdenGlobal } from '../store/useOrdenStore';
import { LIDERES, PRODUCTOS } from '../constants/autocompletado';
import { TipoMaquina } from '../constants/listas';

const TIPOS_MAQUINA: { label: string; value: TipoMaquina }[] = [
  { label: 'Inyección', value: 'inyeccion' },
  { label: 'Soplado', value: 'soplado' },
  { label: 'Línea de empaque', value: 'linea' },
];

export default function Pantalla1() {
  const router = useRouter();

  const [cedulaLider, setCedulaLider] = useState('');
  const [nombreLider, setNombreLider] = useState('');
  const [numeroOrden, setNumeroOrden] = useState('');
  const [codigoProducto, setCodigoProducto] = useState('');
  const [descripcionProducto, setDescripcionProducto] = useState('');
  const [cantidadProducir, setCantidadProducir] = useState('');
  const [material, setMaterial] = useState('');
  const [tipoMaquina, setTipoMaquina] = useState<TipoMaquina | null>(null);
  const [numeroMaquina, setNumeroMaquina] = useState('');
  const [cavidades, setCavidades] = useState('');
  const [ciclos, setCiclos] = useState('');
  const [tienePigmento, setTienePigmento] = useState(false);
  const [numeroPigmento, setNumeroPigmento] = useState('');
  const [descripcionPigmento, setDescripcionPigmento] = useState('');

  const handleCedulaLider = (valor: string) => {
    setCedulaLider(valor);
    setNombreLider(LIDERES[valor] || '');
  };

  const handleCodigoProducto = (valor: string) => {
    setCodigoProducto(valor);
    const producto = PRODUCTOS[valor];
    if (producto) {
      setDescripcionProducto(producto.descripcion);
      setCantidadProducir(producto.cantidad.toString());
      setMaterial(producto.material);
      setCavidades(producto.cavidades.toString());
      setCiclos(producto.ciclos.toString());
    } else {
      setDescripcionProducto('');
      setCantidadProducir('');
      setMaterial('');
      setCavidades('');
      setCiclos('');
    }
  };

  const handleGuardar = () => {
    if (!cedulaLider || !nombreLider || !numeroOrden || !codigoProducto || !numeroMaquina) {
      Alert.alert('Campos incompletos', 'Por favor completa todos los campos obligatorios');
      return;
    }
    if (!tipoMaquina) {
      Alert.alert('Tipo de máquina', 'Debes seleccionar el tipo de máquina');
      return;
    }
    if (tienePigmento && (!numeroPigmento || !descripcionPigmento)) {
      Alert.alert('Datos de pigmento', 'Si lleva pigmento debes completar número y descripción');
      return;
    }
    guardarOrdenGlobal({
      cedulaLider,
      nombreLider,
      numeroOrden,
      codigoProducto,
      descripcionProducto,
      cantidadProducir: Number(cantidadProducir),
      material,
      tipoMaquina,
      numeroMaquina,
      cavidades: Number(cavidades),
      ciclos: Number(ciclos),
      tienePigmento,
      numeroPigmento,
      descripcionPigmento,
    });
    router.push('/pantalla2');
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>

      <Text style={s.titulo}>Datos de la orden</Text>
      <Text style={s.subtitulo}>Ingreso del líder de producción</Text>

      <Text style={s.seccion}>Datos del líder</Text>

      <Text style={s.label}>Cédula del líder</Text>
      <TextInput
        style={s.input}
        value={cedulaLider}
        onChangeText={handleCedulaLider}
        placeholder="Ingresa la cédula"
        placeholderTextColor="#475569"
        keyboardType="numeric"
      />

      <Text style={s.label}>Nombre del líder</Text>
      <View style={s.inputAuto}>
        <Text style={[s.inputAutoText, !nombreLider && s.placeholder]}>
          {nombreLider || 'Se completa automáticamente'}
        </Text>
      </View>

      <Text style={s.seccion}>Datos de la orden</Text>

      <Text style={s.label}>Número de orden</Text>
      <TextInput
        style={s.input}
        value={numeroOrden}
        onChangeText={setNumeroOrden}
        placeholder="Ingresa el número de orden"
        placeholderTextColor="#475569"
        keyboardType="numeric"
      />

      <Text style={s.label}>Código de producto</Text>
      <TextInput
        style={s.input}
        value={codigoProducto}
        onChangeText={handleCodigoProducto}
        placeholder="Ingresa el código"
        placeholderTextColor="#475569"
        keyboardType="numeric"
      />

      <Text style={s.label}>Descripción de producto</Text>
      <View style={s.inputAuto}>
        <Text style={[s.inputAutoText, !descripcionProducto && s.placeholder]}>
          {descripcionProducto || 'Se completa con el código'}
        </Text>
      </View>

      <View style={s.fila}>
        <View style={s.mitad}>
          <Text style={s.label}>Cantidad a producir</Text>
          <View style={s.inputAuto}>
            <Text style={[s.inputAutoText, !cantidadProducir && s.placeholder]}>
              {cantidadProducir || 'Auto'}
            </Text>
          </View>
        </View>
        <View style={s.mitad}>
          <Text style={s.label}>Tipo de material</Text>
          <View style={s.inputAuto}>
            <Text style={[s.inputAutoText, !material && s.placeholder]}>
              {material || 'Auto'}
            </Text>
          </View>
        </View>
      </View>

      <Text style={s.seccion}>Máquina</Text>

      <Text style={s.label}>Tipo de máquina</Text>
      {TIPOS_MAQUINA.map((tipo) => (
        <TouchableOpacity
          key={tipo.value}
          style={[s.turnoCard, tipoMaquina === tipo.value && s.turnoActivo]}
          onPress={() => setTipoMaquina(tipo.value)}
        >
          <View style={[s.radio, tipoMaquina === tipo.value && s.radioActivo]} />
          <Text style={[s.turnoText, tipoMaquina === tipo.value && s.turnoTextActivo]}>
            {tipo.label}
          </Text>
        </TouchableOpacity>
      ))}

      <Text style={s.label}>Número de máquina</Text>
      <TextInput
        style={s.input}
        value={numeroMaquina}
        onChangeText={setNumeroMaquina}
        placeholder="Ingresa el número de máquina"
        placeholderTextColor="#475569"
        keyboardType="numeric"
      />

      <View style={s.fila}>
        <View style={s.mitad}>
          <Text style={s.label}>Cavidades</Text>
          <View style={s.inputAuto}>
            <Text style={[s.inputAutoText, !cavidades && s.placeholder]}>
              {cavidades || 'Auto'}
            </Text>
          </View>
        </View>
        <View style={s.mitad}>
          <Text style={s.label}>Ciclos</Text>
          <View style={s.inputAuto}>
            <Text style={[s.inputAutoText, !ciclos && s.placeholder]}>
              {ciclos || 'Auto'}
            </Text>
          </View>
        </View>
      </View>

      <Text style={s.seccion}>Pigmento</Text>

      <View style={s.toggleFila}>
        <Text style={s.toggleLabel}>¿Lleva pigmento?</Text>
        <Switch
          value={tienePigmento}
          onValueChange={setTienePigmento}
          trackColor={{ false: '#334155', true: '#6366f1' }}
          thumbColor="#fff"
        />
      </View>

      {tienePigmento && (
        <View>
          <Text style={s.label}>Número de pigmento</Text>
          <TextInput
            style={s.input}
            value={numeroPigmento}
            onChangeText={setNumeroPigmento}
            placeholder="Ingresa el número de pigmento"
            placeholderTextColor="#475569"
            keyboardType="numeric"
          />
          <Text style={s.label}>Descripción del pigmento</Text>
          <TextInput
            style={s.input}
            value={descripcionPigmento}
            onChangeText={setDescripcionPigmento}
            placeholder="Ej: Azul marino concentrado"
            placeholderTextColor="#475569"
          />
        </View>
      )}

      <TouchableOpacity style={s.btn} onPress={handleGuardar}>
        <Text style={s.btnText}>Guardar orden y continuar →</Text>
      </TouchableOpacity>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: '#0f172a' },
  content:         { padding: 24, paddingTop: 60, paddingBottom: 40 },
  titulo:          { fontSize: 24, fontWeight: '700', color: '#f1f5f9', marginBottom: 4 },
  subtitulo:       { fontSize: 14, color: '#94a3b8', marginBottom: 24 },
  seccion:         { fontSize: 13, fontWeight: '600', color: '#6366f1',
                     textTransform: 'uppercase', letterSpacing: 1,
                     marginTop: 24, marginBottom: 12 },
  label:           { fontSize: 13, color: '#94a3b8', marginBottom: 6 },
  input:           { backgroundColor: '#1e293b', borderRadius: 10, padding: 14,
                     fontSize: 15, color: '#f1f5f9', marginBottom: 14,
                     borderWidth: 1, borderColor: '#334155' },
  inputAuto:       { backgroundColor: '#0f2744', borderRadius: 10, padding: 14,
                     marginBottom: 14, borderWidth: 1, borderColor: '#1e3a5f' },
  inputAutoText:   { fontSize: 15, color: '#6366f1' },
  placeholder:     { color: '#334155' },
  fila:            { flexDirection: 'row', gap: 12 },
  mitad:           { flex: 1 },
  turnoCard:       { flexDirection: 'row', alignItems: 'center', gap: 12,
                     backgroundColor: '#1e293b', borderRadius: 10, padding: 16,
                     marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  turnoActivo:     { borderColor: '#6366f1', backgroundColor: '#1e1b4b' },
  radio:           { width: 20, height: 20, borderRadius: 10,
                     borderWidth: 2, borderColor: '#475569' },
  radioActivo:     { borderColor: '#6366f1', backgroundColor: '#6366f1' },
  turnoText:       { fontSize: 15, color: '#94a3b8' },
  turnoTextActivo: { color: '#f1f5f9', fontWeight: '600' },
  toggleFila:      { flexDirection: 'row', justifyContent: 'space-between',
                     alignItems: 'center', backgroundColor: '#1e293b',
                     borderRadius: 10, padding: 16, marginBottom: 14,
                     borderWidth: 1, borderColor: '#334155' },
  toggleLabel:     { fontSize: 15, color: '#f1f5f9' },
  btn:             { backgroundColor: '#6366f1', borderRadius: 14,
                     padding: 18, alignItems: 'center', marginTop: 16 },
  btnText:         { color: '#fff', fontSize: 17, fontWeight: '700' },
});