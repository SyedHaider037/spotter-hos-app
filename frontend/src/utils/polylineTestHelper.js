// Test-only helper: encodes [lat, lng] points as a Google polyline (the inverse of decodePolyline).
function encodeValue(value) {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

export function encodePolyline(points) {
  let prevLat = 0;
  let prevLng = 0;
  let out = '';
  points.forEach(([lat, lng]) => {
    const latI = Math.round(lat * 1e5);
    const lngI = Math.round(lng * 1e5);
    out += encodeValue(latI - prevLat) + encodeValue(lngI - prevLng);
    prevLat = latI;
    prevLng = lngI;
  });
  return out;
}
