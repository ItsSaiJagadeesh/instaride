/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). Draws a QR code for a UPI payment link. Pure JavaScript, no native code. */
import React, { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import qrcode from 'qrcode-generator';

const QUIET = 4; // blank border, in QR squares: scanners need it

export default function UpiQr({ value, size = 220, label }: { value: string; size?: number; label?: string }) {
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, 'L'); // low error correction on purpose: fewer, bigger squares scan better from a phone screen
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    // One rectangle per run of dark squares in a row. Each is a hair taller than a square so rows overlap and no thin gaps show between them.
    let path = '';
    for (let r = 0; r < count; r++) {
      let c = 0;
      while (c < count) {
        if (!qr.isDark(r, c)) { c++; continue; }
        const start = c;
        while (c < count && qr.isDark(r, c)) c++;
        path += `M${start + QUIET} ${r + QUIET}h${c - start}v1.02h-${c - start}z`;
      }
    }
    return { n: count, d: path };
  }, [value]);
  const total = n + QUIET * 2;
  return (
    <View accessible accessibilityLabel={label ?? 'UPI QR code'} style={{ width: size, height: size, backgroundColor: '#FFFFFF', borderRadius: 8, overflow: 'hidden' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${total} ${total}`}>
        <Rect x={0} y={0} width={total} height={total} fill="#FFFFFF" />
        <Path d={d} fill="#000000" />
      </Svg>
    </View>
  );
}
