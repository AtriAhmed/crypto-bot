import dotenv from "dotenv";
dotenv.config();

import exchange from "./config/exchange.js";
import ladderConfig from "./config/ladder.config.js";
import { evaluateSymbol } from "./engine/ladderEngine.js";

async function tickAll() {
  try {
    await exchange.loadMarkets();

    const liveStr = ladderConfig.live ? "LIVE" : "SIM";
    console.log(
      `[BOT] ${liveStr} | ${new Date().toISOString()} | symbols=${Object.keys(ladderConfig.coins).join(", ")}`
    );

    for (const [symbol, symbolConfig] of Object.entries(ladderConfig.coins)) {
      try {
        await evaluateSymbol(symbol, symbolConfig, {
          live: ladderConfig.live,
        });
      } catch (e) {
        console.error(`[EVAL ERROR] ${symbol}:`, e.message);
      }
    }
  } catch (e) {
    console.error("[TICK ERROR]", e.message);
  }
}

async function main() {
  const loopSec = ladderConfig.loopSeconds || 30;
  console.log(
    `Ladder bot started. Loop=${loopSec}s, Testnet=${String(process.env.USE_TESTNET).toLowerCase() === "true"}`
  );

  await tickAll();
  setInterval(tickAll, loopSec * 1000);
}

main();
