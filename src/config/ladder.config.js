// config/ladder.config.js
export default {
  // Polling loop seconds
  loopSeconds: Number(process.env.LOOP_SECONDS || "30"),

  // Global: live trading switch (if false => simulate & log only)
  live: String(process.env.LIVE || "false").toLowerCase() === "true",

  // Exchange symbol format: "SOL/USDT", "BTC/USDT", etc.
  coins: {
    "SOL/USDT": {
      steps: [
        // BUY at absolute prices (stairs down)
        {
          id: "sol_buy_180",
          side: "buy",
          repeatable: false,
          trigger: { type: "price", op: "lte", value: 180 },
          amount: { type: "quote", value: 100 }, // spend $100
        },
        {
          id: "sol_buy_160",
          side: "buy",
          repeatable: false,
          trigger: { type: "price", op: "lte", value: 160 },
          amount: { type: "quote", value: 120 }, // spend $120
        },

        // SELL what was bought at 160 when price >= 180
        {
          id: "sol_sell_from_160_at_180",
          side: "sell",
          match: { entryId: "sol_buy_160" }, // target that specific lot
          repeatable: false,
          trigger: { type: "price", op: "gte", value: 180 },
          amount: { type: "lot_quote", value: 120 }, // sell the $120-notional from that lot
        },

        // SELL what was bought at 180 only if price >= 200
        {
          id: "sol_sell_from_180_at_200",
          side: "sell",
          match: { entryId: "sol_buy_180" },
          repeatable: false,
          trigger: { type: "price", op: "gte", value: 200 },
          amount: { type: "lot_percent", value: 100 }, // close the whole lot
        },

        // Example % trigger: take +12% relative to each lot’s own entry price
        {
          id: "sol_take_12_from_any",
          side: "sell",
          match: "fifo", // or "lifo"
          repeatable: true,
          maxFires: 10,
          trigger: { type: "percent_from_lot_entry", op: "gte", value: 12 },
          amount: { type: "lot_percent", value: 50 }, // trim 50% of whichever lot triggers first
        },
      ],
    },

    // Another example with BTC
    "BTC/USDT": {
      steps: [
        {
          id: "btc_buy_60000",
          side: "buy",
          trigger: { type: "price", op: "lte", value: 60000 },
          amount: { type: "quote", value: 50 },
        },
        {
          id: "btc_sell_plus_5",
          side: "sell",
          match: "lifo",
          repeatable: true,
          trigger: { type: "percent_from_lot_entry", op: "gte", value: 5 }, // +5% from that lot’s entry
          amount: { type: "lot_percent", value: 100 },
        },
      ],
    },
  },
};
