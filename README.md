# btc-race-24h-20261118-1444

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/Skyzee2704/btc-race-24h-20261118-1444/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/Skyzee2704/btc-race-24h-20261118-1444/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

A dip-ladder swing bot for cbBTC. It buys sharp intraday dips in two tiers against the rolling 60-bar high (half the cash at −140 bps, the rest at −220 bps), exits at +160 bps take-profit or −220 bps stop-loss from the average entry, and falls back to a smaller dip (or a fresh 30-bar high) once four hours of the window are left, so a window never ends with zero trades. The bot is a pure function of the bars it is sent — no clock, no environment, no randomness, no network — so two runs on the same window produce byte-identical action logs.

## Run it

```sh
# Grade it on the dev window the way the server does (needs the kit):
node cli/makefun.mjs grade-local --kit <kit-dir> --bot . --driver process
# The harness itself runs the bot as a plain process:
node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=8mpyaw0z&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
