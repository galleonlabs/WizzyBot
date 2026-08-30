// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IUnaV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
    function feeAmountTickSpacing(uint24 fee) external view returns (int24 tickSpacing);
}

/// @title UnaIndexRegistry
/// @notice Canonical, versioned membership and weights for one chain's Una index.
/// @dev The registry stores only the current snapshot. Events preserve prior versions.
contract UnaIndexRegistry {
    uint256 public constant MAX_MARKETS = 32;
    uint256 public constant MAX_EVIDENCE_URI_BYTES = 200;

    struct Market {
        bytes32 id;
        address token;
        address pool;
        uint16 weightBps;
        uint24 fee;
        int24 tickSpacing;
        uint16 rangeWidthBps;
    }

    error Unauthorized();
    error ZeroAddress();
    error StaleVersion(uint64 expected, uint64 actual);
    error InvalidMarketCount(uint256 count);
    error InvalidMarket(uint256 index);
    error UnrecognizedPool(uint256 index);
    error DuplicateMarket(bytes32 id);
    error InvalidTotalWeight(uint256 totalWeightBps);
    error EvidenceRequired();
    error EvidenceUriTooLong(uint256 length);
    error RegistryIsPaused();
    error NoPendingOwner();
    error NoPendingCurator();

    event IndexPublished(uint64 indexed version, bytes32 indexed evidenceHash, uint256 marketCount, string evidenceURI);
    event RegistryPaused(bytes32 indexed reasonHash, address indexed account);
    event RegistryUnpaused(address indexed account);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event CuratorTransferStarted(address indexed curator, address indexed pendingCurator);
    event CuratorTransferred(address indexed previousCurator, address indexed newCurator);

    address public owner;
    address public pendingOwner;
    address public curator;
    address public pendingCurator;
    uint64 public version;
    uint64 public updatedAt;
    bool public paused;
    bytes32 public evidenceHash;
    string public evidenceURI;
    address public immutable FACTORY;
    address public immutable QUOTE_TOKEN;

    Market[] private _markets;

    constructor(address initialOwner, address initialCurator, address canonicalFactory, address canonicalQuoteToken) {
        if (
            initialOwner == address(0) || initialCurator == address(0) || canonicalFactory == address(0)
                || canonicalQuoteToken == address(0)
        ) revert ZeroAddress();
        if (canonicalFactory.code.length == 0 || canonicalQuoteToken.code.length == 0) revert ZeroAddress();
        owner = initialOwner;
        curator = initialCurator;
        FACTORY = canonicalFactory;
        QUOTE_TOKEN = canonicalQuoteToken;
        emit OwnershipTransferred(address(0), initialOwner);
        emit CuratorTransferred(address(0), initialCurator);
    }

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    modifier onlyPublisher() {
        _checkPublisher();
        _;
    }

    function _checkOwner() private view {
        if (msg.sender != owner) revert Unauthorized();
    }

    function _checkPublisher() private view {
        if (msg.sender != owner && msg.sender != curator) revert Unauthorized();
    }

    /// @notice Atomically replaces the whole index. The caller must name the version it read.
    function publish(
        uint64 expectedVersion,
        Market[] calldata nextMarkets,
        bytes32 nextEvidenceHash,
        string calldata nextEvidenceURI
    ) external onlyPublisher {
        if (paused) revert RegistryIsPaused();
        if (expectedVersion != version) revert StaleVersion(expectedVersion, version);
        if (nextEvidenceHash == bytes32(0)) revert EvidenceRequired();
        if (bytes(nextEvidenceURI).length > MAX_EVIDENCE_URI_BYTES) {
            revert EvidenceUriTooLong(bytes(nextEvidenceURI).length);
        }
        uint256 count = nextMarkets.length;
        if (count == 0 || count > MAX_MARKETS) revert InvalidMarketCount(count);

        uint256 totalWeightBps;
        for (uint256 i; i < count; ++i) {
            Market calldata market = nextMarkets[i];
            if (
                market.id == bytes32(0) || market.token == address(0) || market.pool == address(0)
                    || market.weightBps == 0 || market.fee == 0 || market.tickSpacing <= 0 || market.rangeWidthBps == 0
                    || market.rangeWidthBps >= 10_000
            ) revert InvalidMarket(i);
            if (
                market.token.code.length == 0
                    || IUnaV3Factory(FACTORY).getPool(market.token, QUOTE_TOKEN, market.fee) != market.pool
                    || IUnaV3Factory(FACTORY).feeAmountTickSpacing(market.fee) != market.tickSpacing
            ) revert UnrecognizedPool(i);
            for (uint256 j; j < i; ++j) {
                if (nextMarkets[j].id == market.id) revert DuplicateMarket(market.id);
            }
            totalWeightBps += market.weightBps;
        }
        if (totalWeightBps != 10_000) revert InvalidTotalWeight(totalWeightBps);

        delete _markets;
        for (uint256 i; i < count; ++i) {
            _markets.push(nextMarkets[i]);
        }
        unchecked {
            ++version;
        }
        updatedAt = uint64(block.timestamp);
        evidenceHash = nextEvidenceHash;
        evidenceURI = nextEvidenceURI;
        emit IndexPublished(version, nextEvidenceHash, count, nextEvidenceURI);
    }

    function getMarkets() external view returns (Market[] memory) {
        return _markets;
    }

    function marketCount() external view returns (uint256) {
        return _markets.length;
    }

    /// @notice The curator can stop new deposits immediately. Only the owner can resume them.
    function pause(bytes32 reasonHash) external onlyPublisher {
        if (reasonHash == bytes32(0)) revert EvidenceRequired();
        paused = true;
        emit RegistryPaused(reasonHash, msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit RegistryUnpaused(msg.sender);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert ZeroAddress();
        pendingOwner = nextOwner;
        emit OwnershipTransferStarted(owner, nextOwner);
    }

    function acceptOwnership() external {
        address nextOwner = pendingOwner;
        if (nextOwner == address(0) || msg.sender != nextOwner) revert NoPendingOwner();
        address previousOwner = owner;
        owner = nextOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, nextOwner);
    }

    function transferCurator(address nextCurator) external onlyOwner {
        if (nextCurator == address(0)) revert ZeroAddress();
        pendingCurator = nextCurator;
        emit CuratorTransferStarted(curator, nextCurator);
    }

    function acceptCurator() external {
        address nextCurator = pendingCurator;
        if (nextCurator == address(0) || msg.sender != nextCurator) revert NoPendingCurator();
        address previousCurator = curator;
        curator = nextCurator;
        pendingCurator = address(0);
        emit CuratorTransferred(previousCurator, nextCurator);
    }
}
