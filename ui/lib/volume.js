// Volume math (matches Flutter's splToDb / dbToSpl)
const DB_MIN = -60, DB_MAX = 10, SLIDER_MAX = 20, DESIRED_0DB = 14
const GAMMA = Math.log(DESIRED_0DB / SLIDER_MAX) / Math.log(-DB_MIN / (DB_MAX - DB_MIN))
const CURRENT_0DB = SLIDER_MAX * Math.pow(-DB_MIN / (DB_MAX - DB_MIN), GAMMA)
const SCALE_FACTOR = DESIRED_0DB / CURRENT_0DB

export function splToDb(spl) {
  if (spl <= 0) return -144
  const s = Math.min(spl, SLIDER_MAX)
  const scaledPos = s / SCALE_FACTOR
  const x = Math.pow(scaledPos / SLIDER_MAX, 1 / GAMMA)
  const val = x * (DB_MAX - DB_MIN) + DB_MIN
  return Math.round(val * 10) / 10
}

const DB_VALS = Array.from({ length: 21 }, (_, i) => splToDb(i))

export function dbToSpl(db) {
  db = Math.round(db * 10) / 10
  for (let i = 0; i < DB_VALS.length; i++) {
    if (db <= DB_VALS[i]) return i
  }
  return DB_VALS.length - 1
}
