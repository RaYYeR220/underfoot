// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deployers} from "@uniswap/v4-core/test/utils/Deployers.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {PoolSwapTest} from "v4-core/test/PoolSwapTest.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {IBurnableToken} from "../src/interfaces/IBurnableToken.sol";
import {Underfoot} from "../src/Underfoot.sol";
import {UnderfootHook} from "../src/UnderfootHook.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockStock} from "./mocks/MockStock.sol";
import {MockWIF} from "./mocks/MockWIF.sol";

contract UnderfootHookTest is Test, Deployers {
    MockWIF wif;
    MockStock spy;
    Underfoot floor;
    UnderfootHook hook;
    PoolKey poolKey;

    function setUp() public {
        deployFreshManagerAndRouters();

        wif = new MockWIF(address(this), 1_000_000_000e18);
        spy = new MockStock("SPY");
        spy.mint(address(this), 1_000_000e18);
        MockStock sgov = new MockStock("SGOV");

        address[] memory assets = new address[](2);
        assets[0] = address(sgov);
        assets[1] = address(spy);
        address[] memory feeds = new address[](2);
        feeds[0] = address(new MockFeed(100e8));
        feeds[1] = address(new MockFeed(750e8));
        floor = new Underfoot(IBurnableToken(address(wif)), assets, feeds);

        address flags = address(
            uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG)
                ^ (0x4444 << 144)
        );
        deployCodeTo("UnderfootHook.sol:UnderfootHook", abi.encode(manager, address(floor), wif, address(spy)), flags);
        hook = UnderfootHook(flags);

        wif.approve(address(swapRouter), type(uint256).max);
        spy.approve(address(swapRouter), type(uint256).max);
        wif.approve(address(modifyLiquidityRouter), type(uint256).max);
        spy.approve(address(modifyLiquidityRouter), type(uint256).max);

        poolKey = hook.poolKey();
        manager.initialize(poolKey, SQRT_PRICE_1_1);
        modifyLiquidityRouter.modifyLiquidity(
            poolKey,
            IPoolManager.ModifyLiquidityParams({tickLower: -600, tickUpper: 600, liquidityDelta: 1_000e18, salt: 0}),
            ZERO_BYTES
        );
    }

    function _wifIs0() internal view returns (bool) {
        return Currency.unwrap(poolKey.currency0) == address(wif);
    }

    function _swap(bool sellWif, int256 amountSpecified) internal returns (BalanceDelta) {
        bool zeroForOne = sellWif == _wifIs0();
        return swapRouter.swap(
            poolKey,
            IPoolManager.SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            PoolSwapTest.TestSettings({takeClaims: false, settleUsingBurn: false}),
            ZERO_BYTES
        );
    }

    function test_permissions() public view {
        Hooks.Permissions memory p = hook.getHookPermissions();
        assertTrue(p.beforeInitialize);
        assertTrue(p.afterSwap);
        assertTrue(p.afterSwapReturnDelta);
        assertFalse(p.beforeSwap);
        assertFalse(p.beforeAddLiquidity);
    }

    function test_exactInSellWif_feeGoesToFloorInStock() public {
        uint256 floorBefore = spy.balanceOf(address(floor));
        uint256 userBefore = spy.balanceOf(address(this));

        _swap(true, -1e18);

        uint256 fee = spy.balanceOf(address(floor)) - floorBefore;
        uint256 received = spy.balanceOf(address(this)) - userBefore;
        assertGt(fee, 0);
        // fee is 0.5% of the gross output
        assertApproxEqAbs(fee, (received + fee) * 50 / 10_000, 1);
        assertEq(spy.balanceOf(address(hook)), 0);
    }

    function test_exactInBuyWif_feeIsBurned() public {
        uint256 supplyBefore = wif.totalSupply();
        uint256 floorBefore = spy.balanceOf(address(floor));
        uint256 userBefore = wif.balanceOf(address(this));

        _swap(false, -1e18);

        uint256 burned = supplyBefore - wif.totalSupply();
        uint256 received = wif.balanceOf(address(this)) - userBefore;
        assertGt(burned, 0);
        assertApproxEqAbs(burned, (received + burned) * 50 / 10_000, 1);
        assertEq(spy.balanceOf(address(floor)), floorBefore);
        assertEq(wif.balanceOf(address(hook)), 0);
    }

    function test_exactOutBuyStock_feeOnWifInputIsBurned() public {
        uint256 supplyBefore = wif.totalSupply();
        uint256 userBefore = spy.balanceOf(address(this));

        _swap(true, 1e18);

        assertEq(spy.balanceOf(address(this)) - userBefore, 1e18);
        assertGt(supplyBefore - wif.totalSupply(), 0);
    }

    function test_exactOutBuyWif_feeOnStockInputGoesToFloor() public {
        uint256 floorBefore = spy.balanceOf(address(floor));
        uint256 userBefore = wif.balanceOf(address(this));

        _swap(false, 1e18);

        assertEq(wif.balanceOf(address(this)) - userBefore, 1e18);
        assertGt(spy.balanceOf(address(floor)) - floorBefore, 0);
    }

    function test_swapsRaiseBacking() public {
        spy.mint(address(floor), 1e18);
        uint256 b0 = floor.backingPerWif(1);
        _swap(true, -10e18);
        _swap(false, -10e18);
        assertGt(floor.backingPerWif(1), b0);
    }

    function test_tinySwapTakesNoFee() public {
        uint256 floorBefore = spy.balanceOf(address(floor));
        _swap(true, -100);
        assertEq(spy.balanceOf(address(floor)), floorBefore);
    }

    function test_revertOtherPoolKey() public {
        PoolKey memory k = poolKey;
        k.fee = 500;
        vm.expectRevert();
        manager.initialize(k, SQRT_PRICE_1_1);

        k = poolKey;
        k.tickSpacing = 10;
        vm.expectRevert();
        manager.initialize(k, SQRT_PRICE_1_1);
    }

    function test_revertNotPoolManager() public {
        vm.expectRevert(UnderfootHook.NotPoolManager.selector);
        hook.afterSwap(
            address(this),
            poolKey,
            IPoolManager.SwapParams({zeroForOne: true, amountSpecified: -1, sqrtPriceLimitX96: 0}),
            BalanceDelta.wrap(0),
            ZERO_BYTES
        );
    }

    function testFuzz_feeNeverExceedsHalfPercent(uint256 amount, bool sellWif) public {
        amount = bound(amount, 1e12, 50e18);
        uint256 floorBefore = spy.balanceOf(address(floor));
        uint256 supplyBefore = wif.totalSupply();
        BalanceDelta d = _swap(sellWif, -int256(amount));
        int128 outSide = (sellWif == _wifIs0()) ? d.amount1() : d.amount0();
        uint256 out = uint256(uint128(outSide));
        uint256 fee = sellWif ? spy.balanceOf(address(floor)) - floorBefore : supplyBefore - wif.totalSupply();
        assertLe(fee * 10_000, (out + fee) * 50);
    }
}
