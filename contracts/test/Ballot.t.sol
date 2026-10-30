// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";

import {IBurnableToken} from "../src/interfaces/IBurnableToken.sol";
import {Ballot} from "../src/Ballot.sol";
import {Underfoot} from "../src/Underfoot.sol";
import {MockFeed} from "./mocks/MockFeed.sol";
import {MockStock} from "./mocks/MockStock.sol";
import {MockWIF} from "./mocks/MockWIF.sol";

contract BallotTest is Test {
    MockWIF wif;
    Underfoot floor;
    Ballot ballot;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    uint256 constant SPY = 1;
    uint256 constant NVDA = 2;
    uint256 constant QQQ = 3;

    function setUp() public {
        vm.warp(1_793_404_800 + 5 hours); // 2026-10-31 05:00 UTC
        wif = new MockWIF(address(this), 1_000_000_000e18);
        address[] memory assets = new address[](4);
        address[] memory feeds = new address[](4);
        string[4] memory names = ["SGOV", "SPY", "NVDA", "QQQ"];
        for (uint256 i; i < 4; ++i) {
            assets[i] = address(new MockStock(names[i]));
            feeds[i] = address(new MockFeed(100e8));
        }
        floor = new Underfoot(IBurnableToken(address(wif)), assets, feeds);
        ballot = new Ballot(floor, SPY);
        wif.transfer(alice, 1_000_000e18);
        wif.transfer(bob, 1_000_000e18);
    }

    function test_genesisIsMidnightUtc() public view {
        assertEq(ballot.GENESIS() % 1 days, 0);
        assertEq(ballot.currentEpoch(), 0);
        assertEq(ballot.epochEnd(0), ballot.GENESIS() + 1 days);
    }

    function test_defaultTargetWithoutVotes() public {
        assertEq(ballot.currentTarget(), SPY);
        vm.warp(block.timestamp + 3 days);
        assertEq(ballot.currentTarget(), SPY);
    }

    function test_voteBurnsWif() public {
        uint256 ts = wif.totalSupply();
        _vote(alice, NVDA, 500e18);
        assertEq(wif.totalSupply(), ts - 500e18);
        assertEq(wif.balanceOf(address(ballot)), 0);
        assertEq(ballot.tally(0, NVDA), 500e18);
        assertEq(ballot.epochBurned(0), 500e18);
    }

    function test_votesDecideTomorrowNotToday() public {
        _vote(alice, NVDA, 500e18);
        // today's buy is still the default
        assertEq(ballot.currentTarget(), SPY);
        assertEq(ballot.winner(0), NVDA);
        vm.warp(ballot.epochEnd(0));
        assertEq(ballot.currentEpoch(), 1);
        assertEq(ballot.currentTarget(), NVDA);
    }

    function test_leaderFollowsTally() public {
        _vote(alice, NVDA, 500e18);
        _vote(bob, QQQ, 600e18);
        assertEq(ballot.winner(0), QQQ);
        _vote(alice, NVDA, 101e18);
        assertEq(ballot.winner(0), NVDA);
    }

    function test_tieKeepsEarlierLeader() public {
        _vote(alice, NVDA, 500e18);
        _vote(bob, QQQ, 500e18);
        assertEq(ballot.winner(0), NVDA);
    }

    function test_epochsAreIndependent() public {
        _vote(alice, NVDA, 500e18);
        vm.warp(ballot.epochEnd(0));
        _vote(bob, QQQ, 1e18);
        vm.warp(ballot.epochEnd(1));
        assertEq(ballot.currentTarget(), QQQ);
        vm.warp(ballot.epochEnd(2));
        // nobody voted in epoch 2
        assertEq(ballot.currentTarget(), SPY);
    }

    function test_talliesView() public {
        _vote(alice, NVDA, 7e18);
        _vote(bob, QQQ, 9e18);
        uint256[] memory t = ballot.tallies(0);
        assertEq(t.length, 4);
        assertEq(t[0], 0);
        assertEq(t[SPY], 0);
        assertEq(t[NVDA], 7e18);
        assertEq(t[QQQ], 9e18);
    }

    function test_revertCashLegIsNotAnOption() public {
        vm.prank(alice);
        vm.expectRevert(Ballot.BadOption.selector);
        ballot.vote(0, 1e18);
    }

    function test_revertOutOfRange() public {
        vm.prank(alice);
        vm.expectRevert(Ballot.BadOption.selector);
        ballot.vote(4, 1e18);
    }

    function test_revertBelowMinimum() public {
        vm.prank(alice);
        vm.expectRevert(Ballot.BelowMinimum.selector);
        ballot.vote(NVDA, 1e18 - 1);
    }

    function test_revertWithoutAllowance() public {
        vm.prank(alice);
        vm.expectRevert();
        ballot.vote(NVDA, 1e18);
    }

    function test_constructorRejectsCashLegDefault() public {
        vm.expectRevert(Ballot.BadOption.selector);
        new Ballot(floor, 0);
        vm.expectRevert(Ballot.BadOption.selector);
        new Ballot(floor, 4);
    }

    function testFuzz_winnerIsArgmax(uint256[3] memory amounts) public {
        uint256 best;
        uint256 bestOpt = SPY;
        for (uint256 i; i < 3; ++i) {
            amounts[i] = bound(amounts[i], 1e18, 100_000e18);
            _vote(alice, i + 1, amounts[i]);
            if (amounts[i] > best) {
                best = amounts[i];
                bestOpt = i + 1;
            }
        }
        assertEq(ballot.winner(0), bestOpt);
    }

    function _vote(address who, uint256 option, uint256 amount) internal {
        vm.startPrank(who);
        wif.approve(address(ballot), amount);
        ballot.vote(option, amount);
        vm.stopPrank();
    }
}
