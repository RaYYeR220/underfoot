// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @dev Fixed-supply burnable token, the shape of $WIF.
contract MockWIF is ERC20Burnable {
    constructor(address holder, uint256 supply) ERC20("World is Flat", "WIF") {
        _mint(holder, supply);
    }
}
