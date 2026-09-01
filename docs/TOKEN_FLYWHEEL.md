# Wizzy token and treasury plan

Status: the product is a menu of individually reviewed meme markets. It does not create an index, basket, target allocation, or automatic bid for WIZZY.

## Product boundary

- WIZZY can appear only as its own selectable WIZZY/WETH market after the same contract, pool, liquidity, volume, and identity review applied to other markets.
- Choosing another market never buys, sells, or LPs WIZZY.
- Withdrawing another position never touches WIZZY.
- The curator may pause WIZZY for the same safety reasons as any other market. It cannot manufacture volume, route user orders into WIZZY, or trade to defend its price.
- A token launch, market listing, treasury trade, and application deployment are separate actions with separate review and evidence.

## Fees and token rights

Current product fees route to the dedicated Wizzy treasury at `0x2520B4BA71D2a026803cce0e5C72eDa4a20B0C42`.

| Action | Implemented charge | Destination |
| --- | --- | --- |
| Create a market position | 0.15% of the gross amount | Wizzy treasury |
| Reinvest position fees | 2% of the fees being reinvested | Wizzy treasury |
| Withdraw a position | 0.15% of the conservative withdrawal basis | Wizzy treasury |
| Rebalance | 0.15% of the conservative rebalance basis | Wizzy treasury |

WIZZY holders have no automatic claim on fees, revenue, treasury assets, buybacks, yield, or application governance. Changing that boundary requires separate implementation, independent legal review, explicit disclosure, and a new release.

Treasury-owned liquidity must be disclosed as treasury-owned liquidity. It is not a buyback unless the treasury actually purchases tokens, and it must never be described as guaranteed demand, price support, yield, or a floor.

## Market-listing gate

Before WIZZY is listed as a selectable market, record:

- verified token source, bytecode, supply, owner powers, allocations, and material holder concentration;
- the canonical WIZZY/WETH pool, fee tier, liquidity, age, and genuine volume;
- transfer restrictions, tax mechanics, blacklist or mint powers, and other security findings;
- usable execution depth for the minimum and representative position sizes;
- related-party and treasury disclosures;
- an independent legal review of the current product and public communications.

The market must remain useful as an opt-in LP opportunity without being bundled into other deposits. Pause or abort on unexpected owner power, tax, mint authority, recipient, pool mismatch, misleading social account, abnormal volume, missing disclosure, or unsafe execution.

## Release sequence

1. Confirm the canonical token and graduated pool from independent chain data.
2. Complete the market-listing evidence record.
3. Add WIZZY/WETH to `src/config/markets.json` as one ordinary reviewed market, with no weight or special sleeve flag.
4. Run the complete test, typecheck, and production-build gate.
5. Ship through the normal release path and verify the single WIZZY row, quote, LP recipient, fee disclosure, and position actions live.
6. Publish one canonical post with the contract, pool, supply disclosure, related-party status, treasury links, and anti-scam warning.

Public-identity separation and launch checks are defined in [Launch privacy](LAUNCH_PRIVACY.md). Market review policy is defined in [Market curation](CURATION.md).
