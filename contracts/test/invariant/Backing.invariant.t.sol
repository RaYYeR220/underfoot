// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {IBurnableToken} from "../../src/interfaces/IBurnableToken.sol";
import {Ballot} from "../../src/Ballot.sol";
import {Underfoot} from "../../src/Underfoot.sol";
import {MockFeed} from "../mocks/MockFeed.sol";
import {MockStock} from "../mocks/MockStock.sol";
import {MockWIF} from "../mocks/MockWIF.sol";

/// @dev Drives the floor with every action that touches WIF supply or the basket.
contract FloorHandler is Test {
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    MockWIF public wif;
    Underfoot public floor;
    Ballot public ballot;
    MockStock[] public stocks;
    address[] public holders;

    // ghost state: backing ratio after the previous call, as (balance, circulating) pairs
    uint256[] public lastBal;
    uint256 public lastSupply;
    bool public violated;
    uint256 public calls;
    uint256 public redeems;

    constructor(MockWIF wif_, Underfoot floor_, Ballot ballot_, MockStock[] memory stocks_, address[] memory holders_) {
        wif = wif_;
        floor = floor_;
        ballot = ballot_;
        stocks = stocks_;
        holders = holders_;
        _snap();
    }

    function redeem(uint256 who, uint256 amount, uint256 skipMask) external {
        address h = holders[who % holders.length];
        uint256 bal = wif.balanceOf(h);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        if (amount >= floor.circulatingSupply()) return;
        vm.startPrank(h);
        wif.approve(address(floor), amount);
        floor.redeem(amount, h, skipMask % (1 << stocks.length));
        vm.stopPrank();
        redeems++;
        _check();
    }

    function vote(uint256 who, uint256 option, uint256 amount) external {
        address h = holders[who % holders.length];
        uint256 bal = wif.balanceOf(h);
        if (bal < 1e18) return;
        amount = bound(amount, 1e18, bal);
        option = bound(option, 1, stocks.length - 1);
        vm.startPrank(h);
        wif.approve(address(ballot), amount);
        ballot.vote(option, amount);
        vm.stopPrank();
        _check();
    }

    function burnElsewhere(uint256 who, uint256 amount) external {
        address h = holders[who % holders.length];
        uint256 bal = wif.balanceOf(h);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(h);
        wif.burn(amount);
        _check();
    }

    function sendToDead(uint256 who, uint256 amount) external {
        address h = holders[who % holders.length];
        uint256 bal = wif.balanceOf(h);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(h);
        wif.transfer(DEAD, amount);
        _check();
    }

    function inflow(uint256 i, uint256 amount) external {
        MockStock s = stocks[i % stocks.length];
        amount = bound(amount, 1, 1_000e18);
        s.mint(address(floor), amount);
        _check();
    }

    function transferBetweenHolders(uint256 a, uint256 b, uint256 amount) external {
        address from = holders[a % holders.length];
        address to = holders[b % holders.length];
        uint256 bal = wif.balanceOf(from);
        if (bal == 0) return;
        amount = bound(amount, 1, bal);
        vm.prank(from);
        wif.transfer(to, amount);
        _check();
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 3 days));
        _check();
    }

    function _check() internal {
        calls++;
        uint256 s = floor.circulatingSupply();
        for (uint256 i; i < stocks.length; ++i) {
            uint256 b = stocks[i].balanceOf(address(floor));
            // b / s >= lastBal / lastSupply
            if (b * lastSupply < lastBal[i] * s) violated = true;
        }
        _snap();
    }

    function _snap() internal {
        delete lastBal;
        for (uint256 i; i < stocks.length; ++i) {
            lastBal.push(stocks[i].balanceOf(address(floor)));
        }
        lastSupply = floor.circulatingSupply();
    }
}

contract BackingInvariantTest is Test {
    FloorHandler handler;
    Underfoot floor;
    MockWIF wif;
    uint256 initialSupply;

    function setUp() public {
        wif = new MockWIF(address(this), 1_000_000_000e18);
        MockStock[] memory stocks = new MockStock[](4);
        address[] memory assets = new address[](4);
        address[] memory feeds = new address[](4);
        string[4] memory names = ["SGOV", "SPY", "NVDA", "QQQ"];
        for (uint256 i; i < 4; ++i) {
            stocks[i] = new MockStock(names[i]);
            assets[i] = address(stocks[i]);
            feeds[i] = address(new MockFeed(100e8));
        }
        floor = new Underfoot(IBurnableToken(address(wif)), assets, feeds);
        Ballot ballot = new Ballot(floor, 1);

        address[] memory holders = new address[](4);
        for (uint256 i; i < 4; ++i) {
            holders[i] = address(uint160(0x1000 + i));
            wif.transfer(holders[i], 200_000_000e18);
            stocks[i].mint(address(floor), (i + 1) * 1_000e18);
        }
        wif.transfer(0x000000000000000000000000000000000000dEaD, 100_000_000e18);
        initialSupply = floor.circulatingSupply();

        handler = new FloorHandler(wif, floor, ballot, stocks, holders);
        targetContract(address(handler));
    }

    /// @notice The headline property: backing per circulating WIF never goes down, for any asset.
    function invariant_backingPerWifNeverDecreases() public view {
        assertFalse(handler.violated());
    }

    /// @notice The floor can only lose assets through redeem, and redeem burns WIF first.
    function invariant_circulatingOnlyShrinks() public view {
        assertLe(floor.circulatingSupply(), initialSupply);
    }

    /// @notice The floor never holds WIF.
    function invariant_floorHoldsNoWif() public view {
        assertEq(wif.balanceOf(address(floor)), 0);
    }
}
