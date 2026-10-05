// Decode a Google-encoded polyline (as returned by OpenRouteService, 1e-5 degree precision)
// into an array of [lat, lng] pairs. Malformed trailing data is ignored.
export function decodePolyline(encoded) {
  if (typeof encoded !== 'string') return [];

  const coords = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  const readValue = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      if (index >= encoded.length) return null;
      byte = encoded.charCodeAt(index) - 63;
      index += 1;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };

  while (index < encoded.length) {
    const dLat = readValue();
    const dLng = readValue();
    if (dLat === null || dLng === null) break;
    lat += dLat;
    lng += dLng;
    coords.push([lat / 1e5, lng / 1e5]);
  }
  return coords;
}
