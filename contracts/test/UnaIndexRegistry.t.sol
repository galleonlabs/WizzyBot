// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {UnaIndexRegistry} from "../src/UnaIndexRegistry.sol";

interface Vm {
    function prank(address sender) external;
    function expectRevert(bytes4 selector) external;
    function expectRevert(bytes calldata revertData) external;
    function assume(bool condition) external;
}

contract MockToken {}

contract MockPool {}

contract MockFactory {
    mapping(bytes32 => address) private _pools;
    mapping(uint24 => int24) public feeAmountTickSpacing;

    function setPool(address tokenA, address tokenB, uint24 fee, int24 tickSpacing, address pool) external {
        _pools[_key(tokenA, tokenB, fee)] = pool;
        feeAmountTickSpacing[fee] = tickSpacing;
    }

    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address) {
        return _pools[_key(tokenA, tokenB, fee)];
    }

    function _key(address tokenA, address tokenB, uint24 fee) private pure returns (bytes32) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        return keccak256(abi.encode(token0, token1, fee));
    }
}

contract UnaIndexRegistryTest {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant CURATOR = address(0xC0A7);
    address private constant NEXT_CURATOR = address(0xC0A8);
    address private constant ATTACKER = address(0xBAD);
    address private constant NEXT_OWNER = address(0xA11CE);
    bytes32 private constant EVIDENCE = keccak256("curator-report-v1");

    UnaIndexRegistry private registry;
    MockFactory private factory;
    MockToken private quoteToken;
    MockToken private tokenA;
    MockToken private tokenB;
    MockPool private poolA;
    MockPool private poolB;

    function setUp() public {
        factory = new MockFactory();
        quoteToken = new MockToken();
        tokenA = new MockToken();
        tokenB = new MockToken();
        poolA = new MockPool();
        poolB = new MockPool();
        factory.setPool(address(tokenA), address(quoteToken), 10_000, 200, address(poolA));
        factory.setPool(address(tokenB), address(quoteToken), 3_000, 60, address(poolB));
        registry = new UnaIndexRegistry(address(this), CURATOR, address(factory), address(quoteToken));
    }

    function testCuratorPublishesAtomicSnapshot() public {
        UnaIndexRegistry.Market[] memory markets = _markets();
        VM.prank(CURATOR);
        registry.publish(0, markets, EVIDENCE, "ipfs://report-v1");

        assert(registry.version() == 1);
        assert(registry.marketCount() == 2);
        assert(registry.evidenceHash() == EVIDENCE);
        UnaIndexRegistry.Market[] memory stored = registry.getMarkets();
        assert(stored[0].id == keccak256("cashcat"));
        assert(stored[0].weightBps == 6_000);
        assert(stored[1].weightBps == 4_000);
    }

    function testRejectsUnauthorizedPublisher() public {
        VM.expectRevert(UnaIndexRegistry.Unauthorized.selector);
        VM.prank(ATTACKER);
        registry.publish(0, _markets(), EVIDENCE, "ipfs://report-v1");
    }

    function testRejectsStaleVersion() public {
        VM.prank(CURATOR);
        registry.publish(0, _markets(), EVIDENCE, "ipfs://report-v1");

        VM.expectRevert(abi.encodeWithSelector(UnaIndexRegistry.StaleVersion.selector, uint64(0), uint64(1)));
        VM.prank(CURATOR);
        registry.publish(0, _markets(), keccak256("report-v2"), "ipfs://report-v2");
    }

    function testRejectsInvalidWeightTotal() public {
        UnaIndexRegistry.Market[] memory markets = _markets();
        markets[1].weightBps = 3_999;
        VM.expectRevert(abi.encodeWithSelector(UnaIndexRegistry.InvalidTotalWeight.selector, uint256(9_999)));
        VM.prank(CURATOR);
        registry.publish(0, markets, EVIDENCE, "ipfs://report-v1");
    }

    function testFuzzRejectsAnyNonCanonicalWeightTotal(uint16 firstWeight, uint16 secondWeight) public {
        VM.assume(firstWeight > 0 && secondWeight > 0);
        uint256 total = uint256(firstWeight) + uint256(secondWeight);
        VM.assume(total != 10_000);
        UnaIndexRegistry.Market[] memory markets = _markets();
        markets[0].weightBps = firstWeight;
        markets[1].weightBps = secondWeight;
        VM.expectRevert(abi.encodeWithSelector(UnaIndexRegistry.InvalidTotalWeight.selector, total));
        VM.prank(CURATOR);
        registry.publish(0, markets, EVIDENCE, "ipfs://report-v1");
    }

    function testRejectsMissingEvidenceAndOversizedUri() public {
        VM.expectRevert(UnaIndexRegistry.EvidenceRequired.selector);
        VM.prank(CURATOR);
        registry.publish(0, _markets(), bytes32(0), "");

        string memory oversized = string(new bytes(201));
        VM.expectRevert(abi.encodeWithSelector(UnaIndexRegistry.EvidenceUriTooLong.selector, uint256(201)));
        VM.prank(CURATOR);
        registry.publish(0, _markets(), EVIDENCE, oversized);
    }

    function testRejectsDuplicateMarketId() public {
        UnaIndexRegistry.Market[] memory markets = _markets();
        markets[1].id = markets[0].id;
        VM.expectRevert(abi.encodeWithSelector(UnaIndexRegistry.DuplicateMarket.selector, markets[0].id));
        VM.prank(CURATOR);
        registry.publish(0, markets, EVIDENCE, "ipfs://report-v1");
    }

    function testRejectsPoolNotRegisteredByCanonicalFactory() public {
        UnaIndexRegistry.Market[] memory markets = _markets();
        markets[0].pool = address(poolB);
        VM.expectRevert(abi.encodeWithSelector(UnaIndexRegistry.UnrecognizedPool.selector, uint256(0)));
        VM.prank(CURATOR);
        registry.publish(0, markets, EVIDENCE, "ipfs://report-v1");
    }

    function testRecordsAStableSlotReplacementOnchain() public {
        VM.prank(CURATOR);
        registry.publish(0, _markets(), EVIDENCE, "ipfs://report-v1");

        UnaIndexRegistry.Market[] memory next = _markets();
        next[0] = UnaIndexRegistry.Market({
            id: keccak256("cashcat-v2"),
            token: address(tokenA),
            pool: address(poolA),
            weightBps: 6_000,
            fee: 10_000,
            tickSpacing: 200,
            rangeWidthBps: 6_000
        });
        VM.prank(CURATOR);
        registry.publish(1, next, keccak256("curator-report-v2"), "ipfs://report-v2");

        assert(registry.replacementOf(keccak256("cashcat")) == keccak256("cashcat-v2"));
        assert(registry.version() == 2);
    }

    function testRejectsReplacementThatChangesTheIndexSlot() public {
        VM.prank(CURATOR);
        registry.publish(0, _markets(), EVIDENCE, "ipfs://report-v1");

        UnaIndexRegistry.Market[] memory next = _markets();
        next[0].id = keccak256("cashcat-v2");
        next[0].weightBps = 5_999;
        next[1].weightBps = 4_001;
        VM.expectRevert(abi.encodeWithSelector(UnaIndexRegistry.InvalidReplacement.selector, uint256(0)));
        VM.prank(CURATOR);
        registry.publish(1, next, keccak256("curator-report-v2"), "ipfs://report-v2");
    }

    function testPauseIsImmediateAndOwnerControlsRecovery() public {
        VM.prank(CURATOR);
        registry.pause(keccak256("security-incident"));
        assert(registry.paused());

        VM.expectRevert(UnaIndexRegistry.RegistryIsPaused.selector);
        VM.prank(CURATOR);
        registry.publish(0, _markets(), EVIDENCE, "ipfs://report-v1");

        VM.expectRevert(UnaIndexRegistry.Unauthorized.selector);
        VM.prank(CURATOR);
        registry.unpause();

        registry.unpause();
        assert(!registry.paused());
    }

    function testOwnerAndCuratorTransfersRequireAcceptance() public {
        registry.transferCurator(NEXT_CURATOR);
        assert(registry.curator() == CURATOR);
        VM.prank(NEXT_CURATOR);
        registry.acceptCurator();
        assert(registry.curator() == NEXT_CURATOR);

        registry.transferOwnership(NEXT_OWNER);
        assert(registry.owner() == address(this));
        VM.prank(NEXT_OWNER);
        registry.acceptOwnership();
        assert(registry.owner() == NEXT_OWNER);
    }

    function _markets() private view returns (UnaIndexRegistry.Market[] memory markets) {
        markets = new UnaIndexRegistry.Market[](2);
        markets[0] = UnaIndexRegistry.Market({
            id: keccak256("cashcat"),
            token: address(tokenA),
            pool: address(poolA),
            weightBps: 6_000,
            fee: 10_000,
            tickSpacing: 200,
            rangeWidthBps: 6_000
        });
        markets[1] = UnaIndexRegistry.Market({
            id: keccak256("pons"),
            token: address(tokenB),
            pool: address(poolB),
            weightBps: 4_000,
            fee: 3_000,
            tickSpacing: 60,
            rangeWidthBps: 6_500
        });
    }
}
