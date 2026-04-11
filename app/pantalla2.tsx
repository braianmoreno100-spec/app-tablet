import { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { obtenerOrdenGlobal } from '../store/useOrdenStore';
import { EMPLEADOS } from '../constants/autocompletado';
import { apiIniciarTurno, guardarTurnoId, obtenerOrdenId } from './services/api';

const TURNOS = [
  '6:00 am - 6:00 pm',
  '6:00 pm - 6:00 am',
  '6:30 am - 2:00 pm',
  '6:00 am - 4:00 pm',
];

let turnoGlobal: {
  cedulaEmpleado: string;
  nombreEmpleado: string;
  fecha: string;
  turno: string;
  horaInicio: string;
} | null = null;

export function guardarTurnoGlobal(datos: typeof turnoGlobal) {
  turnoGlobal = datos;
}

export function obtenerTurnoGlobal() {
  return turnoGlobal;
}

export default function Pantalla2() {
  const router = useRouter();
  const orden = obtenerOrdenGlobal();

  const [cedulaEmpleado, setCedulaEmpleado] = useState('');
  const [nombreEmpleado, setNombreEmpleado] = useState('');
  const [turnoSeleccionado, setTurnoSeleccionado] = useState('');
  const [cargando, setCargando] = useState(false);

  const fechaHoy = new Date().toLocaleDateString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  // Fecha en formato YYYY-MM-DD para el servidor
  const fechaServidor = new Date().toISOString().split('T')[0];

  const handleCedulaEmpleado = (valor: string) => {
    setCedulaEmpleado(valor);
    setNombreEmpleado(EMPLEADOS[valor] || '');
  };

  const handleIniciarTurno = async () => {
    if (!cedulaEmpleado || !nombreEmpleado) {
      Alert.alert('Campos incompletos', 'Ingresa la cédula del empleado');
      return;
    }
    if (!turnoSeleccionado) {
      Alert.alert('Selecciona un turno', 'Debes seleccionar el turno antes de continuar');
      return;
    }

    const ahora = new Date();
    const horaInicio = ahora.toLocaleTimeString('es-CO', {
      hour: '2-digit',
      minute: '2-digit',
    });

    const datosTurno = {
      cedulaEmpleado,
      nombreEmpleado,
      fecha: fechaHoy,
      turno: turnoSeleccionado,
      horaInicio,
    };

    guardarTurnoGlobal(datosTurno);
    await AsyncStorage.setItem('turno_activo', JSON.stringify(datosTurno));

    // Iniciar turno en el servidor
    setCargando(true);
    try {
      const ordenId = await obtenerOrdenId();
      if (!ordenId) {
        Alert.alert('Error', 'No se encontró la orden activa. Vuelve a la pantalla anterior.');
        return;
      }

      const turnoIniciado = await apiIniciarTurno({
        orden_id: ordenId,
        cedula_empleado: cedulaEmpleado,
        nombre_empleado: nombreEmpleado,
        turno: turnoSeleccionado,
        hora_inicio: horaInicio,
        fecha: fechaServidor,
      });

      await guardarTurnoId(turnoIniciado.turno_id);
      router.push('/pantalla3');
    } catch (error: any) {
      Alert.alert('Error al iniciar turno', error.message || 'No se pudo conectar al servidor');
    } finally {
      setCargando(false);
    }
  };

  return (
    <ScrollView style={st.container} contentContainerStyle={st.content}>

      <Text style={st.titulo}>Datos del empleado</Text>
      <Text style={st.subtitulo}>Orden: {orden?.numeroOrden || '—'}</Text>

      <Text style={st.seccion}>Empleado</Text>

      <Text style={st.label}>Cédula del empleado</Text>
      <TextInput
        style={st.input}
        value={cedulaEmpleado}
        onChangeText={handleCedulaEmpleado}
        placeholder="Ingresa la cédula"
        placeholderTextColor="#475569"
        keyboardType="numeric"
      />

      <Text style={st.label}>Nombre del empleado</Text>
      <View style={st.inputAuto}>
        <Text style={[st.inputAutoText, !nombreEmpleado && st.placeholder]}>
          {nombreEmpleado || 'Se completa automáticamente'}
        </Text>
      </View>

      <Text style={st.seccion}>Turno</Text>

      <Text style={st.label}>Fecha</Text>
      <View style={st.inputAuto}>
        <Text style={st.inputAutoText}>{fechaHoy}</Text>
      </View>

      <Text style={st.label}>Selecciona el turno</Text>
      {TURNOS.map((turno) => (
        <TouchableOpacity
          key={turno}
          style={[st.turnoCard, turnoSeleccionado === turno && st.turnoActivo]}
          onPress={() => setTurnoSeleccionado(turno)}
        >
          <View style={[st.radio, turnoSeleccionado === turno && st.radioActivo]} />
          <Text style={[st.turnoText, turnoSeleccionado === turno && st.turnoTextActivo]}>
            {turno}
          </Text>
        </TouchableOpacity>
      ))}

      <TouchableOpacity style={[st.btn, cargando && st.btnDisabled]} onPress={handleIniciarTurno} disabled={cargando}>
        {cargando
          ? <ActivityIndicator color="#fff" />
          : <Text style={st.btnText}>Iniciar turno →</Text>
        }
      </TouchableOpacity>

    </ScrollView>
  );
}

const st = StyleSheet.create({
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
  turnoCard:       { flexDirection: 'row', alignItems: 'center', gap: 12,
                     backgroundColor: '#1e293b', borderRadius: 10, padding: 16,
                     marginBottom: 10, borderWidth: 1, borderColor: '#334155' },
  turnoActivo:     { borderColor: '#6366f1', backgroundColor: '#1e1b4b' },
  radio:           { width: 20, height: 20, borderRadius: 10,
                     borderWidth: 2, borderColor: '#475569' },
  radioActivo:     { borderColor: '#6366f1', backgroundColor: '#6366f1' },
  turnoText:       { fontSize: 15, color: '#94a3b8' },
  turnoTextActivo: { color: '#f1f5f9', fontWeight: '600' },
  btn:             { backgroundColor: '#6366f1', borderRadius: 14,
                     padding: 18, alignItems: 'center', marginTop: 24 },
  btnDisabled:     { opacity: 0.6 },
  btnText:         { color: '#fff', fontSize: 17, fontWeight: '700' },
});