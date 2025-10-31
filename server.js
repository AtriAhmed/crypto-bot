import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import morgan from "morgan";

import exchange from "./src/config/exchange.js";
import ladderConfig from "./src/config/ladder.config.js";

import { tickAll, startLoop, stopLoop, isLooping } from "./src/bot.js";
import { fetchOHLCV, getTickerPrice } from "./src/services/marketData.js";
import { loadState, resetState } from "./src/state/store.js";

const app = express();
const PORT = Number(process.env.PORT || 3000);

// Middlewares
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// Health / meta
app.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/status", async (_req, res) => {
  try {
    const testnet = String(process.env.USE_TESTNET).toLowerCase() === "true";
    const symbols = Object.keys(ladderConfig.coins);
    res.json({
      app: "ladder-bot",
      loopSeconds: ladderConfig.loopSeconds || 30,
      live: ladderConfig.live,
      testnet,
      loopRunning: isLooping(),
      symbols,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Control the loop
app.post("/loop/start", async (_req, res) => {
  console.log("[API] /loop/start called");
  try {
    const out = startLoop();
    console.log("[API] Loop started", out);
    res.json(out);
  } catch (e) {
    console.error("[API ERROR] /loop/start:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/loop/stop", async (_req, res) => {
  try {
    const out = stopLoop();
    res.json(out);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Manual tick
app.post("/tick", async (_req, res) => {
  try {
    await tickAll();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Market info
app.get("/symbols", (_req, res) => {
  res.json({ symbols: Object.keys(ladderConfig.coins) });
});

app.get("/price", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "").trim();
    if (!symbol) return res.status(400).json({ error: "symbol is required" });
    const p = await getTickerPrice(symbol);
    res.json({ symbol, price: p });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/ohlcv", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "").trim();
    const timeframe = String(req.query.timeframe || "1m");
    const limit = Number(req.query.limit || "200");
    if (!symbol) return res.status(400).json({ error: "symbol is required" });
    const data = await fetchOHLCV(symbol, timeframe, limit);
    res.json({ symbol, timeframe, limit, candles: data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Exchange market metadata
app.get("/market/:symbol", async (req, res) => {
  try {
    await exchange.loadMarkets();
    const m = exchange.market(req.params.symbol);
    res.json(m);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// State (paper mode wallet, lots, trades, pnl)
app.get("/state", (_req, res) => {
  try {
    const s = loadState();
    res.json(s);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/balances", (_req, res) => {
  try {
    const s = loadState();
    res.json({ balances: s.balances, realizedPnlUSDT: s.realizedPnlUSDT });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/lots", (_req, res) => {
  try {
    const s = loadState();
    res.json({ lots: s.lots });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/trades", (_req, res) => {
  try {
    const s = loadState();
    res.json({ trades: s.trades });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Reset state (paper mode)
// ⚠️ Only use in development; protect in prod (add auth/ip allowlist, etc.)
app.post("/state/reset", (_req, res) => {
  try {
    const s = resetState();
    res.json({ ok: true, state: s });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Optional: toggle LIVE at runtime (in-memory only; restart resets from file)
app.post("/config/live", (req, res) => {
  try {
    const { live } = req.body || {};
    ladderConfig.live = Boolean(live);
    res.json({ live: ladderConfig.live });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Express ladder-bot listening on http://localhost:${PORT}`);
});
