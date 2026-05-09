import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ScrollView, Alert, ActivityIndicator, Image
} from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { obtenerOrdenGlobal } from '../store/useOrdenStore';
import {
  apiIniciarTurno, apiValidarEmpleado, apiGetResumenTurno,
  guardarTurnoId, obtenerOrdenId, obtenerTurnoId,
} from '../store/api';

const TURNOS = [
  '6:00 am - 6:00 pm',
  '6:00 pm - 6:00 am',
  '6:30 am - 2:00 pm',
  '6:00 am - 4:00 pm',
];

// FIX E10: función fecha local Colombia (UTC-5) para evitar desfase de día
function fechaLocalColombia(): string {
  const ahora     = new Date();
  const offsetMin = ahora.getTimezoneOffset(); // minutos detrás de UTC
  const local     = new Date(ahora.getTime() - offsetMin * 60 * 1000);
  return local.toISOString().split('T')[0]; // YYYY-MM-DD en hora local
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

  // FIX E12: flag para evitar mostrar Alert de turno activo más de una vez por sesión
  const turnoActivoMostrado = useRef(false);

  const fechaHoy      = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fechaServidor = fechaLocalColombia(); // FIX E10: usar hora local

  useEffect(() => {
    const verificarTurnoActivo = async () => {
      // FIX E12: solo mostrar Alert una vez por sesión en esta pantalla
      if (turnoActivoMostrado.current) return;
      const turnoId = await obtenerTurnoId();
      if (!turnoId) return;
      try {
        const resumen = await apiGetResumenTurno(turnoId);
        if (resumen.hora_fin) {
          await AsyncStorage.removeItem('turno_id');
          await AsyncStorage.removeItem('turno_activo');
          guardarTurnoGlobal(null);
          return;
        }
        if (!obtenerTurnoGlobal()) {
          const turnoGuardado = await AsyncStorage.getItem('turno_activo');
          if (turnoGuardado) guardarTurnoGlobal(JSON.parse(turnoGuardado));
        }
        turnoActivoMostrado.current = true; // FIX E12: marcar como mostrado
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

  // FIX E8: buscar empleado en onChangeText cuando hay suficientes dígitos
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
        if (valor.length >= 6) {
          setErrorEmpleado('Empleado no encontrado. Verifica la cédula.');
        }
      } finally {
        setBuscandoEmpleado(false);
      }
    }
  };

  const handleIniciarTurno = async () => {
    // FIX E8: validar explícitamente que el nombre esté cargado
    if (!cedulaEmpleado) {
      Alert.alert('Campos incompletos', 'Ingresa la cédula del empleado'); return;
    }
    if (buscandoEmpleado) {
      Alert.alert('Espera', 'Buscando empleado en el sistema...'); return;
    }
    if (!nombreEmpleado || nombreEmpleado === 'Empleado no encontrado') {
      Alert.alert('Empleado inválido', 'La cédula ingresada no corresponde a ningún empleado registrado'); return;
    }
    if (!turnoSeleccionado) {
      Alert.alert('Selecciona un turno', 'Debes seleccionar el turno antes de continuar'); return;
    }

    setCargando(true);
    try {
      const ordenId = await obtenerOrdenId();
      if (!ordenId) { Alert.alert('Error', 'No se encontró la orden activa.'); setCargando(false); return; }

      // FIX E9: capturar hora JUSTO ANTES de enviar, después de todas las validaciones
      const ahora      = new Date();
      const horaInicio = ahora.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

      const datosTurno = { cedulaEmpleado, nombreEmpleado, fecha: fechaHoy, turno: turnoSeleccionado, horaInicio };
      guardarTurnoGlobal(datosTurno);
      await AsyncStorage.setItem('turno_activo', JSON.stringify(datosTurno));

      // FIX E11: timeout de 15 segundos para evitar spinner infinito
      const controller = new AbortController();
      const timeoutId  = setTimeout(() => controller.abort(), 15000);

      try {
        const turnoIniciado = await apiIniciarTurno({
          orden_id:        ordenId,
          cedula_empleado: cedulaEmpleado,
          nombre_empleado: nombreEmpleado,
          turno:           turnoSeleccionado,
          hora_inicio:     horaInicio,
          fecha:           fechaServidor,
        });
        clearTimeout(timeoutId);
        await guardarTurnoId(turnoIniciado.turno_id);
        router.push('/pantalla3');
      } catch (error: any) {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
          Alert.alert('Tiempo de espera agotado', 'El servidor tardó demasiado. Verifica la conexión e intenta de nuevo.');
        } else if (error.message?.includes('Ya existe un turno abierto')) {
          // FIX E11: mensaje claro si el turno ya existe por doble tap
          Alert.alert('Turno ya iniciado', 'Este turno ya fue creado. Toca "Continuar turno" para seguir.');
          router.replace('/pantalla3');
        } else {
          Alert.alert('Error al iniciar turno', error.message || 'No se pudo conectar al servidor');
        }
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Ocurrió un error inesperado');
    } finally {
      setCargando(false);
    }
  };

  return (
    <ScrollView style={st.container} contentContainerStyle={st.content}>
      <View style={st.header}>
        <Image source={require('../assets/logo_inverfarma.png')} style={st.logo} resizeMode="contain" />
        <View>
          <Text style={st.titulo}>Datos del empleado</Text>
          <Text style={st.subtitulo}>
            Orden: <Text style={st.subtituloOrden}>{orden?.numeroOrden || '—'}</Text>
          </Text>
        </View>
      </View>

      {/* ── Empleado ── */}
      <View style={st.card}>
        <Text style={st.seccion}>EMPLEADO</Text>
        <Text style={st.label}>Cédula del empleado</Text>
        {/* FIX E8: onChangeText llama directo, sin necesidad de onBlur */}
        <TextInput
          style={st.input} value={cedulaEmpleado} onChangeText={handleCedulaEmpleado}
          placeholder="Ingresa la cédula" placeholderTextColor="#555" keyboardType="numeric"
        />
        <Text style={st.label}>Nombre del empleado</Text>
        <View style={[
          st.inputAuto,
          errorEmpleado ? st.inputAutoError : undefined,
        ]}>
          {buscandoEmpleado ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ActivityIndicator size="small" color="#5A9E2F" />
              <Text style={{ color: '#888', fontSize: 14 }}>Buscando empleado...</Text>
            </View>
          ) : (
            <Text style={[
              st.inputAutoText,
              !nombreEmpleado && st.placeholder,
              errorEmpleado ? st.inputAutoErrorText : undefined,
            ]}>
              {errorEmpleado || nombreEmpleado || 'Se completa automáticamente'}
            </Text>
          )}
        </View>
      </View>

      {/* ── Turno ── */}
      <View style={st.card}>
        <Text style={st.seccion}>TURNO</Text>
        <Text style={st.label}>Fecha</Text>
        <View style={st.inputAuto}>
          <Text style={st.inputAutoText}>{fechaHoy}</Text>
        </View>
        <Text style={st.label}>Selecciona el turno</Text>
        {TURNOS.map((turno) => (
          <TouchableOpacity
            key={turno}
            style={[st.opcionCard, turnoSeleccionado === turno && st.opcionActiva]}
            onPress={() => setTurnoSeleccionado(turno)}
          >
            <View style={[st.radio, turnoSeleccionado === turno && st.radioActivo]} />
            <Text style={[st.opcionText, turnoSeleccionado === turno && st.opcionTextActivo]}>{turno}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <TouchableOpacity style={[st.btn, cargando && st.btnDisabled]} onPress={handleIniciarTurno} disabled={cargando}>
        {cargando ? <ActivityIndicator color="#fff" /> : <Text style={st.btnText}>Iniciar turno →</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#181818' },
  content:            { padding: 20, paddingTop: 52, paddingBottom: 48 },
  header:             { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 24 },
  logo:               { width: 52, height: 52 },
  titulo:             { fontSize: 22, fontWeight: '800', color: '#f0f0f0' },
  subtitulo:          { fontSize: 13, color: '#888', marginTop: 2 },
  subtituloOrden:     { color: '#7ec44f', fontWeight: '700' },
  card:               { backgroundColor: '#222', borderRadius: 12, borderWidth: 1, borderColor: '#2e2e2e', padding: 16, marginBottom: 14 },
  seccion:            { fontSize: 11, fontWeight: '700', color: '#5A9E2F', letterSpacing: 1.2, marginBottom: 14 },
  label:              { fontSize: 13, color: '#888', marginBottom: 6 },
  input:              { backgroundColor: '#2a2a2a', borderRadius: 10, padding: 14, fontSize: 15, color: '#f0f0f0', marginBottom: 14, borderWidth: 1, borderColor: '#383838' },
  inputAuto:          { backgroundColor: '#1e2a16', borderRadius: 10, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#2d3f20' },
  inputAutoText:      { fontSize: 15, color: '#7ec44f' },
  inputAutoError:     { backgroundColor: '#2a1616', borderColor: '#4a2020' },
  inputAutoErrorText: { color: '#ef4444' },
  placeholder:        { color: '#3a4a30' },
  opcionCard:         { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#2a2a2a', borderRadius: 10, padding: 15, marginBottom: 10, borderWidth: 1, borderColor: '#383838' },
  opcionActiva:       { borderColor: '#5A9E2F', backgroundColor: '#1e2a16' },
  radio:              { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#555' },
  radioActivo:        { borderColor: '#5A9E2F', backgroundColor: '#5A9E2F' },
  opcionText:         { fontSize: 15, color: '#888' },
  opcionTextActivo:   { color: '#f0f0f0', fontWeight: '600' },
  btn:                { backgroundColor: '#5A9E2F', borderRadius: 12, padding: 18, alignItems: 'center', marginTop: 6, elevation: 4, shadowColor: '#5A9E2F', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  btnDisabled:        { opacity: 0.5 },
  btnText:            { color: '#fff', fontSize: 17, fontWeight: '800' },
});