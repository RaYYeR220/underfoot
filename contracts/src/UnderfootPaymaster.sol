// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import {IPaymaster} from "account-abstraction/interfaces/IPaymaster.sol";
import {PackedUserOperation} from "account-abstraction/interfaces/PackedUserOperation.sol";
import {BaseAccount} from "account-abstraction/core/BaseAccount.sol";
import {_packValidationData} from "account-abstraction/core/Helpers.sol";
import {UserOperationLib} from "account-abstraction/core/UserOperationLib.sol";

import {Ballot} from "./Ballot.sol";
import {Underfoot} from "./Underfoot.sol";

/// @title UnderfootPaymaster
/// @notice Pays gas for floor actions, and nothing else.
///
/// A user operation is sponsored only if BOTH gates pass:
///   1. a sponsor signature over the exact operation (the app's server rate-limits and simulates
///      before it signs), and
///   2. on-chain rules that limit WHAT can ever be sponsored, even if the server signs something
///      it shouldn't:
///        - the sender is an EIP-7702 account delegated to the canonical Simple7702Account;
///        - every call is one of: WIF.approve(floor|ballot, _), floor.redeem(_), ballot.vote(_);
///        - no call carries ETH;
///        - together the calls burn at least MIN_BURN WIF;
///        - the operation's max cost is under MAX_COST.
///
/// The rules bound what gets sponsored; they cannot promise the operation succeeds (a holder can
/// still move their WIF away between signing and inclusion). The cost of that is one operation's
/// gas, capped by MAX_COST and by the server's per-account limits.
///
/// There is no owner and no withdraw. ETH deposited here can only ever pay for floor actions, and
/// anyone can add a permanent stake so bundlers give the paymaster staked-entity limits.
contract UnderfootPaymaster is IPaymaster {
    uint256 private constant VALIDATION_GAS_OFFSET = UserOperationLib.PAYMASTER_VALIDATION_GAS_OFFSET;
    uint256 private constant DATA_OFFSET = UserOperationLib.PAYMASTER_DATA_OFFSET;
    uint256 private constant SIG_OFFSET = DATA_OFFSET + 64;

    IEntryPoint public immutable ENTRY_POINT;
    address public immutable ACCOUNT_IMPL;
    address public immutable SPONSOR;
    address public immutable WIF;
    address public immutable FLOOR;
    address public immutable BALLOT;
    uint256 public immutable MIN_BURN;
    uint256 public immutable MAX_COST;
    uint256 public immutable OPTIONS;
    uint256 public immutable MIN_VOTE;

    event Deposited(address indexed from, uint256 amount);

    error NotEntryPoint();
    error TooExpensive(uint256 maxCost);
    error NotDelegated(address sender);
    error NotSponsored(address target, bytes4 selector);
    error CarriesValue();
    error BurnTooSmall(uint256 burned);
    error BadPaymasterData();
    error ZeroAddress();

    constructor(
        IEntryPoint entryPoint,
        address accountImpl,
        address sponsor,
        Underfoot floor,
        Ballot ballot,
        uint256 minBurn,
        uint256 maxCost
    ) {
        if (
            address(entryPoint) == address(0) || accountImpl == address(0) || sponsor == address(0)
                || address(floor) == address(0) || address(ballot) == address(0)
        ) revert ZeroAddress();
        ENTRY_POINT = entryPoint;
        ACCOUNT_IMPL = accountImpl;
        SPONSOR = sponsor;
        WIF = address(floor.WIF());
        FLOOR = address(floor);
        BALLOT = address(ballot);
        MIN_BURN = minBurn;
        MAX_COST = maxCost;
        OPTIONS = ballot.OPTIONS();
        MIN_VOTE = ballot.MIN_VOTE();
    }

    // ------------------------------------------------------------- funding

    /// @notice Top up the gas tank. Anyone can; nobody can take it back out.
    function deposit() public payable {
        ENTRY_POINT.depositTo{value: msg.value}(address(this));
        emit Deposited(msg.sender, msg.value);
    }

    receive() external payable {
        deposit();
    }

    /// @notice Add to the paymaster's EntryPoint stake. There is no way to unlock it: the stake is
    ///         permanent, which is the point — it only buys bundler reputation.
    function addStake(uint32 unstakeDelaySec) external payable {
        ENTRY_POINT.addStake{value: msg.value}(unstakeDelaySec);
    }

    function balance() external view returns (uint256) {
        return ENTRY_POINT.balanceOf(address(this));
    }

    // ---------------------------------------------------------- validation

    function validatePaymasterUserOp(PackedUserOperation calldata op, bytes32, uint256 maxCost)
        external
        view
        returns (bytes memory context, uint256 validationData)
    {
        if (msg.sender != address(ENTRY_POINT)) revert NotEntryPoint();
        if (maxCost > MAX_COST) revert TooExpensive(maxCost);
        if (!isDelegated(op.sender)) revert NotDelegated(op.sender);

        uint256 burned = burnedBy(op.callData);
        if (burned < MIN_BURN) revert BurnTooSmall(burned);

        (uint48 validUntil, uint48 validAfter, bytes calldata signature) = _parse(op.paymasterAndData);
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(getHash(op, validUntil, validAfter));
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
        bool sigFailed = err != ECDSA.RecoverError.NoError || signer != SPONSOR;

        return ("", _packValidationData(sigFailed, validUntil, validAfter));
    }

    /// @dev Never called: validation returns an empty context.
    function postOp(PostOpMode, bytes calldata, uint256, uint256) external view {
        if (msg.sender != address(ENTRY_POINT)) revert NotEntryPoint();
    }

    // ---------------------------------------------------------------- rules

    /// @notice True if `account` is an EIP-7702 EOA delegated to the canonical Simple7702Account.
    function isDelegated(address account) public view returns (bool) {
        bytes memory code = account.code;
        return code.length == 23 && keccak256(code) == keccak256(abi.encodePacked(hex"ef0100", ACCOUNT_IMPL));
    }

    /// @notice WIF the account's calldata burns, or a revert if any call is outside the rules.
    function burnedBy(bytes calldata callData) public view returns (uint256 burned) {
        if (callData.length < 4) revert NotSponsored(address(0), bytes4(0));
        bytes4 sel = bytes4(callData[:4]);
        if (sel == BaseAccount.execute.selector) {
            (address target, uint256 value, bytes memory data) = abi.decode(callData[4:], (address, uint256, bytes));
            return _burnedByCall(target, value, data);
        }
        if (sel == BaseAccount.executeBatch.selector) {
            BaseAccount.Call[] memory calls = abi.decode(callData[4:], (BaseAccount.Call[]));
            for (uint256 i; i < calls.length; ++i) {
                burned += _burnedByCall(calls[i].target, calls[i].value, calls[i].data);
            }
            return burned;
        }
        revert NotSponsored(address(0), sel);
    }

    /// @notice The hash the sponsor signs.
    function getHash(PackedUserOperation calldata op, uint48 validUntil, uint48 validAfter)
        public
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                op.sender,
                op.nonce,
                keccak256(op.initCode),
                keccak256(op.callData),
                op.accountGasLimits,
                uint256(bytes32(op.paymasterAndData[VALIDATION_GAS_OFFSET:DATA_OFFSET])),
                op.preVerificationGas,
                op.gasFees,
                block.chainid,
                address(this),
                validUntil,
                validAfter
            )
        );
    }

    // ------------------------------------------------------------ internal

    function _burnedByCall(address target, uint256 value, bytes memory data) private view returns (uint256) {
        if (value != 0) revert CarriesValue();
        if (data.length < 4) revert NotSponsored(target, bytes4(0));
        bytes4 sel = bytes4(data);
        bytes memory args = _args(data);

        if (target == WIF && sel == IERC20.approve.selector) {
            (address spender,) = abi.decode(args, (address, uint256));
            if (spender != FLOOR && spender != BALLOT) revert NotSponsored(target, sel);
            return 0;
        }
        if (target == FLOOR && sel == Underfoot.redeem.selector) {
            (uint256 amount, address to,) = abi.decode(args, (uint256, address, uint256));
            if (amount == 0 || to == address(0)) revert NotSponsored(target, sel);
            return amount;
        }
        if (target == BALLOT && sel == Ballot.vote.selector) {
            (uint256 option, uint256 amount) = abi.decode(args, (uint256, uint256));
            if (option == 0 || option >= OPTIONS || amount < MIN_VOTE) revert NotSponsored(target, sel);
            return amount;
        }
        revert NotSponsored(target, sel);
    }

    function _args(bytes memory data) private pure returns (bytes memory args) {
        uint256 len = data.length - 4;
        args = new bytes(len);
        for (uint256 i; i < len; ++i) {
            args[i] = data[i + 4];
        }
    }

    function _parse(bytes calldata pnd)
        private
        pure
        returns (uint48 validUntil, uint48 validAfter, bytes calldata signature)
    {
        if (pnd.length < SIG_OFFSET + 64) revert BadPaymasterData();
        (validUntil, validAfter) = abi.decode(pnd[DATA_OFFSET:SIG_OFFSET], (uint48, uint48));
        signature = pnd[SIG_OFFSET:];
    }
}
