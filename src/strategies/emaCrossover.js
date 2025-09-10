import { calculateEMA } from "../utils/indicators.js";

export function emaCrossoverStrategy(closes) {
  const shortEMA = calculateEMA(closes, 9);
  const longEMA = calculateEMA(closes, 21);
  const lastShort = shortEMA.at(-1);
  const lastLong = longEMA.at(-1);

  if (lastShort > lastLong) return "BUY";
  if (lastShort < lastLong) return "SELL";
  return "HOLD";
}

