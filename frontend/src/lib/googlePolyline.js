/**
 * Decode Google's encoded polyline format to { lat, lng }[].
 * Truncated trailing chunks are dropped (same tolerance as backend seed data).
 * @param {string} encoded
 * @returns {{ lat: number, lng: number }[]}
 */
export function decodeGooglePolyline(encoded) {
  if (!encoded || typeof encoded !== "string") return [];
  let s = encoded.trim();
  if (s.startsWith("{")) s = s.slice(1);
  if (s.endsWith("}")) s = s.slice(0, -1);
  s = s.trim();
  if (!s) return [];

  const decodeOnce = (str) => {
    let index = 0;
    let lat = 0;
    let lng = 0;
    const coordinates = [];
    const nextByte = () => {
      if (index >= str.length) throw new Error("eof");
      return str.charCodeAt(index++) - 63;
    };
    while (index < str.length) {
      let b;
      let shift = 0;
      let result = 0;
      do {
        b = nextByte();
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = result & 1 ? ~(result >> 1) : result >> 1;
      lat += dlat;

      shift = 0;
      result = 0;
      do {
        b = nextByte();
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = result & 1 ? ~(result >> 1) : result >> 1;
      lng += dlng;

      coordinates.push({ lat: lat * 1e-5, lng: lng * 1e-5 });
    }
    return coordinates;
  };

  const maxTrim = Math.min(32, s.length);
  for (let drop = 0; drop <= maxTrim; drop += 1) {
    try {
      const slice = drop === 0 ? s : s.slice(0, s.length - drop);
      if (!slice) return [];
      return decodeOnce(slice);
    } catch {
      /* truncated tail — try shorter */
    }
  }
  return [];
}

/** Reject clearly broken decodes outside Telangana demo bounds. */
export function polylineLooksLikeTelangana(pts) {
  if (!Array.isArray(pts) || pts.length < 2) return false;
  const chunk = pts.slice(0, 24);
  return chunk.every((p) => {
    const la = Number(p.lat);
    const ln = Number(p.lng);
    return Number.isFinite(la) && Number.isFinite(ln) && la >= 15 && la <= 20.5 && ln >= 77 && ln <= 81.5;
  });
}
