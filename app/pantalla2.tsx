import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { obtenerOrdenGlobal } from '../store/useOrdenStore';
import {
  apiIniciarTurno, apiValidarEmpleado, apiGetResumenTurno,
  guardarTurnoId, obtenerOrdenId, obtenerTurnoId,
} from '../store/api';
import { KoreLogo } from '../components/KoreLogo';

const TURNOS = [
  '6:00 am - 6:00 pm',
  '6:00 pm - 6:00 am',
  '6:30 am - 2:00 pm',
  '6:00 am - 4:00 pm',
];

function fechaLocalColombia(): string {
  const ahora     = new Date();
  const offsetMin = ahora.getTimezoneOffset();
  const local     = new Date(ahora.getTime() - offsetMin * 60 * 1000);
  return local.toISOString().split('T')[0];
}

let turnoGlobal: {
  cedulaEmpleado: string; nombreEmpleado: string;
  fecha: string; turno: string; horaInicio: string;
} | null = null;

export function guardarTurnoGlobal(datos: typeof turnoGlobal) { turnoGlobal = datos; }
export function obtenerTurnoGlobal() { return turnoGlobal; }

export default function Pantalla2() {
  const router = useRouter();
  const orden  = obtenerOrdenGlobal();

  const [cedulaEmpleado,    setCedulaEmpleado]    = useState('');
  const [nombreEmpleado,    setNombreEmpleado]    = useState('');
  const [errorEmpleado,     setErrorEmpleado]     = useState('');
  const [buscandoEmpleado,  setBuscandoEmpleado]  = useState(false);
  const [turnoSeleccionado, setTurnoSeleccionado] = useState('');
  const [cargando,          setCargando]          = useState(false);

  const turnoActivoMostrado = useRef(false);
  const fechaHoy      = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fechaServidor = fechaLocalColombia();

  useEffect(() => {
    const verificarTurnoActivo = async () => {
      if (turnoActivoMostrado.current) return;
      const turnoId = await obtenerTurnoId();
      if (!turnoId) return;
      const ordenId = await obtenerOrdenId();
      try {
        const resumen = await apiGetResumenTurno(turnoId);
        if (resumen.hora_fin) {
          await AsyncStorage.removeItem('turno_id');
          await AsyncStorage.removeItem('turno_activo');
          guardarTurnoGlobal(null);
          return;
        }
        if (resumen.orden_id && ordenId && resumen.orden_id !== ordenId) return;
        if (!obtenerTurnoGlobal()) {
          const turnoGuardado = await AsyncStorage.getItem('turno_activo');
          if (turnoGuardado) guardarTurnoGlobal(JSON.parse(turnoGuardado));
        }
        turnoActivoMostrado.current = true;
        Alert.alert('Turno activo encontrado', '¿Deseas continuar con el turno activo o iniciar uno nuevo?', [
          { text: 'Continuar turno', onPress: () => router.replace('/pantalla3') },
          { text: 'Nuevo turno', style: 'destructive', onPress: async () => {
            await AsyncStorage.removeItem('turno_id');
            await AsyncStorage.removeItem('turno_activo');
            guardarTurnoGlobal(null);
          }},
        ]);
      } catch {
        await AsyncStorage.removeItem('turno_id');
        await AsyncStorage.removeItem('turno_activo');
        guardarTurnoGlobal(null);
      }
    };
    verificarTurnoActivo();
  }, []);

  const handleCedulaEmpleado = async (valor: string) => {
    setCedulaEmpleado(valor);
    setNombreEmpleado('');
    setErrorEmpleado('');
    if (valor.length >= 5) {
      setBuscandoEmpleado(true);
      try {
        const resp = await apiValidarEmpleado(valor);
        setNombreEmpleado(resp.nombre);
        setErrorEmpleado('');
      } catch {
        setNombreEmpleado('');
        if (valor.length >= 6) setErrorEmpleado('Empleado no encontrado. Verifica la cédula.');
      } finally { setBuscandoEmpleado(false); }
    }
  };

  const handleIniciarTurno = async () => {
    if (!cedulaEmpleado) { Alert.alert('Campos incompletos', 'Ingresa la cédula del empleado'); return; }
    if (buscandoEmpleado) { Alert.alert('Espera', 'Buscando empleado en el sistema...'); return; }
    if (!nombreEmpleado || nombreEmpleado === 'Empleado no encontrado') {
      Alert.alert('Empleado inválido', 'La cédula ingresada no corresponde a ningún empleado registrado'); return;
    }
    if (!turnoSeleccionado) { Alert.alert('Selecciona un turno', 'Debes seleccionar el turno antes de continuar'); return; }

    setCargando(true);
    try {
      const ordenId = await obtenerOrdenId();
      if (!ordenId) { Alert.alert('Error', 'No se encontró la orden activa.'); setCargando(false); return; }

      const ahora      = new Date();
      const horaInicio = ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
      const datosTurno = { cedulaEmpleado, nombreEmpleado, fecha: fechaHoy, turno: turnoSeleccionado, horaInicio };
      guardarTurnoGlobal(datosTurno);
      await AsyncStorage.setItem('turno_activo', JSON.stringify(datosTurno));

      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 15000);

      try {
        const turnoIniciado = await apiIniciarTurno({
          orden_id: ordenId, cedula_empleado: cedulaEmpleado,
          nombre_empleado: nombreEmpleado, turno: turnoSeleccionado,
          hora_inicio: horaInicio, fecha: fechaServidor,
        });
        clearTimeout(timeoutId);
        await guardarTurnoId(turnoIniciado.turno_id);
        router.push('/pantalla3');
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          Alert.alert('Tiempo de espera agotado', 'El servidor tardó demasiado. Verifica la conexión e intenta de nuevo.');
        } else if (error.message?.includes('Ya existe un turno abierto')) {
          Alert.alert('Turno ya iniciado', 'Este turno ya fue creado. Toca "Continuar turno" para seguir.');
          router.replace('/pantalla3');
        } else {
          Alert.alert('Error al iniciar turno', error.message || 'No se pudo conectar al servidor');
        }
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Ocurrió un error inesperado');
    } finally { setCargando(false); }
  };

  return (
    <ScrollView style={st.container} contentContainerStyle={st.content}>
      <View style={st.header}>
        <KoreLogo size={48} dark />
        <View style={{ flex: 1 }}>
          <Text style={st.titulo}>Datos del empleado</Text>
          <Text style={st.subtitulo}>
            Orden: <Text style={st.subtituloOrden}>{orden?.numeroOrden || '—'}</Text>
          </Text>
        </View>
      </View>

      <View style={st.card}>
        <Text style={st.seccion}>EMPLEADO</Text>
        <Text style={st.label}>Cédula del empleado</Text>
        <TextInput style={st.input} value={cedulaEmpleado} onChangeText={handleCedulaEmpleado}
          placeholder="Ingresa la cédula" placeholderTextColor="#3d5568" keyboardType="numeric" />
        <Text style={st.label}>Nombre del empleado</Text>
        <View style={[st.inputAuto, errorEmpleado ? st.inputAutoError : undefined]}>
          {buscandoEmpleado ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color="#00C896" />
              <Text style={{ color: '#6b8aa0', fontSize: 14 }}>Buscando empleado...</Text>
            </View>
          ) : (
            <Text style={[st.inputAutoText, !nombreEmpleado && st.placeholder, errorEmpleado ? st.inputAutoErrorText : undefined]}>
              {errorEmpleado || nombreEmpleado || 'Se completa automáticamente'}
            </Text>
          )}
        </View>
      </View>

      <View style={st.card}>
        <Text style={st.seccion}>TURNO</Text>
        <Text style={st.label}>Fecha</Text>
        <View style={st.inputAuto}>
          <Text style={st.inputAutoText}>{fechaHoy}</Text>
        </View>
        <Text style={st.label}>Selecciona el turno</Text>
        {TURNOS.map((turno) => (
          <TouchableOpacity key={turno}
            style={[st.opcionCard, turnoSeleccionado === turno && st.opcionActiva]}
            onPress={() => setTurnoSeleccionado(turno)}>
            <View style={[st.radio, turnoSeleccionado === turno && st.radioActivo]} />
            <Text style={[st.opcionText, turnoSeleccionado === turno && st.opcionTextActivo]}>{turno}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={[st.btn, cargando && st.btnDisabled]} onPress={handleIniciarTurno} disabled={cargando}>
        {cargando ? <ActivityIndicator color="#0F1923" /> : <Text style={st.btnText}>Iniciar turno →</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#0F1923' },
  content:            { padding: 20, paddingTop: 52, paddingBottom: 48 },
  header:             { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 28 },
  titulo:             { fontSize: 22, fontWeight: '800', color: '#F5F5F5' },
  subtitulo:          { fontSize: 13, color: '#6b8aa0', marginTop: 2 },
  subtituloOrden:     { color: '#00C896', fontWeight: '700' },
  card:               { backgroundColor: '#162029', borderRadius: 12, borderWidth: 1, borderColor: '#243040', padding: 16, marginBottom: 14 },
  seccion:            { fontSize: 11, fontWeight: '700', color: '#00C896', letterSpacing: 1.2, marginBottom: 14 },
  label:              { fontSize: 13, color: '#6b8aa0', marginBottom: 6 },
  input:              { backgroundColor: '#1e2d3d', borderRadius: 10, padding: 14, fontSize: 15, color: '#F5F5F5', marginBottom: 14, borderWidth: 1, borderColor: '#243040' },
  inputAuto:          { backgroundColor: '#003d2e', borderRadius: 10, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#00573d' },
  inputAutoText:      { fontSize: 15, color: '#00C896' },
  inputAutoError:     { backgroundColor: '#2a1616', borderColor: '#4a2020' },
  inputAutoErrorText: { color: '#ef4444' },
  placeholder:        { color: '#1e4a3a' },
  opcionCard:         { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#1e2d3d', borderRadius: 10, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: '#243040' },
  opcionActiva:       { borderColor: '#00C896', backgroundColor: '#003d2e' },
  radio:              { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#344d62' },
  radioActivo:        { borderColor: '#00C896', backgroundColor: '#00C896' },
  opcionText:         { fontSize: 15, color: '#6b8aa0' },
  opcionTextActivo:   { color: '#F5F5F5', fontWeight: '600' },
  btn:                { backgroundColor: '#00C896', borderRadius: 12, padding: 18, alignItems: 'center', marginTop: 6, elevation: 4, shadowColor: '#00C896', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  btnDisabled:        { opacity: 0.5 },
  btnText:            { color: '#0F1923', fontSize: 17, fontWeight: '800' },
});