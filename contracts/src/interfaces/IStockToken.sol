// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Robinhood Chain Stock Token surface we read. Raw balances never rebase;
///         corporate actions move `uiMultiplier` (ERC-8056).
interface IStockToken is IERC20 {
    function paused() external view returns (bool);
    function oraclePaused() external view returns (bool);
    function uiMultiplier() external view returns (uint256);
}
