// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Script.sol";
import "../src/V3Utils.sol";

/// @notice Deploys revert-finance V3Utils on Robinhood Chain, pointed at the
/// canonical Uniswap v3 position manager and SwapRouter02.
///
///   forge script script/DeployV3Utils.s.sol --rpc-url https://rpc.mainnet.chain.robinhood.com \
///     --broadcast --interactives 1
contract DeployV3Utils is Script {
    // Canonical Robinhood Chain deployments (mirrors src/chains.ts).
    INonfungiblePositionManager constant NFPM =
        INonfungiblePositionManager(0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3);
    address constant SWAP_ROUTER_02 = 0xCaf681a66D020601342297493863E78C959E5cb2;

    function run() external {
        vm.startBroadcast();
        V3Utils utils = new V3Utils(NFPM, SWAP_ROUTER_02);
        vm.stopBroadcast();
        console2.log("V3Utils deployed:", address(utils));
        console2.log("weth:", address(utils.weth()));
    }
}
