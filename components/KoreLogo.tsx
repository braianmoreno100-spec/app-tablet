// components/KoreLogo.tsx
// Logo Kore Sistem en SVG inline — usar en vez de logo_inverfarma.png
import { View } from 'react-native';
import Svg, { Rect, Line, Circle, Text as SvgText, Mask, Defs } from 'react-native-svg';

interface Props {
  size?: number   // alto en dp — el ancho se calcula proporcional
  dark?: boolean  // true = texto claro, false = texto oscuro
}

export function KoreLogo({ size = 40, dark = true }: Props) {
  // Proporción original del SVG: 680 × 225.54
  const h = size
  const w = Math.round(680 * (h / 225.54))
  const textColor = dark ? '#F5F5F5' : '#0F1923'

  return (
    <View style={{ width: w, height: h }}>
      <Svg width={w} height={h} viewBox="0 0 680 225.54">
        <Defs>
          <Mask id="kore-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="680" height="225.54">
            <Rect x="0" y="0" width="680" height="225.54" fill="white" />
            <Rect x="124" y="66.99" width="222.96" height="140.01" fill="black" rx={2} />
            <Rect x="40" y="183.99" width="249.93" height="34.00" fill="black" rx={2} />
          </Mask>
        </Defs>

        {/* Barra vertical K */}
        <Rect x="40" y="28" width="14" height="154" rx={5} fill={textColor} />

        {/* Brazo superior K */}
        <Line x1="54" y1="105" x2="130" y2="30"
          stroke={textColor} strokeWidth="11" strokeLinecap="round" />

        {/* Brazo inferior K */}
        <Line x1="54" y1="105" x2="130" y2="180"
          stroke={textColor} strokeWidth="11" strokeLinecap="round"
          mask="url(#kore-mask)" />

        {/* Punto central verde */}
        <Circle cx="54" cy="105" r="9" fill="#00C896" />

        {/* Punto superior verde */}
        <Circle cx="130" cy="30" r="10" fill="#00C896" />

        {/* Punto inferior naranja */}
        <Circle cx="130" cy="180" r="10" fill="#FF6B35" />

        {/* Texto ORE */}
        <SvgText x="128" y="175"
          fontFamily="Arial Black, Arial"
          fontSize="96"
          fontWeight="900"
          fill={textColor}>ORE</SvgText>

        {/* Texto SISTEM */}
        <SvgText x="44" y="210"
          fontFamily="Arial"
          fontSize="26"
          fontWeight="300"
          fill="#00C896">S I S T E M</SvgText>
      </Svg>
    </View>
  )
}