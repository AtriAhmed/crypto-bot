import { EMA, RSI } from "technicalindicators";
export function calculateEMA(values, period) {
  return EMA.calculate({ period, values });
}
export function calculateRSI(values, period = 14) {
  return RSI.calculate({ period, values });
}
