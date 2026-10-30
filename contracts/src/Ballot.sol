// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IBurnableToken} from "./interfaces/IBurnableToken.sol";
import {Underfoot} from "./Underfoot.sol";

/// @title Ballot
/// @notice Burn WIF to pick which Stock Token the floor buys next.
///
/// Time is split into 24h epochs starting at 00:00 UTC. A vote burns the voter's WIF — which by
/// itself raises the backing of every WIF left — and adds the burned amount to one option's
/// tally. The option leading at the end of epoch N is what the Intake buys during epoch N+1, so
/// nobody can steer the buy that is already running. No votes means the default (SPY).
///
/// Basket index 0 is the cash leg and has a fixed share of every buy, so it is not an option.
contract Ballot {
    uint256 public constant EPOCH = 1 days;
    uint256 public constant MIN_VOTE = 1e18;

    IBurnableToken public immutable WIF;
    Underfoot public immutable FLOOR;
    uint256 public immutable GENESIS;
    uint256 public immutable OPTIONS;
    uint256 public immutable DEFAULT_OPTION;

    mapping(uint256 epoch => mapping(uint256 option => uint256 burned)) public tally;
    mapping(uint256 epoch => uint256 burned) public epochBurned;
    mapping(uint256 epoch => uint256 option) private _leader;

    event Voted(address indexed voter, uint256 indexed epoch, uint256 indexed option, uint256 amount, uint256 optionTally);

    error BadOption();
    error BelowMinimum();

    constructor(Underfoot floor, uint256 defaultOption) {
        uint256 options = floor.assetCount();
        if (defaultOption == 0 || defaultOption >= options) revert BadOption();
        FLOOR = floor;
        WIF = floor.WIF();
        OPTIONS = options;
        DEFAULT_OPTION = defaultOption;
        GENESIS = block.timestamp - (block.timestamp % EPOCH);
    }

    /// @notice Burn `amount` WIF as a vote for basket asset `option` in the current epoch.
    /// @dev Needs a WIF allowance for this contract.
    function vote(uint256 option, uint256 amount) external {
        if (option == 0 || option >= OPTIONS) revert BadOption();
        if (amount < MIN_VOTE) revert BelowMinimum();

        WIF.burnFrom(msg.sender, amount);

        uint256 e = currentEpoch();
        uint256 t = tally[e][option] + amount;
        tally[e][option] = t;
        epochBurned[e] += amount;

        // strict ">" keeps the earlier leader on a tie, so the result never depends on ordering
        // inside a block once the tallies are equal
        uint256 lead = _leader[e];
        if (lead == 0 || t > tally[e][lead]) _leader[e] = option;

        emit Voted(msg.sender, e, option, amount, t);
    }

    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - GENESIS) / EPOCH;
    }

    /// @notice When epoch `e` ends (UTC seconds).
    function epochEnd(uint256 e) external view returns (uint256) {
        return GENESIS + (e + 1) * EPOCH;
    }

    /// @notice The option that won (or is leading) epoch `e`; the default when nobody voted.
    function winner(uint256 e) public view returns (uint256) {
        uint256 lead = _leader[e];
        return lead == 0 ? DEFAULT_OPTION : lead;
    }

    /// @notice What the Intake buys right now: the winner of the previous epoch.
    function currentTarget() external view returns (uint256) {
        uint256 e = currentEpoch();
        return e == 0 ? DEFAULT_OPTION : winner(e - 1);
    }

    /// @notice All tallies for epoch `e`, indexed by basket asset (index 0 is always zero).
    function tallies(uint256 e) external view returns (uint256[] memory out) {
        out = new uint256[](OPTIONS);
        for (uint256 i = 1; i < OPTIONS; ++i) {
            out[i] = tally[e][i];
        }
    }
}
