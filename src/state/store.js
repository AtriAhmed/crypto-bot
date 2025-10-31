import fs from "fs";
import path from "path";

const DATA_DIR = path.resolve("./data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function initialState() {
  return {
    // open buy lots
    lots: [], // { id, symbol, entryStepId, entryPrice, entryTs, baseQty, remainingBaseQty, remainingCostQuote }

    // how many times a step fired
    stepsFired: {},

    // paper-trading wallet (asset => free)
    balances: {
      USDT: Number(process.env.PAPER_STARTING_USDT || "10000"),
    },

    // realized PnL in quote (USDT)
    realizedPnlUSDT: 0,

    // trade history
    trades: [],
  };
}

export function loadState() {
  ensureDir();
  if (!fs.existsSync(STATE_FILE)) {
    const init = initialState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(init, null, 2));
    return init;
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    const s = JSON.parse(raw);
    // migrate fields if missing
    if (!s.balances) s.balances = { USDT: Number(process.env.PAPER_STARTING_USDT || "10000") };
    if (typeof s.realizedPnlUSDT !== "number") s.realizedPnlUSDT = 0;
    if (!Array.isArray(s.trades)) s.trades = [];
    if (!Array.isArray(s.lots)) s.lots = [];
    if (!s.stepsFired) s.stepsFired = {};
    return s;
  } catch {
    const init = initialState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(init, null, 2));
    return init;
  }
}

export function saveState(state) {
  ensureDir();
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
  console.log("[STATE] Saved state:", {
    balances: state.balances,
    lots: state.lots.length,
    trades: state.trades.length,
    pnl: state.realizedPnlUSDT,
  });
}


export function resetState() {
  ensureDir();
  const init = initialState();
  fs.writeFileSync(STATE_FILE, JSON.stringify(init, null, 2));
  return init;
}
