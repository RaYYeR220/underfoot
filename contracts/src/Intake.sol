// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";

import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IBurnableToken} from "./interfaces/IBurnableToken.sol";
import {IStockToken} from "./interfaces/IStockToken.sol";
import {ISwapRouter02} from "./interfaces/ISwapRouter02.sol";
import {IWETH} from "./interfaces/IWETH.sol";
import {OracleLib} from "./libraries/OracleLib.sol";
import {Ballot} from "./Ballot.sol";
import {Underfoot} from "./Underfoot.sol";

/// @title Intake
/// @notice Where value comes in to the floor.
///
/// Anyone can send ETH, USDG, WIF or a basket Stock Token here — creator fees, a slice of a game's
/// pot, a donation. WIF is burned on the spot. Basket Stock Tokens go straight to the floor.
/// ETH and USDG wait until someone calls `convert`, which buys Stock Tokens into the floor:
/// a fixed 20% into the cash leg and 80% into whatever the Ballot picked yesterday.
///
/// `convert` is permissionless and has no discretion: routes are fixed at deploy, and every swap
/// must return at least the Chainlink-implied amount minus a 2% band. It refuses — and nothing
/// moves — when a feed is stale (markets closed), a Stock Token or its oracle is paused, the
/// pool price has drifted past the band, or the size is outside the per-call limits.
contract Intake is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using OracleLib for IAggregatorV3;

    struct Route {
        bytes fromUsdg;
        bytes fromWeth;
    }

    uint256 public constant BPS = 10_000;
    /// @notice Share of every buy that goes to the cash leg (basket index 0).
    uint256 public constant CASH_BPS = 2_000;
    /// @notice Worst price a buy may take, measured against Chainlink.
    uint256 public constant BAND_BPS = 200;
    /// @notice Feeds older than this are treated as markets-closed. Stock feeds heartbeat at 24h.
    uint256 public constant MAX_AGE = 26 hours;
    /// @notice Smallest convert, in USD with 8 decimals.
    uint256 public constant MIN_USD = 1e8;

    Underfoot public immutable FLOOR;
    Ballot public immutable BALLOT;
    IBurnableToken public immutable WIF;
    IWETH public immutable WETH;
    IERC20 public immutable USDG;
    ISwapRouter02 public immutable ROUTER;
    IAggregatorV3 public immutable ETH_USD;
    IAggregatorV3 public immutable USDG_USD;
    /// @notice Largest convert, in USD with 8 decimals. Bigger balances go through in chunks.
    uint256 public immutable MAX_USD;

    Route[] private _routes;

    event Funded(address indexed from, address indexed token, uint256 amount);
    event Burned(uint256 amount);
    event Forwarded(address indexed token, uint256 amount);
    event Converted(
        uint256 indexed assetIndex,
        address indexed tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        uint256 minOut,
        uint256 stockPrice
    );

    error BadRoute(uint256 index);
    error UnsupportedToken(address token);
    error InsufficientBalance();
    error OutsideLimits(uint256 usdValue);
    error StockPaused(address token);
    error BandBreached(uint256 amountOut, uint256 minOut);
    error ZeroAddress();

    constructor(
        Underfoot floor,
        Ballot ballot,
        IWETH weth,
        IERC20 usdg,
        ISwapRouter02 router,
        IAggregatorV3 ethUsd,
        IAggregatorV3 usdgUsd,
        uint256 maxUsd,
        Route[] memory routes
    ) {
        if (
            address(floor) == address(0) || address(ballot) == address(0) || address(weth) == address(0)
                || address(usdg) == address(0) || address(router) == address(0) || address(ethUsd) == address(0)
                || address(usdgUsd) == address(0)
        ) revert ZeroAddress();
        if (address(ballot.FLOOR()) != address(floor)) revert ZeroAddress();
        if (maxUsd < MIN_USD) revert OutsideLimits(maxUsd);

        uint256 n = floor.assetCount();
        if (routes.length != n) revert BadRoute(routes.length);
        for (uint256 i; i < n; ++i) {
            address a = floor.asset(i);
            if (!_validPath(routes[i].fromUsdg, address(usdg), a)) revert BadRoute(i);
            if (!_validPath(routes[i].fromWeth, address(weth), a)) revert BadRoute(i);
            _routes.push(routes[i]);
        }

        FLOOR = floor;
        BALLOT = ballot;
        WIF = floor.WIF();
        WETH = weth;
        USDG = usdg;
        ROUTER = router;
        ETH_USD = ethUsd;
        USDG_USD = usdgUsd;
        MAX_USD = maxUsd;
    }

    // ------------------------------------------------------------------ in

    receive() external payable {
        emit Funded(msg.sender, address(0), msg.value);
    }

    function fund() external payable {
        emit Funded(msg.sender, address(0), msg.value);
    }

    /// @notice Pull `amount` of `token` in. WIF is burned, basket assets go to the floor,
    ///         USDG and WETH wait for `convert`.
    function fundToken(address token, uint256 amount) external nonReentrant {
        if (!_accepts(token)) revert UnsupportedToken(token);
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, token, amount);
        _settle(token);
    }

    /// @notice Settle anything that was transferred in directly: burn WIF, forward basket assets.
    function sweep() external nonReentrant {
        _settle(address(WIF));
        uint256 n = FLOOR.assetCount();
        for (uint256 i; i < n; ++i) {
            _settle(FLOOR.asset(i));
        }
    }

    // ------------------------------------------------------------- convert

    /// @notice Buy Stock Tokens into the floor with `amountIn` of ETH (wrapped) or USDG.
    /// @return cashOut Cash-leg units bought.
    /// @return targetOut Units of the Ballot's current target bought.
    function convert(bool fromEth, uint256 amountIn)
        external
        nonReentrant
        returns (uint256 cashOut, uint256 targetOut)
    {
        IERC20 tokenIn;
        uint256 inPrice;
        uint256 inUnit;
        if (fromEth) {
            uint256 wrapped = WETH.balanceOf(address(this));
            if (wrapped < amountIn) {
                uint256 need = amountIn - wrapped;
                if (address(this).balance < need) revert InsufficientBalance();
                WETH.deposit{value: need}();
            }
            tokenIn = WETH;
            (inPrice,) = ETH_USD.fresh(MAX_AGE);
            inUnit = 1e18;
        } else {
            if (USDG.balanceOf(address(this)) < amountIn) revert InsufficientBalance();
            tokenIn = USDG;
            (inPrice,) = USDG_USD.fresh(MAX_AGE);
            inUnit = 1e6;
        }

        uint256 usd = Math.mulDiv(amountIn, inPrice, inUnit);
        if (usd < MIN_USD || usd > MAX_USD) revert OutsideLimits(usd);

        uint256 cashIn = amountIn * CASH_BPS / BPS;
        cashOut = _buy(0, fromEth, tokenIn, cashIn, inPrice, inUnit);
        targetOut = _buy(BALLOT.currentTarget(), fromEth, tokenIn, amountIn - cashIn, inPrice, inUnit);
    }

    // --------------------------------------------------------------- views

    function route(uint256 i) external view returns (bytes memory fromUsdg, bytes memory fromWeth) {
        Route storage r = _routes[i];
        return (r.fromUsdg, r.fromWeth);
    }

    /// @notice ETH (native + wrapped) and USDG waiting to be converted.
    function pending() external view returns (uint256 eth, uint256 usdg) {
        return (address(this).balance + WETH.balanceOf(address(this)), USDG.balanceOf(address(this)));
    }

    // ------------------------------------------------------------ internal

    function _buy(uint256 idx, bool fromEth, IERC20 tokenIn, uint256 amountIn, uint256 inPrice, uint256 inUnit)
        private
        returns (uint256 out)
    {
        IStockToken stock = IStockToken(FLOOR.asset(idx));
        if (stock.paused() || stock.oraclePaused()) revert StockPaused(address(stock));
        (uint256 stockPrice,) = IAggregatorV3(FLOOR.feed(idx)).fresh(MAX_AGE);

        // Stock Tokens have 18 decimals; both feeds have 8, so they cancel.
        uint256 expected = Math.mulDiv(amountIn * inPrice, 1e18, inUnit * stockPrice);
        uint256 minOut = expected * (BPS - BAND_BPS) / BPS;

        Route storage r = _routes[idx];
        tokenIn.forceApprove(address(ROUTER), amountIn);
        uint256 before = IERC20(address(stock)).balanceOf(address(FLOOR));
        // forge-lint: disable-next-line(unused-return)
        ROUTER.exactInput(
            ISwapRouter02.ExactInputParams({
                path: fromEth ? r.fromWeth : r.fromUsdg,
                recipient: address(FLOOR),
                amountIn: amountIn,
                amountOutMinimum: minOut
            })
        );
        // trust the balance, not the router's return value
        out = IERC20(address(stock)).balanceOf(address(FLOOR)) - before;
        if (out < minOut) revert BandBreached(out, minOut);
        tokenIn.forceApprove(address(ROUTER), 0);

        emit Converted(idx, address(tokenIn), amountIn, out, minOut, stockPrice);
    }

    function _settle(address token) private {
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal == 0) return;
        if (token == address(WIF)) {
            WIF.burn(bal);
            emit Burned(bal);
        } else if (FLOOR.indexOf(token) != type(uint256).max) {
            IERC20(token).safeTransfer(address(FLOOR), bal);
            emit Forwarded(token, bal);
        }
    }

    function _accepts(address token) private view returns (bool) {
        return token == address(WIF) || token == address(USDG) || token == address(WETH)
            || FLOOR.indexOf(token) != type(uint256).max;
    }

    /// @dev A v3 path is token (20) | fee (3) | token (20) | ... and must run `from` -> `to`.
    function _validPath(bytes memory path, address from, address to) private pure returns (bool) {
        uint256 len = path.length;
        if (len < 43 || (len - 20) % 23 != 0) return false;
        address first;
        address last;
        assembly ("memory-safe") {
            first := shr(96, mload(add(path, 32)))
            last := shr(96, mload(add(add(path, 32), sub(len, 20))))
        }
        return first == from && last == to;
    }
}
