import exchange from "../config/exchange.js";

export async function fetchOHLCV(symbol, timeframe = "1m", limit = 200) {
  const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
  return candles.map(c => ({
    time: c[0],
    open: c[1],
    high: c[2],
    low: c[3],
    close: c[4],
    volume: c[5],
  }));
}

export async function getTickerPrice(symbol) {
  const t = await exchange.fetchTicker(symbol);
  return t.last;
}
