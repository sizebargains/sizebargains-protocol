# Size

**Name your number. Take the entire stack.**

[![Live site](https://img.shields.io/badge/site-size.bargains-informational?style=flat-square)](https://size.bargains)
[![Chain](https://img.shields.io/badge/chain-Solana-informational?style=flat-square)](https://solana.com)
[![License: MIT](https://img.shields.io/badge/license-MIT-informational?style=flat-square)](LICENSE)

| | |
|---|---|
| Chain | Solana |
| Contract address | `pending` |

## Overview

Size is a place to put a figure on an entire memecoin stack and let its holder answer yes or no. Deals settle wallet to wallet, so nothing touches an order book and no candle moves while the two sides talk.

This repository holds the public site, which also carries a live board of the busiest Solana coins.

## Features

- Live board of the ten Solana coins moving the most volume, with price, 24h change, volume, liquidity and one-tap mint copy
- Scrolling quote ticker fed by the same data
- Worked example that turns any dollar amount into a token count and a pool-drag estimate from live liquidity
- Contract slot at the top of every page, inert until an address is confirmed
- Social icons that stay inert until a link is confirmed
- Respects `prefers-reduced-motion`

## Links

- Site: https://size.bargains
- X: pending
- GitHub: pending
- Whitepaper: [docs/whitepaper.md](docs/whitepaper.md)

## Development

```bash
npm run build   # writes the deployable site to dist/
npm run gates   # build, then run every check, including both branches of each register record
npm run serve   # serve dist/ locally on port 4173
```

Deploy by uploading the `dist/` folder.

Every external fact lives in `src/register.json` as a record with a state of `stated`, `absent` or `unconfirmed`. Records that are not `stated` render as inert and never carry a value or link.

## License

MIT. See [LICENSE](LICENSE).
