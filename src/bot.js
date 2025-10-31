import dotenv from "dotenv";
dotenv.config();

import exchange from "./config/exchange.js";
import ladderConfig from "./config/ladder.config.js";
import { evaluateSymbol } from "./engine/ladderEngine.js";

let loopTimer = null;

export async function tickAll() {
  try {
    console.log("[BOT] Starting tickAll...");
    await exchange.loadMarkets();

    const liveStr = ladderConfig.live ? "LIVE" : "SIM";
    console.log(
      `[BOT] ${liveStr} | ${new Date().toISOString()} | symbols=${Object.keys(ladderConfig.coins).join(", ")}`
    );

    for (const [symbol, symbolConfig] of Object.entries(ladderConfig.coins)) {
      console.log(`[BOT] Evaluating ${symbol}...`);
      try {
        await evaluateSymbol(symbol, symbolConfig, {
          live: ladderConfig.live,
        });
        console.log(`[BOT] Finished ${symbol}`);
      } catch (e) {
        console.error(`[EVAL ERROR] ${symbol}:`, e.message);
      }
    }

    console.log("[BOT] tickAll completed ✅");
  } catch (e) {
    console.error("[TICK ERROR]", e.message);
  }
}


export function startLoop() {
  const loopSec = ladderConfig.loopSeconds || 30;
  if (loopTimer) return { running: true, loopSec };
  loopTimer = setInterval(tickAll, loopSec * 1000);
  console.log(
    `Ladder loop started. Loop=${loopSec}s, Testnet=${String(process.env.USE_TESTNET).toLowerCase() === "true"}`
  );
  return { running: true, loopSec };
}

export function stopLoop() {
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }
  console.log("Ladder loop stopped.");
  return { running: false };
}

export function isLooping() {
  return Boolean(loopTimer);
}
