// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Intake} from "../src/Intake.sol";

/// @notice Robinhood Chain mainnet (4663) addresses and the floor's fixed basket.
library Config {
    uint256 internal constant CHAIN_ID = 4663;

    address internal constant WIF = 0x5173b8eA6923c2d40267890D45C46a3480954773;
    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;

    // Uniswap
    address internal constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant SWAP_ROUTER_02 = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant POSITION_MANAGER = 0x58daec3116aae6D93017bAAea7749052E8a04fA7;
    address internal constant STATE_VIEW = 0xF3334192D15450CdD385c8B70e03f9A6bD9E673b;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    /// @notice The deepest native-ETH / WIF v4 pool (Pons), read by the lens for a display price.
    bytes32 internal constant WIF_POOL_ID = 0x71ef4106340f0a3b9c19ec994eef4fc44a1d2513f38faac39d7636b156548c79;

    // ERC-4337 / EIP-7702
    address internal constant ENTRY_POINT_V08 = 0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108;
    address internal constant SIMPLE_7702_ACCOUNT = 0xe6Cae83BdE06E4c305530e199D7217f42808555B;

    // Chainlink proxies (8 decimals)
    address internal constant ETH_USD = 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9;
    address internal constant USDG_USD = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;

    // Basket. Index 0 is the cash leg; index 1 (SPY) is the ballot's default.
    address internal constant SGOV = 0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5;
    address internal constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address internal constant QQQ = 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68;
    address internal constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address internal constant TSLA = 0x322F0929c4625eD5bAd873c95208D54E1c003b2d;
    address internal constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address internal constant MSFT = 0xe93237C50D904957Cf27E7B1133b510C669c2e74;
    address internal constant GOOGL = 0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3;
    address internal constant AMZN = 0x12f190a9F9d7D37a250758b26824B97CE941bF54;
    address internal constant META = 0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35;

    address internal constant SGOV_USD = 0xa0DF4ee0fFf975306345875E3548Fcc519577A11;
    address internal constant SPY_USD = 0x319724394D3A0e3669269846abE664Cd621f9f6A;
    address internal constant QQQ_USD = 0x80901d846d5D7B030F26B480776EE3b29374C2ae;
    address internal constant NVDA_USD = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    address internal constant TSLA_USD = 0x4A1166a659A55625345e9515b32adECea5547C38;
    address internal constant AAPL_USD = 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0;
    address internal constant MSFT_USD = 0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E;
    address internal constant GOOGL_USD = 0xF6f373a037c30F0e5010d854385cA89185AE638b;
    address internal constant AMZN_USD = 0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C;
    address internal constant META_USD = 0x7C38C00C30BEe9378381E7B6135d7283356D71b1;

    uint256 internal constant DEFAULT_OPTION = 1; // SPY
    uint256 internal constant MAX_USD_PER_WINDOW = 1_000e8; // $1,000 per hour
    uint256 internal constant PAYMASTER_MIN_BURN = 100e18; // 100 WIF per sponsored operation
    uint256 internal constant PAYMASTER_MAX_COST = 0.001 ether;

    function basket() internal pure returns (address[] memory assets, address[] memory feeds) {
        assets = new address[](10);
        feeds = new address[](10);
        (assets[0], feeds[0]) = (SGOV, SGOV_USD);
        (assets[1], feeds[1]) = (SPY, SPY_USD);
        (assets[2], feeds[2]) = (QQQ, QQQ_USD);
        (assets[3], feeds[3]) = (NVDA, NVDA_USD);
        (assets[4], feeds[4]) = (TSLA, TSLA_USD);
        (assets[5], feeds[5]) = (AAPL, AAPL_USD);
        (assets[6], feeds[6]) = (MSFT, MSFT_USD);
        (assets[7], feeds[7]) = (GOOGL, GOOGL_USD);
        (assets[8], feeds[8]) = (AMZN, AMZN_USD);
        (assets[9], feeds[9]) = (META, META_USD);
    }

    /// @notice Fixed Uniswap v3 routes into each basket asset, from USDG and from WETH.
    ///         Each leg is the deepest official v3 pool for that pair as of 2026-10-30.
    function routes() internal pure returns (Intake.Route[] memory r) {
        r = new Intake.Route[](10);
        r[0] = _viaUsdg(SGOV, 3000);
        r[1] = _viaWeth(SPY, 500);
        r[2] = _viaUsdg(QQQ, 500);
        r[3] = _viaUsdg(NVDA, 500);
        r[4] = _viaUsdg(TSLA, 3000);
        r[5] = _viaWeth(AAPL, 500);
        r[6] = _viaUsdg(MSFT, 3000);
        r[7] = _viaUsdg(GOOGL, 500);
        r[8] = _viaUsdg(AMZN, 3000);
        r[9] = _viaWeth(META, 3000);
    }

    /// @dev Asset quoted against USDG: USDG -> X, and WETH -> USDG -> X.
    function _viaUsdg(address x, uint24 fee) private pure returns (Intake.Route memory) {
        return Intake.Route({
            fromUsdg: abi.encodePacked(USDG, fee, x),
            fromWeth: abi.encodePacked(WETH, uint24(500), USDG, fee, x)
        });
    }

    /// @dev Asset quoted against WETH: USDG -> WETH -> X, and WETH -> X.
    function _viaWeth(address x, uint24 fee) private pure returns (Intake.Route memory) {
        return Intake.Route({
            fromUsdg: abi.encodePacked(USDG, uint24(500), WETH, fee, x),
            fromWeth: abi.encodePacked(WETH, fee, x)
        });
    }
}
