// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {IBurnableToken} from "../src/interfaces/IBurnableToken.sol";
import {Underfoot} from "../src/Underfoot.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockStock} from "./mocks/MockStock.sol";
import {MockWIF} from "./mocks/MockWIF.sol";

contract UnderfootTest is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 constant SUPPLY = 1_000_000_000e18;

    MockWIF wif;
    MockStock sgov;
    MockStock spy;
    MockStock nvda;
    Underfoot floor;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        wif = new MockWIF(address(this), SUPPLY);
        sgov = new MockStock("SGOV");
        spy = new MockStock("SPY");
        nvda = new MockStock("NVDA");

        address[] memory assets = new address[](3);
        assets[0] = address(sgov);
        assets[1] = address(spy);
        assets[2] = address(nvda);
        address[] memory feeds = new address[](3);
        for (uint256 i; i < 3; ++i) {
            feeds[i] = address(new MockFeed(100e8));
        }
        floor = new Underfoot(IBurnableToken(address(wif)), assets, feeds);

        // 10% of supply is already dead, like the real token's dead-address balance
        wif.transfer(DEAD, SUPPLY / 10);
        wif.transfer(alice, 100_000_000e18);
        wif.transfer(bob, 50_000_000e18);

        sgov.mint(address(floor), 1_000e18);
        spy.mint(address(floor), 30e18);
        nvda.mint(address(floor), 7e18);
    }

    // ------------------------------------------------------------- basics

    function test_circulatingExcludesDead() public view {
        assertEq(floor.circulatingSupply(), SUPPLY - SUPPLY / 10);
    }

    function test_redeemPaysProRataMinusFee() public {
        uint256 s = floor.circulatingSupply();
        uint256 w = 9_000_000e18; // 1% of circulating
        assertEq(w * 100, s);

        vm.startPrank(alice);
        wif.approve(address(floor), w);
        uint256[] memory out = floor.redeem(w, alice, 0);
        vm.stopPrank();

        // 1% of the basket, minus the 1% exit fee
        assertEq(out[0], 1_000e18 * 99 / 10_000);
        assertEq(out[1], 30e18 * 99 / 10_000);
        assertEq(out[2], 7e18 * 99 / 10_000);
        assertEq(sgov.balanceOf(alice), out[0]);
        assertEq(spy.balanceOf(alice), out[1]);
        assertEq(nvda.balanceOf(alice), out[2]);
    }

    function test_redeemBurnsWif() public {
        uint256 ts = wif.totalSupply();
        _redeem(alice, 1_000e18, 0);
        assertEq(wif.totalSupply(), ts - 1_000e18);
        assertEq(wif.balanceOf(alice), 100_000_000e18 - 1_000e18);
    }

    function test_redeemNeedsAllowance() public {
        vm.prank(alice);
        vm.expectRevert();
        floor.redeem(1e18, alice, 0);
    }

    function test_redeemToOtherRecipient() public {
        uint256[] memory out = _redeem(alice, 1_000_000e18, 0);
        // _redeem sends to alice; now check routing to bob
        vm.startPrank(alice);
        wif.approve(address(floor), 1_000_000e18);
        uint256[] memory out2 = floor.redeem(1_000_000e18, bob, 0);
        vm.stopPrank();
        assertEq(spy.balanceOf(bob), out2[1]);
        assertGt(out[1], 0);
    }

    function test_skipLeavesShareInFloor() public {
        uint256 nvdaBefore = nvda.balanceOf(address(floor));
        uint256[] memory out = _redeem(alice, 9_000_000e18, 1 << 2);
        assertEq(out[2], 0);
        assertEq(nvda.balanceOf(address(floor)), nvdaBefore);
        assertGt(out[0], 0);
        assertGt(out[1], 0);
    }

    function test_skipRoutesAroundPausedToken() public {
        nvda.setPaused(true);
        vm.startPrank(alice);
        wif.approve(address(floor), 2e18);
        vm.expectRevert(bytes("paused"));
        floor.redeem(1e18, alice, 0);
        // the same holder gets everything else by skipping the paused asset
        floor.redeem(1e18, alice, 1 << 2);
        vm.stopPrank();
    }

    function test_quoteMatchesRedeem() public {
        uint256 w = 12_345_678e18;
        uint256[] memory q = floor.quoteRedeem(w);
        uint256[] memory out = _redeem(alice, w, 0);
        for (uint256 i; i < q.length; ++i) {
            assertEq(q[i], out[i]);
        }
    }

    function test_redeemEmits() public {
        uint256 s = floor.circulatingSupply();
        uint256[] memory q = floor.quoteRedeem(1_000e18);
        vm.startPrank(alice);
        wif.approve(address(floor), 1_000e18);
        vm.expectEmit(true, true, false, true, address(floor));
        emit Underfoot.Redeemed(alice, alice, 1_000e18, s, 0, q);
        floor.redeem(1_000e18, alice, 0);
        vm.stopPrank();
    }

    function test_dustRoundsToFloor() public {
        // 1 wei of WIF buys nothing; the burn still happens and the floor keeps everything
        uint256[] memory out = _redeem(alice, 1, 0);
        for (uint256 i; i < out.length; ++i) {
            assertEq(out[i], 0);
        }
    }

    // ------------------------------------------------------------ reverts

    function test_revertZeroAmount() public {
        vm.expectRevert(Underfoot.ZeroAmount.selector);
        floor.redeem(0, alice, 0);
    }

    function test_revertZeroRecipient() public {
        vm.expectRevert(Underfoot.ZeroAddress.selector);
        floor.redeem(1, address(0), 0);
    }

    function test_revertWholeSupply() public {
        uint256 s = floor.circulatingSupply();
        vm.expectRevert(Underfoot.ExceedsCirculating.selector);
        floor.redeem(s, alice, 0);
    }

    function test_constructorRejectsBadBaskets() public {
        address[] memory one = new address[](1);
        one[0] = address(spy);
        vm.expectRevert(Underfoot.BadBasket.selector);
        new Underfoot(IBurnableToken(address(wif)), one, one);

        address[] memory dup = new address[](2);
        dup[0] = address(spy);
        dup[1] = address(spy);
        vm.expectRevert(Underfoot.BadBasket.selector);
        new Underfoot(IBurnableToken(address(wif)), dup, dup);

        address[] memory withWif = new address[](2);
        withWif[0] = address(spy);
        withWif[1] = address(wif);
        vm.expectRevert(Underfoot.BadBasket.selector);
        new Underfoot(IBurnableToken(address(wif)), withWif, withWif);

        address[] memory two = new address[](2);
        two[0] = address(spy);
        two[1] = address(nvda);
        vm.expectRevert(Underfoot.BadBasket.selector);
        new Underfoot(IBurnableToken(address(wif)), two, one);
    }

    // ------------------------------------------------------------ backing

    function test_backingRisesAfterRedeem() public {
        uint256[] memory before = _backing();
        _redeem(alice, 50_000_000e18, 0);
        uint256[] memory afterR = _backing();
        for (uint256 i; i < before.length; ++i) {
            assertGt(afterR[i], before[i]);
        }
    }

    function test_backingRisesWhenAnyoneBurns() public {
        uint256[] memory before = _backing();
        vm.prank(bob);
        wif.burn(10_000_000e18);
        uint256[] memory afterB = _backing();
        for (uint256 i; i < before.length; ++i) {
            assertGt(afterB[i], before[i]);
        }
    }

    function test_backingRisesWhenWifGoesToDead() public {
        uint256[] memory before = _backing();
        vm.prank(bob);
        wif.transfer(DEAD, 10_000_000e18);
        uint256[] memory afterD = _backing();
        for (uint256 i; i < before.length; ++i) {
            assertGt(afterD[i], before[i]);
        }
    }

    function testFuzz_redeemNeverLowersBacking(uint256 w, uint256 skipMask) public {
        w = bound(w, 1, wif.balanceOf(alice));
        skipMask = bound(skipMask, 0, 7);
        uint256 s0 = floor.circulatingSupply();
        uint256[] memory b0 = _balances();

        uint256[] memory out = _redeem(alice, w, skipMask);

        uint256 s1 = floor.circulatingSupply();
        uint256[] memory b1 = _balances();
        assertEq(s1, s0 - w);
        for (uint256 i; i < b0.length; ++i) {
            // b1/s1 >= b0/s0, cross-multiplied
            assertGe(b1[i] * s0, b0[i] * s1);
            // never more than the exact pro-rata share
            assertLe(out[i], b0[i] * w / s0);
        }
    }

    function testFuzz_twoRedeemersAreTreatedTheSame(uint256 w) public {
        w = bound(w, 1e18, 10_000_000e18);
        uint256[] memory a = _redeem(alice, w, 0);
        uint256[] memory b = _redeem(bob, w, 0);
        // the second redeemer gets at least as much: the first one's exit fee stayed behind
        for (uint256 i; i < a.length; ++i) {
            assertGe(b[i], a[i]);
        }
    }

    // ------------------------------------------------------------ helpers

    function _redeem(address who, uint256 w, uint256 skip) internal returns (uint256[] memory out) {
        vm.startPrank(who);
        wif.approve(address(floor), w);
        out = floor.redeem(w, who, skip);
        vm.stopPrank();
    }

    function _balances() internal view returns (uint256[] memory b) {
        b = new uint256[](3);
        b[0] = sgov.balanceOf(address(floor));
        b[1] = spy.balanceOf(address(floor));
        b[2] = nvda.balanceOf(address(floor));
    }

    function _backing() internal view returns (uint256[] memory b) {
        b = new uint256[](3);
        for (uint256 i; i < 3; ++i) {
            b[i] = floor.backingPerWif(i);
        }
    }
}
