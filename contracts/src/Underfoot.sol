// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IBurnableToken} from "./interfaces/IBurnableToken.sol";

/// @title Underfoot
/// @notice A floor of Stock Tokens under every $WIF.
///
/// The contract holds a fixed basket of Stock Tokens. Anyone can burn WIF and take the matching
/// pro-rata slice of every asset in the basket, in kind:
///
///     out_i = balance_i * burned / circulating * (1 - EXIT_FEE)
///
/// where `circulating` is WIF's total supply minus what sits at the dead address or here. The exit fee stays behind, so
/// the backing per circulating WIF of every asset can only go up — through redemptions, through
/// inflows, and through every WIF burned anywhere else on the chain.
///
/// There is no owner, no admin, no oracle and no upgrade path. The basket is fixed at deploy.
contract Underfoot is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    /// @notice WIF sent here is out of circulation even though it still counts in totalSupply.
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant BPS = 10_000;
    /// @notice Share of every redemption that stays in the floor for the holders who remain.
    uint256 public constant EXIT_FEE_BPS = 100;
    uint256 public constant MAX_ASSETS = 16;

    IBurnableToken public immutable WIF;

    address[] private _assets;
    address[] private _feeds;

    event Redeemed(
        address indexed holder,
        address indexed to,
        uint256 wifBurned,
        uint256 circulatingBefore,
        uint256 skipMask,
        uint256[] amounts
    );

    error ZeroAmount();
    error ZeroAddress();
    error ExceedsCirculating();
    error BadBasket();

    /// @param wif The $WIF token.
    /// @param assets_ Basket Stock Tokens. Index 0 is the cash leg; the rest are votable.
    /// @param feeds_ Chainlink USD feed for each asset, used by the Intake and by read-only views.
    constructor(IBurnableToken wif, address[] memory assets_, address[] memory feeds_) {
        uint256 n = assets_.length;
        if (address(wif) == address(0)) revert ZeroAddress();
        if (n < 2 || n > MAX_ASSETS || feeds_.length != n) revert BadBasket();
        for (uint256 i; i < n; ++i) {
            if (assets_[i] == address(0) || feeds_[i] == address(0) || assets_[i] == address(wif)) {
                revert BadBasket();
            }
            for (uint256 j; j < i; ++j) {
                if (assets_[j] == assets_[i]) revert BadBasket();
            }
        }
        WIF = wif;
        _assets = assets_;
        _feeds = feeds_;
    }

    // ---------------------------------------------------------------- redeem

    /// @notice Burn `wifAmount` of your WIF and receive your slice of the basket.
    /// @dev Needs a WIF allowance for this contract (WIF has no permit; batch approve + redeem).
    /// @param wifAmount WIF to burn.
    /// @param to Recipient of the basket slice.
    /// @param skipMask Bit i set = do not pay out asset i (e.g. a paused or blocklisted Stock Token).
    ///                 A skipped share is not lost to the system: it stays in the floor and raises
    ///                 everyone else's backing.
    function redeem(uint256 wifAmount, address to, uint256 skipMask)
        external
        nonReentrant
        returns (uint256[] memory amounts)
    {
        if (wifAmount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();

        uint256 supply = circulatingSupply();
        if (wifAmount >= supply) revert ExceedsCirculating();

        amounts = _slice(wifAmount, supply, skipMask);

        WIF.burnFrom(msg.sender, wifAmount);

        uint256 n = amounts.length;
        for (uint256 i; i < n; ++i) {
            if (amounts[i] != 0) IERC20(_assets[i]).safeTransfer(to, amounts[i]);
        }

        emit Redeemed(msg.sender, to, wifAmount, supply, skipMask, amounts);
    }

    // ----------------------------------------------------------------- views

    /// @notice WIF that is still out there: total supply minus what sits at the dead address or
    ///         in this contract (WIF sent here by mistake can never move again).
    function circulatingSupply() public view returns (uint256) {
        return WIF.totalSupply() - WIF.balanceOf(DEAD) - WIF.balanceOf(address(this));
    }

    /// @notice What `redeem(wifAmount, _, 0)` would pay right now.
    function quoteRedeem(uint256 wifAmount) external view returns (uint256[] memory amounts) {
        uint256 supply = circulatingSupply();
        if (wifAmount == 0 || wifAmount >= supply) return new uint256[](_assets.length);
        return _slice(wifAmount, supply, 0);
    }

    /// @notice Raw units of asset `i` backing one whole WIF (1e18), scaled by 1e18.
    function backingPerWif(uint256 i) external view returns (uint256) {
        return Math.mulDiv(IERC20(_assets[i]).balanceOf(address(this)), 1e36, circulatingSupply() * 1e18);
    }

    function assetCount() external view returns (uint256) {
        return _assets.length;
    }

    function asset(uint256 i) external view returns (address) {
        return _assets[i];
    }

    function feed(uint256 i) external view returns (address) {
        return _feeds[i];
    }

    function assets() external view returns (address[] memory) {
        return _assets;
    }

    function feeds() external view returns (address[] memory) {
        return _feeds;
    }

    /// @notice Index of `token` in the basket, or type(uint256).max if it isn't in it.
    function indexOf(address token) external view returns (uint256) {
        uint256 n = _assets.length;
        for (uint256 i; i < n; ++i) {
            if (_assets[i] == token) return i;
        }
        return type(uint256).max;
    }

    // -------------------------------------------------------------- internal

    function _slice(uint256 wifAmount, uint256 supply, uint256 skipMask)
        private
        view
        returns (uint256[] memory amounts)
    {
        uint256 n = _assets.length;
        amounts = new uint256[](n);
        uint256 num = wifAmount * (BPS - EXIT_FEE_BPS);
        uint256 den = supply * BPS;
        for (uint256 i; i < n; ++i) {
            if (skipMask & (1 << i) != 0) continue;
            uint256 bal = IERC20(_assets[i]).balanceOf(address(this));
            // rounds down: dust always stays with the floor
            if (bal != 0) amounts[i] = Math.mulDiv(bal, num, den);
        }
    }
}
