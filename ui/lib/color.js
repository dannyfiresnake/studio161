export function hexToRgb(hex) {
  hex = hex.replace('#', '')
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]
}

export function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export function darken(hex, amount) {
  const [r, g, b] = hexToRgb(hex)
  const f = 1 - amount
  return rgbToHex(Math.round(r * f), Math.round(g * f), Math.round(b * f))
}
