// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {IBurnableToken} from "../src/interfaces/IBurnableToken.sol";
import {Underfoot} from "../src/Underfoot.sol";
import {UnderfootHook} from "../src/UnderfootHook.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockStock} from "./mocks/MockStock.sol";
import {MockWIF} from "./mocks/MockWIF.sol";

/// @notice Confirms (no finding) the hook's delta accounting is exact in all four
///         {exactIn, exactOut} x {sell WIF, buy WIF} cases: fee = floor(0.5% * gross
///         unspecified), the swapper pays/receives exactly gross +/- fee, the PoolManager stays
///         whole, and the hook never holds a balance.
contract HookAccountingTest is Test, Deployers {
    MockWIF wif;
    MockStock spy;
    Underfoot floor;
    UnderfootHook hook;
    PoolKey pkey;

    function setUp() public {
        deployFreshManagerAndRouters();
        wif = new MockWIF(address(this), 1_000_000_000e18);
        spy = new MockStock("SPY");
        spy.mint(address(this), 1_000_000e18);
        address[] memory assets = new address[](2);
        assets[0] = address(new MockStock("SGOV"));
        assets[1] = address(spy);
        address[] memory feeds = new address[](2);
        feeds[0] = address(new MockFeed(100e8));
        feeds[1] = address(new MockFeed(750e8));
        floor = new Underfoot(IBurnableToken(address(wif)), assets, feeds);
        address flags = address(
            uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG)
                ^ (0x7777 << 144)
        );
        deployCodeTo("UnderfootHook.sol:UnderfootHook", abi.encode(manager, address(floor), wif, address(spy)), flags);
        hook = UnderfootHook(flags);
        wif.approve(address(swapRouter), type(uint256).max);
        spy.approve(address(swapRouter), type(uint256).max);
        wif.approve(address(modifyLiquidityRouter), type(uint256).max);
        spy.approve(address(modifyLiquidityRouter), type(uint256).max);
        pkey = hook.poolKey();
        manager.initialize(pkey, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity(
            pkey,
            IPoolManager.ModifyLiquidityParams({tickLower: -6000, tickUpper: 6000, liquidityDelta: 10_000e18, salt: 0}),
            ZERO_BYTES
        );
    }

    struct Bals {
        uint256 userWif;
        uint256 userSpy;
        uint256 pmWif;
        uint256 pmSpy;
        uint256 floorSpy;
        uint256 supply;
    }

    function _bals() internal view returns (Bals memory b) {
        b.userWif = wif.balanceOf(address(this));
        b.userSpy = spy.balanceOf(address(this));
        b.pmWif = wif.balanceOf(address(manager));
        b.pmSpy = spy.balanceOf(address(manager));
        b.floorSpy = spy.balanceOf(address(floor));
        b.supply = wif.totalSupply();
    }

    function testFuzz_hookAccountingAllFourDirections(uint256 amount, bool sellWif, bool exactIn) public {
        amount = bound(amount, 1e9, 100e18);
        bool wifIs0 = Currency.unwrap(pkey.currency0) == address(wif);
        bool zeroForOne = sellWif == wifIs0;
        Bals memory a = _bals();
        swapRouter.swap(
            pkey,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: exactIn ? -int256(amount) : int256(amount),
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ZERO_BYTES
        );
        Bals memory b = _bals();

        uint256 burned = a.supply - b.supply;
        uint256 toFloor = b.floorSpy - a.floorSpy;
        assertEq(wif.balanceOf(address(hook)), 0);
        assertEq(spy.balanceOf(address(hook)), 0);

        if (sellWif) {
            uint256 wifIn = a.userWif - b.userWif;
            uint256 spyOut = b.userSpy - a.userSpy;
            if (exactIn) {
                assertEq(wifIn, amount);
                assertEq(burned, 0);
                assertEq(toFloor, (spyOut + toFloor) * 50 / 10_000, "fee on SPY output");
            } else {
                assertEq(spyOut, amount);
                assertEq(toFloor, 0);
                assertEq(burned, (wifIn - burned) * 50 / 10_000, "fee on WIF input");
            }
            // PoolManager conservation
            assertEq(b.pmWif - a.pmWif, wifIn - burned);
            assertEq(a.pmSpy - b.pmSpy, spyOut + toFloor);
        } else {
            uint256 spyIn = a.userSpy - b.userSpy;
            uint256 wifOut = b.userWif - a.userWif;
            if (exactIn) {
                assertEq(spyIn, amount);
                assertEq(toFloor, 0);
                assertEq(burned, (wifOut + burned) * 50 / 10_000, "fee on WIF output");
            } else {
                assertEq(wifOut, amount);
                assertEq(burned, 0);
                assertEq(toFloor, (spyIn - toFloor) * 50 / 10_000, "fee on SPY input");
            }
            assertEq(b.pmSpy - a.pmSpy, spyIn - toFloor);
            assertEq(a.pmWif - b.pmWif, wifOut + burned);
        }
    }

    /// Anyone may initialize the single allowed key first, at any price. Harmless (empty pool,
    /// the first LP re-prices by swapping before adding), but the deploy script does not do it.
    function test_anyoneCanInitializeFirstAtAnyPrice() public {
        // fresh hook at another address, pool not yet initialized
        address flags = address(
            uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG)
                ^ (0x8888 << 144)
        );
        deployCodeTo("UnderfootHook.sol:UnderfootHook", abi.encode(manager, address(floor), wif, address(spy)), flags);
        PoolKey memory k = UnderfootHook(flags).poolKey();
        vm.prank(makeAddr("griefer"));
        manager.initialize(k, TickMath.MIN_SQRT_PRICE + 1);
        vm.expectRevert();
        manager.initialize(k, SQRT_PRICE_1_1);
    }
}
