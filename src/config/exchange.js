import ccxt from "ccxt";
import dotenv from "dotenv";
dotenv.config();

const exchange = new ccxt.binance({
  apiKey: process.env.API_KEY,
  secret: process.env.API_SECRET,
  enableRateLimit: true,
});

if (process.env.USE_TESTNET === "true") {
  exchange.setSandboxMode(true);
  console.log("🚀 Using Binance Testnet");
}

export default exchange;

