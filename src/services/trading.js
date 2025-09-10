import exchange from "../config/exchange.js";

// Buy using QUOTE amount (USDT)
export async function buyWithQuote(symbol, usdtAmount) {
  return exchange.createOrder(symbol, "market", "buy", undefined, undefined, {
    quoteOrderQty: Number(usdtAmount),
  });
}

// Sell specified BASE amount
export async function sellMarketAmount(symbol, baseAmount) {
  return exchange.createOrder(symbol, "market", "sell", Number(baseAmount));
}

// Get free balance of the base asset
export async function getBaseFree(symbol) {
  const base = symbol.split("/")[0];
  const bal = await exchange.fetchBalance();
  return bal?.free?.[base] || 0;
}

// Market metadata/precision
export async function getMarket(symbol) {
  await exchange.loadMarkets();
  return exchange.market(symbol);
}

export default {
  buyWithQuote,
  sellMarketAmount,
  getBaseFree,
  getMarket,
};
