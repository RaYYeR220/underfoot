// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Uniswap v3 SwapRouter02 exactInput (no deadline field in the 02 router).
interface ISwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}
