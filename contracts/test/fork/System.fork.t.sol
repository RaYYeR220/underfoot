// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolModifyLiquidityTest} from "v4-core/test/PoolModifyLiquidityTest.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {IStockToken} from "../../src/interfaces/IStockToken.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {IWETH} from "../../src/interfaces/IWETH.sol";
import {OracleLib} from "../../src/libraries/OracleLib.sol";
import {Intake} from "../../src/Intake.sol";
import {UnderfootLens} from "../../src/UnderfootLens.sol";
import {Config} from "../../script/Config.sol";
import {Deployment, UnderfootDeployer} from "../../script/Deploy.s.sol";

/// @notice The whole system against real Robinhood Chain state: real $WIF, real Stock Tokens,
///         real Chainlink feeds, real Uniswap v3 pools and the real v4 PoolManager.
///
/// Stock feeds update 24/5. Tests that move time forward re-stamp each feed's real answer with
/// the current time (see `_freshFeeds`) so the suite also runs on weekends; the stale-feed test
/// shows what happens without that.
contract SystemForkTest is Test, UnderfootDeployer {
    Deployment d;
    address sponsor = makeAddr("sponsor");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    IERC20 wif = IERC20(Config.WIF);

    function setUp() public {
        vm.createSelectFork(vm.envOr("ROBINHOOD_RPC_URL", string("https://rpc.mainnet.chain.robinhood.com")));
        d = _deployAll(sponsor, address(this));
        _freshFeeds();
    }

    // ------------------------------------------------------------- intake

    function test_fork_convertEthBuysCashLegAndDefaultTarget() public {
        d.intake.fund{value: 0.05 ether}();
        (uint256 cashOut, uint256 targetOut) = d.intake.convert(true, 0.05 ether);

        assertGt(cashOut, 0);
        assertGt(targetOut, 0);
        assertEq(IERC20(Config.SGOV).balanceOf(address(d.floor)), cashOut);
        assertEq(IERC20(Config.SPY).balanceOf(address(d.floor)), targetOut);

        // value bought is within the band of what went in
        uint256 inUsd = 0.05 ether * _price(Config.ETH_USD) / 1e18;
        uint256 outUsd = (cashOut * _price(Config.SGOV_USD) + targetOut * _price(Config.SPY_USD)) / 1e18;
        assertGe(outUsd * 10_000, inUsd * (10_000 - 200));
        assertLe(outUsd, inUsd * 101 / 100);
        // 20/80 split
        uint256 cashUsd = cashOut * _price(Config.SGOV_USD) / 1e18;
        assertApproxEqRel(cashUsd, inUsd / 5, 0.03e18);
    }

    function test_fork_convertUsdg() public {
        _buyUsdg(address(d.intake), 0.03 ether);
        (, uint256 usdg) = d.intake.pending();
        assertGt(usdg, 0);
        (uint256 cashOut, uint256 targetOut) = d.intake.convert(false, usdg);
        assertGt(cashOut, 0);
        assertGt(targetOut, 0);
        (, usdg) = d.intake.pending();
        assertEq(usdg, 0);
    }

    function test_fork_everyRouteWorks() public {
        // vote each option in turn and convert, so all 10 fixed routes are exercised
        deal(Config.WIF, alice, 100_000e18);
        for (uint256 opt = 1; opt < 10; ++opt) {
            vm.startPrank(alice);
            wif.approve(address(d.ballot), 1e18);
            d.ballot.vote(opt, 1e18);
            vm.stopPrank();
            vm.warp(d.ballot.epochEnd(d.ballot.currentEpoch()));
            _freshFeeds();
            assertEq(d.ballot.currentTarget(), opt);

            d.intake.fund{value: 0.002 ether}();
            (uint256 cashOut, uint256 targetOut) = d.intake.convert(true, 0.002 ether);
            assertGt(cashOut, 0, "cash leg");
            assertGt(targetOut, 0, "target");
            assertEq(IERC20(d.floor.asset(opt)).balanceOf(address(d.floor)), targetOut);

            _buyUsdg(address(d.intake), 0.002 ether);
            (, uint256 usdg) = d.intake.pending();
            (cashOut, targetOut) = d.intake.convert(false, usdg);
            assertGt(targetOut, 0, "target from usdg");
        }
    }

    function test_fork_voteMovesTomorrowsBuy() public {
        deal(Config.WIF, alice, 10_000e18);
        uint256 supply = wif.totalSupply();
        vm.startPrank(alice);
        wif.approve(address(d.ballot), 5_000e18);
        d.ballot.vote(3, 5_000e18); // NVDA
        vm.stopPrank();
        assertEq(wif.totalSupply(), supply - 5_000e18);

        assertEq(d.ballot.currentTarget(), 1); // still SPY today
        vm.warp(d.ballot.epochEnd(0));
        _freshFeeds();
        d.intake.fund{value: 0.01 ether}();
        (, uint256 targetOut) = d.intake.convert(true, 0.01 ether);
        assertEq(IERC20(Config.NVDA).balanceOf(address(d.floor)), targetOut);
    }

    // ------------------------------------------------- intake refusals

    function test_fork_refusesWhenMarketsClosed() public {
        d.intake.fund{value: 0.01 ether}();
        vm.clearMockedCalls();
        vm.warp(block.timestamp + 27 hours);
        vm.expectPartialRevert(OracleLib.StaleFeed.selector);
        d.intake.convert(true, 0.01 ether);
        (uint256 eth,) = d.intake.pending();
        assertEq(eth, 0.01 ether, "nothing moved");
    }

    function test_fork_refusesPausedStockToken() public {
        d.intake.fund{value: 0.01 ether}();
        vm.mockCall(Config.SPY, abi.encodeCall(IStockToken.paused, ()), abi.encode(true));
        vm.expectRevert(abi.encodeWithSelector(Intake.StockPaused.selector, Config.SPY));
        d.intake.convert(true, 0.01 ether);
    }

    function test_fork_refusesPausedOracle() public {
        d.intake.fund{value: 0.01 ether}();
        vm.mockCall(Config.SGOV, abi.encodeCall(IStockToken.oraclePaused, ()), abi.encode(true));
        vm.expectRevert(abi.encodeWithSelector(Intake.StockPaused.selector, Config.SGOV));
        d.intake.convert(true, 0.01 ether);
    }

    function test_fork_refusesWhenPoolDriftsPastBand() public {
        d.intake.fund{value: 0.01 ether}();
        // Chainlink now says SPY is 5% cheaper than the pool: buying at the pool would overpay
        (, int256 answer,,,) = IAggregatorV3(Config.SPY_USD).latestRoundData();
        _mockFeed(Config.SPY_USD, answer * 95 / 100);
        vm.expectRevert();
        d.intake.convert(true, 0.01 ether);
    }

    function test_fork_refusesOutsideSizeLimits() public {
        d.intake.fund{value: 1 ether}();
        vm.expectPartialRevert(Intake.OutsideLimits.selector);
        d.intake.convert(true, 1 ether); // > $500
        vm.expectPartialRevert(Intake.OutsideLimits.selector);
        d.intake.convert(true, 0.0001 ether); // < $1
    }

    function test_fork_intakeBurnsWifAndForwardsStock() public {
        deal(Config.WIF, bob, 1_000e18);
        uint256 supply = wif.totalSupply();
        vm.prank(bob);
        wif.transfer(address(d.intake), 1_000e18);
        d.intake.sweep();
        assertEq(wif.totalSupply(), supply - 1_000e18);

        deal(Config.WIF, bob, 500e18);
        vm.startPrank(bob);
        wif.approve(address(d.intake), 500e18);
        d.intake.fundToken(Config.WIF, 500e18);
        vm.stopPrank();
        assertEq(wif.totalSupply(), supply - 1_500e18);
    }

    // ------------------------------------------------------------ redeem

    function test_fork_redeemPaysRealStockTokens() public {
        d.intake.fund{value: 0.1 ether}();
        d.intake.convert(true, 0.1 ether);
        uint256 sgov = IERC20(Config.SGOV).balanceOf(address(d.floor));
        uint256 spy = IERC20(Config.SPY).balanceOf(address(d.floor));

        uint256 circ = d.floor.circulatingSupply();
        uint256 w = circ / 1000; // 0.1% of circulating WIF
        deal(Config.WIF, alice, w);
        uint256 supply = wif.totalSupply();

        vm.startPrank(alice);
        wif.approve(address(d.floor), w);
        uint256[] memory out = d.floor.redeem(w, alice, 0);
        vm.stopPrank();

        assertEq(wif.totalSupply(), supply - w);
        assertEq(IERC20(Config.SGOV).balanceOf(alice), out[0]);
        assertEq(IERC20(Config.SPY).balanceOf(alice), out[1]);
        assertApproxEqRel(out[0], sgov * 99 / 100_000, 0.001e18);
        assertApproxEqRel(out[1], spy * 99 / 100_000, 0.001e18);
    }

    // -------------------------------------------------------------- hook

    function test_fork_hookPoolOnRealPoolManager() public {
        IPoolManager pm = IPoolManager(Config.POOL_MANAGER);
        PoolModifyLiquidityTest lp = new PoolModifyLiquidityTest(pm);
        PoolSwapTest router = new PoolSwapTest(pm);
        PoolKey memory key = d.hook.poolKey();

        // 1 SPY ~ (SPY/USD) / (WIF/USD) WIF. currency0 is SPY (lower address).
        assertEq(Currency.unwrap(key.currency0), Config.SPY);
        UnderfootLens lens = d.lens;
        uint256 wifUsd = lens.wifPriceUsd();
        assertGt(wifUsd, 0);
        uint256 wifPerSpy = _price(Config.SPY_USD) * 1e10 * 1e18 / wifUsd;
        uint160 sqrtP = uint160(_sqrt(wifPerSpy * (1 << 96) / 1e18 * (1 << 96)));
        pm.initialize(key, sqrtP);

        _buySpy(address(this), 0.2 ether);
        uint256 spyBal = IERC20(Config.SPY).balanceOf(address(this));
        deal(Config.WIF, address(this), 50_000_000e18);
        IERC20(Config.SPY).approve(address(lp), type(uint256).max);
        wif.approve(address(lp), type(uint256).max);
        IERC20(Config.SPY).approve(address(router), type(uint256).max);
        wif.approve(address(router), type(uint256).max);

        int24 tick = TickMath.getTickAtSqrtPrice(sqrtP);
        int24 lower = (tick / 60 - 600) * 60;
        int24 upper = (tick / 60 + 600) * 60;
        lp.modifyLiquidity(
            key,
            IPoolManager.ModifyLiquidityParams({tickLower: lower, tickUpper: upper, liquidityDelta: 1e20, salt: 0}),
            ""
        );
        assertLt(IERC20(Config.SPY).balanceOf(address(this)), spyBal);

        // sell WIF for SPY: the fee arrives in the floor as SPY
        uint256 floorSpy = IERC20(Config.SPY).balanceOf(address(d.floor));
        router.swap(
            key,
            IPoolManager.SwapParams({
                zeroForOne: false,
                amountSpecified: -100_000e18,
                sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        assertGt(IERC20(Config.SPY).balanceOf(address(d.floor)), floorSpy);

        // buy WIF with SPY: the fee is burned out of real $WIF supply
        uint256 supply = wif.totalSupply();
        router.swap(
            key,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -1e15, sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1}),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ""
        );
        assertLt(wif.totalSupply(), supply);
    }

    // -------------------------------------------------------------- lens

    function test_fork_lensSnapshot() public {
        d.intake.fund{value: 0.05 ether}();
        d.intake.convert(true, 0.05 ether);
        UnderfootLens.Snapshot memory s = d.lens.snapshot();
        assertEq(s.assets.length, 10);
        assertEq(s.assets[1].symbol, IERC20Metadata(Config.SPY).symbol());
        assertGt(s.navUsd, 0);
        assertGt(s.backingPerWifUsd, 0);
        assertEq(s.circulating, s.totalSupply - s.dead);
        // WIF trades around a tenth of a cent
        assertGt(s.wifPriceUsd, 1e14);
        assertLt(s.wifPriceUsd, 1e17);
        uint256 navUsd = 0.05 ether * _price(Config.ETH_USD) / 1e8;
        assertApproxEqRel(s.navUsd, navUsd, 0.03e18);
    }

    // ----------------------------------------------------------- helpers

    function _price(address feed) internal view returns (uint256 p) {
        (, int256 a,,,) = IAggregatorV3(feed).latestRoundData();
        p = uint256(a);
    }

    function _mockFeed(address feed, int256 answer) internal {
        (uint80 r,,,,) = IAggregatorV3(feed).latestRoundData();
        vm.mockCall(
            feed,
            abi.encodeCall(IAggregatorV3.latestRoundData, ()),
            abi.encode(r, answer, block.timestamp, block.timestamp, r)
        );
    }

    /// @dev Re-stamp every feed's real answer with the current time.
    function _freshFeeds() internal {
        vm.clearMockedCalls();
        (, address[] memory feeds) = Config.basket();
        for (uint256 i; i < feeds.length; ++i) {
            _mockFeed(feeds[i], int256(_price(feeds[i])));
        }
        _mockFeed(Config.ETH_USD, int256(_price(Config.ETH_USD)));
        _mockFeed(Config.USDG_USD, int256(_price(Config.USDG_USD)));
    }

    function _buyUsdg(address to, uint256 eth) internal {
        IWETH(Config.WETH).deposit{value: eth}();
        IWETH(Config.WETH).approve(Config.SWAP_ROUTER_02, eth);
        ISwapRouter02(Config.SWAP_ROUTER_02).exactInput(
            ISwapRouter02.ExactInputParams({
                path: abi.encodePacked(Config.WETH, uint24(500), Config.USDG),
                recipient: to,
                amountIn: eth,
                amountOutMinimum: 0
            })
        );
    }

    function _buySpy(address to, uint256 eth) internal {
        IWETH(Config.WETH).deposit{value: eth}();
        IWETH(Config.WETH).approve(Config.SWAP_ROUTER_02, eth);
        ISwapRouter02(Config.SWAP_ROUTER_02).exactInput(
            ISwapRouter02.ExactInputParams({
                path: abi.encodePacked(Config.WETH, uint24(500), Config.SPY),
                recipient: to,
                amountIn: eth,
                amountOutMinimum: 0
            })
        );
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    receive() external payable {}
}

interface IERC20Metadata {
    function symbol() external view returns (string memory);
}
