export default {
  symbol: process.env.SYMBOL || "BTC/USDT",

  // how much USDT to spend per entry
  usdtPerBuy: Number(process.env.USDT_PER_BUY || "50"),

  // candles timeframe
  timeframe: process.env.TIMEFRAME || "1m",

  // strategy rules
  entry: {
    // enter when RSI is below this
    rsiBelow: Number(process.env.ENTRY_RSI_BELOW || "30"),
  },
  exit: {
    // exit when RSI above this OR TP/SL hit
    rsiAbove: Number(process.env.EXIT_RSI_ABOVE || "70"),
    takeProfitPct: Number(process.env.TAKE_PROFIT_PCT || "2.5"), // % gain
    stopLossPct: Number(process.env.STOP_LOSS_PCT || "1.5"),     // % loss
  },

  // loop every N seconds
  loopSeconds: Number(process.env.LOOP_SECONDS || "60"),
};
