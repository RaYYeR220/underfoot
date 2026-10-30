// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {BaseAccount} from "account-abstraction/core/BaseAccount.sol";

import {Ballot} from "../../src/Ballot.sol";
import {Underfoot} from "../../src/Underfoot.sol";
import {UnderfootPaymaster} from "../../src/UnderfootPaymaster.sol";
import {Config} from "../../script/Config.sol";
import {Deployment, UnderfootDeployer} from "../../script/Deploy.s.sol";

/// @notice Gasless floor actions end to end on real Robinhood Chain contracts: an EOA delegated
///         to the canonical Simple7702Account (EIP-7702), the canonical EntryPoint v0.8, and our
///         paymaster. The user holds WIF and zero ETH.
contract PaymasterForkTest is Test, UnderfootDeployer {
    IEntryPoint ep = IEntryPoint(Config.ENTRY_POINT_V08);
    IERC20 wif = IERC20(Config.WIF);
    Deployment d;

    uint256 sponsorPk = 0x5905;
    uint256 alicePk = 0xA11CE;
    address alice;
    address bundler = makeAddr("bundler");

    function setUp() public {
        vm.createSelectFork(vm.envOr("ROBINHOOD_RPC_URL", string("https://rpc.mainnet.chain.robinhood.com")));
        d = _deployAll(vm.addr(sponsorPk), address(this));
        alice = vm.addr(alicePk);
        vm.signAndAttachDelegation(Config.SIMPLE_7702_ACCOUNT, alicePk);
        deal(Config.WIF, alice, 100_000e18);
        d.paymaster.deposit{value: 0.01 ether}();
        assertEq(alice.balance, 0);
    }

    function test_fork_delegationIsRecognised() public view {
        assertTrue(d.paymaster.isDelegated(alice));
        assertFalse(d.paymaster.isDelegated(bundler));
        assertFalse(d.paymaster.isDelegated(address(d.floor)));
    }

    function test_fork_sponsoredVoteWithZeroEth() public {
        uint256 supply = wif.totalSupply();
        uint256 tank = d.paymaster.balance();

        BaseAccount.Call[] memory calls = new BaseAccount.Call[](2);
        calls[0] = _call(Config.WIF, abi.encodeCall(IERC20.approve, (address(d.ballot), 500e18)));
        calls[1] = _call(address(d.ballot), abi.encodeCall(Ballot.vote, (3, 500e18)));
        _handle(_signedOp(abi.encodeCall(BaseAccount.executeBatch, (calls)), sponsorPk));

        assertEq(wif.totalSupply(), supply - 500e18);
        assertEq(d.ballot.tally(d.ballot.currentEpoch(), 3), 500e18);
        assertEq(alice.balance, 0, "alice paid nothing");
        assertLt(d.paymaster.balance(), tank, "the tank paid");
    }

    function test_fork_sponsoredRedeemWithZeroEth() public {
        // put something in the floor first
        d.intake.fund{value: 0.02 ether}();
        _freshFeeds();
        d.intake.convert(true, 0.02 ether);

        BaseAccount.Call[] memory calls = new BaseAccount.Call[](2);
        calls[0] = _call(Config.WIF, abi.encodeCall(IERC20.approve, (address(d.floor), 50_000e18)));
        calls[1] = _call(address(d.floor), abi.encodeCall(Underfoot.redeem, (50_000e18, alice, 0)));
        _handle(_signedOp(abi.encodeCall(BaseAccount.executeBatch, (calls)), sponsorPk));

        assertEq(wif.balanceOf(alice), 50_000e18);
        assertGt(IERC20(Config.SGOV).balanceOf(alice), 0);
        assertGt(IERC20(Config.SPY).balanceOf(alice), 0);
        assertEq(alice.balance, 0);
    }

    // ------------------------------------------------------ refusals

    /// @notice Even with a valid sponsor signature, anything but a floor action is refused.
    function test_fork_signedTransferIsStillRefused() public {
        BaseAccount.Call[] memory calls = new BaseAccount.Call[](2);
        calls[0] = _call(address(d.ballot), abi.encodeCall(Ballot.vote, (3, 500e18)));
        calls[1] = _call(Config.WIF, abi.encodeCall(IERC20.transfer, (bundler, 10_000e18)));
        PackedUserOperation memory op = _signedOp(abi.encodeCall(BaseAccount.executeBatch, (calls)), sponsorPk);
        vm.expectRevert();
        _handle(op);
        assertEq(wif.balanceOf(alice), 100_000e18);
    }

    function test_fork_approveToOtherSpenderIsRefused() public {
        BaseAccount.Call[] memory calls = new BaseAccount.Call[](2);
        calls[0] = _call(Config.WIF, abi.encodeCall(IERC20.approve, (bundler, type(uint256).max)));
        calls[1] = _call(address(d.ballot), abi.encodeCall(Ballot.vote, (3, 500e18)));
        PackedUserOperation memory op = _signedOp(abi.encodeCall(BaseAccount.executeBatch, (calls)), sponsorPk);
        vm.expectRevert();
        _handle(op);
    }

    function test_fork_tooSmallBurnIsRefused() public {
        BaseAccount.Call[] memory calls = new BaseAccount.Call[](2);
        calls[0] = _call(Config.WIF, abi.encodeCall(IERC20.approve, (address(d.ballot), 10e18)));
        calls[1] = _call(address(d.ballot), abi.encodeCall(Ballot.vote, (3, 10e18)));
        PackedUserOperation memory op = _signedOp(abi.encodeCall(BaseAccount.executeBatch, (calls)), sponsorPk);
        vm.expectRevert();
        _handle(op);
    }

    function test_fork_wrongSponsorIsRefused() public {
        BaseAccount.Call[] memory calls = new BaseAccount.Call[](2);
        calls[0] = _call(Config.WIF, abi.encodeCall(IERC20.approve, (address(d.ballot), 500e18)));
        calls[1] = _call(address(d.ballot), abi.encodeCall(Ballot.vote, (3, 500e18)));
        PackedUserOperation memory op = _signedOp(abi.encodeCall(BaseAccount.executeBatch, (calls)), 0xBAD);
        vm.expectRevert();
        _handle(op);
    }

    function test_fork_valueCarryingCallIsRefused() public view {
        BaseAccount.Call[] memory calls = new BaseAccount.Call[](1);
        calls[0] = BaseAccount.Call({
            target: address(d.ballot),
            value: 1,
            data: abi.encodeCall(Ballot.vote, (3, 500e18))
        });
        bytes memory cd = abi.encodeCall(BaseAccount.executeBatch, (calls));
        try d.paymaster.burnedBy(cd) returns (uint256) {
            revert("should have refused");
        } catch (bytes memory err) {
            assertEq(bytes4(err), UnderfootPaymaster.CarriesValue.selector);
        }
    }

    function test_fork_burnedByCountsVotesAndRedeems() public view {
        BaseAccount.Call[] memory calls = new BaseAccount.Call[](4);
        calls[0] = _call(Config.WIF, abi.encodeCall(IERC20.approve, (address(d.ballot), 1)));
        calls[1] = _call(address(d.ballot), abi.encodeCall(Ballot.vote, (2, 300e18)));
        calls[2] = _call(Config.WIF, abi.encodeCall(IERC20.approve, (address(d.floor), 1)));
        calls[3] = _call(address(d.floor), abi.encodeCall(Underfoot.redeem, (700e18, alice, 0)));
        assertEq(d.paymaster.burnedBy(abi.encodeCall(BaseAccount.executeBatch, (calls))), 1_000e18);
        assertEq(
            d.paymaster.burnedBy(
                abi.encodeCall(BaseAccount.execute, (address(d.ballot), 0, abi.encodeCall(Ballot.vote, (2, 5e18))))
            ),
            5e18
        );
    }

    /// @notice Calls that could never burn anything are refused at validation, not after.
    function test_fork_impossibleBurnsAreRefused() public view {
        bytes[4] memory bad = [
            abi.encodeCall(Ballot.vote, (0, 500e18)), // cash leg is not an option
            abi.encodeCall(Ballot.vote, (10, 500e18)), // out of range
            abi.encodeCall(Underfoot.redeem, (0, alice, 0)), // nothing to burn
            abi.encodeCall(Underfoot.redeem, (500e18, address(0), 0)) // nowhere to send
        ];
        address[4] memory targets = [address(d.ballot), address(d.ballot), address(d.floor), address(d.floor)];
        for (uint256 i; i < 4; ++i) {
            bytes memory cd = abi.encodeCall(BaseAccount.execute, (targets[i], 0, bad[i]));
            try d.paymaster.burnedBy(cd) returns (uint256) {
                revert("should have refused");
            } catch (bytes memory err) {
                assertEq(bytes4(err), UnderfootPaymaster.NotSponsored.selector);
            }
        }
    }

    function test_fork_anyoneCanAddPermanentStake() public {
        d.paymaster.addStake{value: 0.01 ether}(1 days);
        IEntryPoint.DepositInfo memory info = ep.getDepositInfo(address(d.paymaster));
        assertTrue(info.staked);
        assertEq(info.stake, 0.01 ether);
    }

    // ------------------------------------------------------- helpers

    function _call(address target, bytes memory data) internal pure returns (BaseAccount.Call memory) {
        return BaseAccount.Call({target: target, value: 0, data: data});
    }

    function _signedOp(bytes memory callData, uint256 signerPk) internal view returns (PackedUserOperation memory op) {
        uint48 validUntil = uint48(block.timestamp + 10 minutes);
        uint48 validAfter = 0;
        op = PackedUserOperation({
            sender: alice,
            nonce: ep.getNonce(alice, 0),
            initCode: "",
            callData: callData,
            accountGasLimits: bytes32((uint256(300_000) << 128) | 500_000),
            preVerificationGas: 100_000,
            gasFees: bytes32((uint256(0.01 gwei) << 128) | 0.1 gwei),
            paymasterAndData: "",
            signature: ""
        });
        bytes memory prefix =
            abi.encodePacked(address(d.paymaster), uint128(200_000), uint128(0), abi.encode(validUntil, validAfter));
        op.paymasterAndData = abi.encodePacked(prefix, new bytes(65));
        bytes32 h = MessageHashUtils.toEthSignedMessageHash(d.paymaster.getHash(op, validUntil, validAfter));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, h);
        op.paymasterAndData = abi.encodePacked(prefix, r, s, v);

        (v, r, s) = vm.sign(alicePk, ep.getUserOpHash(op));
        op.signature = abi.encodePacked(r, s, v);
    }

    function _handle(PackedUserOperation memory op) internal {
        PackedUserOperation[] memory ops = new PackedUserOperation[](1);
        ops[0] = op;
        vm.prank(bundler, bundler);
        ep.handleOps(ops, payable(bundler));
    }

    function _freshFeeds() internal {
        (, address[] memory feeds) = Config.basket();
        for (uint256 i; i < feeds.length; ++i) {
            _restamp(feeds[i]);
        }
        _restamp(Config.ETH_USD);
        _restamp(Config.USDG_USD);
    }

    function _restamp(address feed) internal {
        (uint80 r, int256 a,,,) = IAggregatorLike(feed).latestRoundData();
        vm.mockCall(
            feed,
            abi.encodeCall(IAggregatorLike.latestRoundData, ()),
            abi.encode(r, a, block.timestamp, block.timestamp, r)
        );
    }

    receive() external payable {}
}

interface IAggregatorLike {
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80);
}
