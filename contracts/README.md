# Wizzy contracts

## V3Utils (vendored from revert-finance)

`src/V3Utils.sol` is [revert-finance/v3utils](https://github.com/revert-finance/v3utils) at `main`, unmodified. MIT-licensed, ownerless, stateless (holds no funds or NFTs between transactions), audited by Peckshield. It is the external-wallet contract layer for the product:

- `swapAndMint` — one token in (native ETH or WETH), swap to both sides, mint the position NFT to the caller. The zap-in.
- `execute(tokenId, instructions)` — `COMPOUND_FEES` / `CHANGE_RANGE` / `WITHDRAW_AND_COLLECT_AND_SWAP` in one transaction each, with the NFT always returned to the caller in the same transaction.
- `swapAndIncreaseLiquidity` — top up an existing position from one token.

Swaps: `swapData = abi.encode(allowanceTarget, routerCalldata)` executed against the immutable `swapRouter` with balance-delta accounting and an `amountOutMin` floor. On Robinhood the router is SwapRouter02 and the app's quote engine produces `exactInputSingle` calldata with `recipient = V3Utils`.

## Toolchain

Foundry. Dependencies are the exact commits revert pins, recorded in `foundry.lock` (`lib/` is not committed — restore it once):

```bash
cd contracts
forge install
forge build
```

## Deploying on Robinhood Chain

The deploy is a single ownerless contract creation from any funded key — the deployer retains no power afterwards.

```bash
cd contracts
forge script script/DeployV3Utils.s.sol \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --broadcast --interactives 1
```

Record the deployed address in `src/chains.ts` (`v3Utils`) and verify `weth()` matches the canonical WETH (`0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`) before wiring the app.
