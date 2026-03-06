export function hexToFixedBytes(hex: string, byteLength: number): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  const output = new Uint8Array(byteLength);
  for (let i = 0; i < Math.min(normalized.length / 2, byteLength); i += 1) {
    output[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return output;
}
