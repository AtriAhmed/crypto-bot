import crypto from "crypto";
import exchange from "../config/exchange.js";
import { fetchOHLCV, getTickerPrice } from "../services/marketData.js";
import {
  buyWithQuote,
  sellMarketAmount,
  getBaseFree,
  getMarket,
} from "../services/trading.js";
import { loadState, saveState } from "../state/store.js";

/* ────────────── config helpers ────────────── */
const FEE_PCT = Number(process.env.PAPER_FEE_PCT || "0.1"); // %
const SLIPPAGE_BPS = Number(process.env.PAPER_SLIPPAGE_BPS || "2"); // bps

function nowIso() {
  return new Date().toISOString();
}

function slipPriceMid(price, side) {
  // Positive slippage for buys (worse price), negative for sells (worse exit)
  const m = SLIPPAGE_BPS / 10000; // convert bps to fraction
  if (side === "buy") return price * (1 + m);
  if (side === "sell") return price * (1 - m);
  return price;
}

function feeQuote(quote) {
  return (quote * FEE_PCT) / 100;
}

// Round base amount to market precision/step and check min limits
function normalizeBaseAmount(market, baseAmt) {
  const prec = market?.precision?.amount ?? 8;
  const step = Math.pow(10, -prec);
  const rounded = Math.floor(baseAmt / step) * step;
  const min = market?.limits?.amount?.min ?? 0;
  if (rounded <= 0 || (min && rounded < min)) return 0;
  return Number(rounded.toFixed(prec));
}

function meetsMinNotional(market, cost) {
  const minCost = market?.limits?.cost?.min || 0;
  return minCost ? cost >= minCost : true;
}

// Safe comparison
function cmp(op, left, right) {
  if (op === "gte") return left >= right;
  if (op === "lte") return left <= right;
  if (op === "gt") return left > right;
  if (op === "lt") return left < right;
  if (op === "eq") return left === right;
  throw new Error(`Unsupported op: ${op}`);
}

/* Evaluate a step’s trigger vs current price and (optionally) against each lot */
function triggerSatisfied(step, price, lotOrNull) {
  const { trigger } = step;
  if (!trigger) return false;

  if (trigger.type === "price") {
    return cmp(trigger.op, price, trigger.value);
  }

  if (trigger.type === "percent_from_lot_entry") {
    if (!lotOrNull) return false;
    const pct = ((price - lotOrNull.entryPrice) / lotOrNull.entryPrice) * 100;
    return cmp(trigger.op, pct, trigger.value);
  }

  if (trigger.type === "percent_from_reference") {
    const { reference } = trigger;
    let refPrice;
    if (reference?.kind === "custom") refPrice = reference.value;
    else if (reference?.kind === "last_close") {
      const closes = reference.closes || [];
      const lastClose = closes.at(-1);
      if (!lastClose) return false;
      refPrice = lastClose;
    } else {
      throw new Error("percent_from_reference requires reference.kind");
    }
    const pct = ((price - refPrice) / refPrice) * 100;
    return cmp(trigger.op, pct, trigger.value);
  }

  return false;
}

/* Compute sell base qty from 'amount' descriptor + specific lot */
function baseQtyFromSellAmount(amountDesc, lot, currentPrice) {
  const remBase = lot.remainingBaseQty;

  if (amountDesc.type === "lot_percent") {
    const pct = Math.max(0, Math.min(100, Number(amountDesc.value)));
    return (remBase * pct) / 100;
  }

  if (amountDesc.type === "lot_quote") {
    const desiredQuote = Number(amountDesc.value);
    if (desiredQuote <= 0) return 0;
    const base = desiredQuote / currentPrice;
    return Math.min(base, remBase);
  }

  if (amountDesc.type === "base") {
    return Math.min(Number(amountDesc.value), remBase);
  }

  throw new Error(`Unsupported sell amount.type: ${amountDesc.type}`);
}

/* Pick lots to consume for a sell step */
function selectLots(state, symbol, selector) {
  const openLots = state.lots.filter(
    (l) => l.symbol === symbol && l.remainingBaseQty > 0
  );

  if (!openLots.length) return [];

  if (selector && selector.entryId) {
    return openLots.filter((l) => l.entryStepId === selector.entryId);
  }

  if (selector === "fifo") {
    return [...openLots].sort((a, b) => a.entryTs - b.entryTs);
  }

  if (selector === "lifo") {
    return [...openLots].sort((a, b) => b.entryTs - a.entryTs);
  }

  return [...openLots].sort((a, b) => a.entryTs - b.entryTs);
}

function canFireStep(state, step) {
  if (step.repeatable) {
    if (step.maxFires == null) return true;
    const fired = state.stepsFired[step.id] || 0;
    return fired < step.maxFires;
  }
  const fired = state.stepsFired[step.id] || 0;
  return fired === 0;
}

function recordStepFire(state, step) {
  state.stepsFired[step.id] = (state.stepsFired[step.id] || 0) + 1;
}

/* ────────────── PAPER MODE wallet helpers ────────────── */
function ensureAsset(state, asset) {
  if (state.balances[asset] == null) state.balances[asset] = 0;
}

function addTrade(state, trade) {
  state.trades.push(trade);
}

/* Update realized PnL when selling a specific lot:
   - We remove a fraction f = soldBase / lot.remainingBaseQty
   - Proportional cost removed = lot.remainingCostQuote * f
   - PnL += (netProceedsQuote - proportionalCost)
*/
function realizeLotPnL(state, lot, soldBase, netProceedsQuote) {
  const remBase = lot.remainingBaseQty;
  if (remBase <= 0) return;

  const f = Math.min(1, soldBase / remBase);
  const proportionalCost = (lot.remainingCostQuote || 0) * f;

  const pnl = netProceedsQuote - proportionalCost;
  state.realizedPnlUSDT = Number((state.realizedPnlUSDT + pnl).toFixed(6));

  // Reduce lot remaining cost and base
  lot.remainingCostQuote = Number(((lot.remainingCostQuote || 0) * (1 - f)).toFixed(6));
  lot.remainingBaseQty = Number((lot.remainingBaseQty - soldBase).toFixed(8));
  if (lot.remainingBaseQty < 1e-8) {
    lot.remainingBaseQty = 0;
    lot.remainingCostQuote = 0;
  }
}

/* ────────────── main evaluation per symbol ────────────── */

export async function evaluateSymbol(symbol, symbolConfig, global) {
  await exchange.loadMarkets();
  const market = await getMarket(symbol);
  const base = market.base;
  const quote = market.quote;

  // for percent_from_reference:last_close
  const candles = await fetchOHLCV(symbol, "1m", 50);
  const closes = candles.map((c) => c.close);

  const priceMid = await getTickerPrice(symbol);

  const state = loadState();

  // Pass 1 – BUY steps
  for (const step of symbolConfig.steps.filter((s) => s.side === "buy")) {
    if (!canFireStep(state, step)) continue;

    const stepForCheck =
      step.trigger?.type === "percent_from_reference" &&
      step.trigger?.reference?.kind === "last_close"
        ? {
            ...step,
            trigger: {
              ...step.trigger,
              reference: { kind: "last_close", closes },
            },
          }
        : step;

    const ok = triggerSatisfied(stepForCheck, priceMid, null);
    if (!ok) {
  console.log(`[STEP SKIP] ${symbol} step=${step.id} trigger not satisfied`);
  continue;
}


    // Determine cost and base to buy
    let desiredQuote, baseAmt;
    const fillPrice = slipPriceMid(priceMid, "buy");

    if (step.amount.type === "quote") {
      desiredQuote = Number(step.amount.value);
      baseAmt = desiredQuote / fillPrice;
    } else if (step.amount.type === "base") {
      baseAmt = Number(step.amount.value);
      desiredQuote = baseAmt * fillPrice;
    } else {
      console.log(`[WARN] Unsupported BUY amount.type ${step.amount.type}`);
      continue;
    }

    // Respect precision & min notional
    baseAmt = normalizeBaseAmount(market, baseAmt);
    const cost = Number((baseAmt * fillPrice).toFixed(6));
    if (!meetsMinNotional(market, cost)) {
      console.log(`[SKIP] ${symbol} BUY ${step.id} min notional not met: cost=${cost}`);
      continue;
    }
    if (baseAmt <= 0) {
      console.log(`[SKIP] ${symbol} BUY ${step.id} base=0 after precision`);
      continue;
    }

    if (global.live) {
      // REAL ORDER
      try {
        if (step.amount.type === "quote") {
          console.log(`[BUY] ${symbol} step=${step.id} price≈${priceMid} quote=${desiredQuote} ...`);
          const order = await buyWithQuote(symbol, desiredQuote);
          const filledBase = Number(order?.filled) || baseAmt;
          const execQuote = (order?.cost != null) ? Number(order.cost) : Number((filledBase * priceMid).toFixed(6));
          state.lots.push({
            id: crypto.randomUUID(),
            symbol,
            entryStepId: step.id,
            entryPrice: priceMid,
            entryTs: Date.now(),
            baseQty: filledBase,
            remainingBaseQty: filledBase,
            remainingCostQuote: execQuote, // what we paid for the lot
          });
        } else {
          console.log(`[BUY] ${symbol} step=${step.id} price≈${priceMid} base=${baseAmt} ...`);
          const order = await exchange.createOrder(symbol, "market", "buy", baseAmt);
          const filledBase = Number(order?.filled) || baseAmt;
          const execQuote = (order?.cost != null) ? Number(order.cost) : Number((filledBase * priceMid).toFixed(6));
          state.lots.push({
            id: crypto.randomUUID(),
            symbol,
            entryStepId: step.id,
            entryPrice: priceMid,
            entryTs: Date.now(),
            baseQty: filledBase,
            remainingBaseQty: filledBase,
            remainingCostQuote: execQuote,
          });
        }
      } catch (e) {
        console.error(`[BUY ERROR] ${symbol} step=${step.id}:`, e.message);
        continue;
      }
    } else {
      // PAPER ORDER
      ensureAsset(state, quote);
      ensureAsset(state, base);

      const feeQ = Number(feeQuote(cost).toFixed(6));
      const netQuoteSpend = Number((cost + feeQ).toFixed(6));

      if (state.balances[quote] < netQuoteSpend) {
        console.log(`[SKIP] ${symbol} step=${step.id} not enough ${quote}: need=${netQuoteSpend} bal=${state.balances[quote]}`);
        continue;
      }

      state.balances[quote] = Number((state.balances[quote] - netQuoteSpend).toFixed(6));
      state.balances[base] = Number((state.balances[base] + baseAmt).toFixed(8));

      state.lots.push({
        id: crypto.randomUUID(),
        symbol,
        entryStepId: step.id,
        entryPrice: fillPrice, // use slipped fill as entry
        entryTs: Date.now(),
        baseQty: baseAmt,
        remainingBaseQty: baseAmt,
        // include fee in cost (fee charged in quote on buy for simplicity)
        remainingCostQuote: netQuoteSpend,
      });

      addTrade(state, {
        ts: Date.now(),
        side: "buy",
        symbol,
        price: fillPrice,
        baseQty: baseAmt,
        quoteQty: cost,
        feeQuote: feeQ,
        stepId: step.id,
      });

      console.log(`[SIM BUY] ${symbol} step=${step.id} @${fillPrice.toFixed(6)} base=${baseAmt} cost=${cost} fee=${feeQ}  ${nowIso()}`);
    }

    recordStepFire(state, step);
    saveState(state);
  }

  // Pass 2 – SELL steps
  for (const step of symbolConfig.steps.filter((s) => s.side === "sell")) {
    if (!canFireStep(state, step)) continue;

    // candidate lots
    const lots = selectLots(state, symbol, step.match);

    for (const lot of lots) {
      const ok = triggerSatisfied(step, priceMid, lot);
      if (!ok) {
        console.log(`[STEP] ${symbol} ${step.id} not triggered. reason=condition_false`);
        continue
      }

      const fillPrice = slipPriceMid(priceMid, "sell");
      let baseToSell;
      try {
        baseToSell = baseQtyFromSellAmount(step.amount, lot, fillPrice);
      } catch (e) {
        console.error(`[SELL ERROR] ${symbol} step=${step.id}: ${e.message}`);
        continue;
      }

      if (baseToSell <= 0) {
  console.log(`[STEP SKIP] ${symbol} step=${step.id} baseToSell=0`);
  continue;
}


      // precision & min notional
      const m = await getMarket(symbol);
      baseToSell = normalizeBaseAmount(m, baseToSell);
      const grossQuote = Number((baseToSell * fillPrice).toFixed(6));
      if (!meetsMinNotional(m, grossQuote)) {
        console.log(`[SKIP] ${symbol} SELL ${step.id} min notional not met: cost=${grossQuote}`);
        continue;
      }
if (baseToSell <= 0) {
  console.log(`[STEP SKIP] ${symbol} step=${step.id} baseToSell=0`);
  continue;
}


      if (global.live) {
        // REAL ORDER
        try {
          console.log(`[SELL] ${symbol} step=${step.id} lot=${lot.entryStepId} @≈${priceMid} base=${baseToSell} ...`);
          await sellMarketAmount(symbol, baseToSell);
        } catch (e) {
          console.error(`[SELL ERROR] ${symbol} step=${step.id}:`, e.message);
          continue;
        }
      } else {
        // PAPER ORDER
        ensureAsset(state, quote);
        ensureAsset(state, base);

        if (state.balances[base] + 1e-12 < baseToSell) {
          console.log(`[SKIP] ${symbol} step=${step.id} not enough ${base}: need=${baseToSell} bal=${state.balances[base]}`);
          continue;
        }

        const feeQ = Number(feeQuote(grossQuote).toFixed(6));
        const netQuote = Number((grossQuote - feeQ).toFixed(6));

        // wallet
        state.balances[base] = Number((state.balances[base] - baseToSell).toFixed(8));
        state.balances[quote] = Number((state.balances[quote] + netQuote).toFixed(6));

        // realize PnL vs the specific lot
        realizeLotPnL(state, lot, baseToSell, netQuote);

        addTrade(state, {
          ts: Date.now(),
          side: "sell",
          symbol,
          price: fillPrice,
          baseQty: baseToSell,
          quoteQty: grossQuote,
          feeQuote: feeQ,
          stepId: step.id,
          lotRef: lot.entryStepId,
        });

        console.log(`[SIM SELL] ${symbol} step=${step.id} lot=${lot.entryStepId} @${fillPrice.toFixed(6)} base=${baseToSell} proceeds=${grossQuote} fee=${feeQ}  ${nowIso()}`);
      }

      // Fired
      recordStepFire(state, step);
      saveState(state);

      if (!step.repeatable) break;
    }
  }
}
