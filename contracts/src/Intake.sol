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
import {IUniswapV3Factory, IUniswapV3Pool} from "./interfaces/IUniswapV3.sol";
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
/// 20% into the cash leg and 80% into whatever the Ballot picked yesterday.
///
/// `convert` is permissionless and has no discretion. Routes are fixed at deploy. Before a leg
/// trades, every pool on its route must sit within 0.75% of Chainlink, so a pool pushed in the
/// same transaction is refused; the trade itself must then return at least the Chainlink amount
/// minus 1.5%. A leg is skipped — and its share goes to the other leg — when its Stock Token or
/// oracle is paused, its feed is stale or broken, or its pools are off-price. When neither leg
/// can trade (e.g. every feed is stale because markets are closed) nothing moves. At most
/// MAX_USD_PER_WINDOW can be converted per hour, however many calls are made.
contract Intake is ReentrancyGuardTransient {
    using SafeERC20 for IERC20;
    using OracleLib for IAggregatorV3;

    struct Route {
        bytes fromUsdg;
        bytes fromWeth;
    }

    struct Hop {
        address pool;
        bool zeroForOne;
    }

    /// @dev What is being spent: WETH or USDG, its Chainlink price and its unit.
    struct Input {
        bool fromEth;
        IERC20 token;
        uint256 price;
        uint256 unit;
    }

    enum Skip {
        None,
        Paused,
        OraclePaused,
        FeedUnusable,
        PoolOffPrice
    }

    uint256 public constant BPS = 10_000;
    /// @notice Share of every buy that goes to the cash leg (basket index 0).
    uint256 public constant CASH_BPS = 2_000;
    /// @notice Worst execution a buy may take, measured against Chainlink.
    uint256 public constant BAND_BPS = 150;
    /// @notice How far any pool on a route may sit from Chainlink before the leg is skipped.
    uint256 public constant SPOT_BPS = 75;
    /// @notice Feeds older than this are treated as markets-closed. Stock feeds heartbeat at 24h.
    uint256 public constant MAX_AGE = 26 hours;
    /// @notice Smallest convert, in USD with 8 decimals.
    uint256 public constant MIN_USD = 1e8;
    uint256 public constant WINDOW = 1 hours;

    Underfoot public immutable FLOOR;
    Ballot public immutable BALLOT;
    IBurnableToken public immutable WIF;
    IWETH public immutable WETH;
    IERC20 public immutable USDG;
    ISwapRouter02 public immutable ROUTER;
    IAggregatorV3 public immutable ETH_USD;
    IAggregatorV3 public immutable USDG_USD;
    /// @notice Most that can be converted per WINDOW, in USD with 8 decimals.
    uint256 public immutable MAX_USD_PER_WINDOW;

    Route[] private _routes;
    Hop[][] private _hopsFromUsdg;
    Hop[][] private _hopsFromWeth;

    uint64 public windowStart;
    uint192 public windowUsd;

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
    event LegSkipped(uint256 indexed assetIndex, Skip reason);
    event SettleFailed(address indexed token);

    error BadRoute(uint256 index);
    error BadFeed(address feed);
    error BallotMismatch();
    error UnsupportedToken(address token);
    error InsufficientBalance();
    error OutsideLimits(uint256 usdValue);
    error WindowFull(uint256 usedUsd, uint256 limitUsd);
    error NothingBuyable(uint256 targetIndex, Skip targetReason, Skip cashReason);
    error BandBreached(uint256 amountOut, uint256 minOut);
    error NotSelf();
    error ZeroAddress();

    constructor(
        Underfoot floor,
        Ballot ballot,
        IWETH weth,
        IERC20 usdg,
        ISwapRouter02 router,
        IUniswapV3Factory factory,
        IAggregatorV3 ethUsd,
        IAggregatorV3 usdgUsd,
        uint256 maxUsdPerWindow,
        Route[] memory routes
    ) {
        if (
            address(floor) == address(0) || address(ballot) == address(0) || address(weth) == address(0)
                || address(usdg) == address(0) || address(router) == address(0) || address(factory) == address(0)
        ) revert ZeroAddress();
        if (address(ballot.FLOOR()) != address(floor)) revert BallotMismatch();
        if (maxUsdPerWindow < MIN_USD) revert OutsideLimits(maxUsdPerWindow);
        _require8(ethUsd);
        _require8(usdgUsd);

        uint256 n = floor.assetCount();
        if (routes.length != n) revert BadRoute(routes.length);
        for (uint256 i; i < n; ++i) {
            address a = floor.asset(i);
            _require8(IAggregatorV3(floor.feed(i)));
            if (!_validPath(routes[i].fromUsdg, address(usdg), a)) revert BadRoute(i);
            if (!_validPath(routes[i].fromWeth, address(weth), a)) revert BadRoute(i);
            _routes.push(routes[i]);
            _hopsFromUsdg.push();
            _hopsFromWeth.push();
            _resolveHops(factory, routes[i].fromUsdg, _hopsFromUsdg[i], i);
            _resolveHops(factory, routes[i].fromWeth, _hopsFromWeth[i], i);
        }

        FLOOR = floor;
        BALLOT = ballot;
        WIF = floor.WIF();
        WETH = weth;
        USDG = usdg;
        ROUTER = router;
        ETH_USD = ethUsd;
        USDG_USD = usdgUsd;
        MAX_USD_PER_WINDOW = maxUsdPerWindow;
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
    ///         A paused Stock Token is left where it is and retried next time.
    function sweep() external nonReentrant {
        _settle(address(WIF));
        uint256 n = FLOOR.assetCount();
        for (uint256 i; i < n; ++i) {
            address t = FLOOR.asset(i);
            try this.settleOne(t) {}
            catch {
                emit SettleFailed(t);
            }
        }
    }

    /// @dev Only callable by this contract, so `sweep` can isolate a token that reverts.
    function settleOne(address token) external {
        if (msg.sender != address(this)) revert NotSelf();
        _settle(token);
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
        Input memory input = _input(fromEth, amountIn);

        uint256 usd = Math.mulDiv(amountIn, input.price, input.unit);
        if (usd < MIN_USD) revert OutsideLimits(usd);
        _spendWindow(usd);

        uint256 target = BALLOT.currentTarget();
        (Skip cashSkip, uint256 cashPrice) = _check(0, input);
        (Skip targetSkip, uint256 targetPrice) = _check(target, input);

        if (cashSkip != Skip.None && targetSkip != Skip.None) revert NothingBuyable(target, targetSkip, cashSkip);
        if (cashSkip != Skip.None) emit LegSkipped(0, cashSkip);
        if (targetSkip != Skip.None) emit LegSkipped(target, targetSkip);

        uint256 cashIn = cashSkip != Skip.None ? 0 : targetSkip != Skip.None ? amountIn : amountIn * CASH_BPS / BPS;
        if (cashIn != 0) cashOut = _buy(0, input, cashIn, cashPrice);
        if (amountIn > cashIn) targetOut = _buy(target, input, amountIn - cashIn, targetPrice);
    }

    // --------------------------------------------------------------- views

    function route(uint256 i) external view returns (bytes memory fromUsdg, bytes memory fromWeth) {
        Route storage r = _routes[i];
        return (r.fromUsdg, r.fromWeth);
    }

    function hops(uint256 i, bool fromEth) external view returns (Hop[] memory) {
        return fromEth ? _hopsFromWeth[i] : _hopsFromUsdg[i];
    }

    /// @notice ETH (native + wrapped) and USDG waiting to be converted.
    function pending() external view returns (uint256 eth, uint256 usdg) {
        return (address(this).balance + WETH.balanceOf(address(this)), USDG.balanceOf(address(this)));
    }

    /// @notice USD (8 decimals) still convertible in the current window.
    function windowRemaining() external view returns (uint256) {
        if (block.timestamp >= windowStart + WINDOW) return MAX_USD_PER_WINDOW;
        return windowUsd >= MAX_USD_PER_WINDOW ? 0 : MAX_USD_PER_WINDOW - windowUsd;
    }

    /// @notice Whether asset `i` could be bought right now, and why not.
    function check(uint256 i, bool fromEth) external view returns (Skip reason) {
        (uint256 inPrice,) = (fromEth ? ETH_USD : USDG_USD).fresh(MAX_AGE);
        (reason,) = _check(i, Input({fromEth: fromEth, token: fromEth ? WETH : USDG, price: inPrice, unit: fromEth ? 1e18 : 1e6}));
    }

    /// @notice Raw output units per 1e18 raw input units along a route, at pool spot prices.
    function spotRate(uint256 i, bool fromEth) public view returns (uint256 rate) {
        Hop[] storage h = fromEth ? _hopsFromWeth[i] : _hopsFromUsdg[i];
        rate = 1e18;
        for (uint256 k; k < h.length; ++k) {
            (uint160 sqrtP,,,,,,) = IUniswapV3Pool(h[k].pool).slot0();
            if (h[k].zeroForOne) {
                rate = Math.mulDiv(rate, sqrtP, 1 << 96);
                rate = Math.mulDiv(rate, sqrtP, 1 << 96);
            } else {
                rate = Math.mulDiv(rate, 1 << 96, sqrtP);
                rate = Math.mulDiv(rate, 1 << 96, sqrtP);
            }
        }
    }

    // ------------------------------------------------------------ internal

    function _spendWindow(uint256 usd) private {
        uint256 used = block.timestamp >= windowStart + WINDOW ? 0 : windowUsd;
        if (used == 0) windowStart = uint64(block.timestamp);
        used += usd;
        if (used > MAX_USD_PER_WINDOW) revert WindowFull(used, MAX_USD_PER_WINDOW);
        windowUsd = uint192(used);
    }

    /// @dev Never reverts on the asset's account: a bad token, oracle or pool becomes a reason.
    function _check(uint256 idx, Input memory input) private view returns (Skip, uint256 stockPrice) {
        IStockToken stock = IStockToken(FLOOR.asset(idx));
        if (_flag(address(stock), IStockToken.paused.selector)) return (Skip.Paused, 0);
        if (_flag(address(stock), IStockToken.oraclePaused.selector)) return (Skip.OraclePaused, 0);

        try this.readFeed(FLOOR.feed(idx)) returns (uint256 p) {
            stockPrice = p;
        } catch {
            return (Skip.FeedUnusable, 0);
        }

        // what Chainlink says one raw unit of input should buy, scaled by 1e18
        uint256 oracleRate = Math.mulDiv(input.price * 1e18, 1e18, input.unit * stockPrice);
        uint256 spot = spotRate(idx, input.fromEth);
        uint256 diff = spot > oracleRate ? spot - oracleRate : oracleRate - spot;
        if (diff * BPS > oracleRate * SPOT_BPS) return (Skip.PoolOffPrice, stockPrice);
        return (Skip.None, stockPrice);
    }

    /// @dev External so `_check` can catch a feed that reverts or is stale.
    function readFeed(address feed) external view returns (uint256 price) {
        (price,) = IAggregatorV3(feed).fresh(MAX_AGE);
    }

    function _input(bool fromEth, uint256 amountIn) private returns (Input memory input) {
        input.fromEth = fromEth;
        if (fromEth) {
            uint256 wrapped = WETH.balanceOf(address(this));
            if (wrapped < amountIn) {
                uint256 need = amountIn - wrapped;
                if (address(this).balance < need) revert InsufficientBalance();
                WETH.deposit{value: need}();
            }
            input.token = WETH;
            (input.price,) = ETH_USD.fresh(MAX_AGE);
            input.unit = 1e18;
        } else {
            if (USDG.balanceOf(address(this)) < amountIn) revert InsufficientBalance();
            input.token = USDG;
            (input.price,) = USDG_USD.fresh(MAX_AGE);
            input.unit = 1e6;
        }
    }

    function _buy(uint256 idx, Input memory input, uint256 amountIn, uint256 stockPrice)
        private
        returns (uint256 out)
    {
        address stock = FLOOR.asset(idx);
        IERC20 tokenIn = input.token;
        // Stock Tokens have 18 decimals; both feeds have 8, so they cancel.
        uint256 expected = Math.mulDiv(amountIn * input.price, 1e18, input.unit * stockPrice);
        uint256 minOut = expected * (BPS - BAND_BPS) / BPS;

        Route storage r = _routes[idx];
        tokenIn.forceApprove(address(ROUTER), amountIn);
        uint256 before = IERC20(stock).balanceOf(address(FLOOR));
        // forge-lint: disable-next-line(unused-return)
        ROUTER.exactInput(
            ISwapRouter02.ExactInputParams({
                path: input.fromEth ? r.fromWeth : r.fromUsdg,
                recipient: address(FLOOR),
                amountIn: amountIn,
                amountOutMinimum: minOut
            })
        );
        // trust the balance, not the router's return value
        out = IERC20(stock).balanceOf(address(FLOOR)) - before;
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

    /// @dev True only if the call succeeds and returns true; a reverting flag reads as set.
    function _flag(address target, bytes4 selector) private view returns (bool) {
        (bool ok, bytes memory ret) = target.staticcall(abi.encodeWithSelector(selector));
        if (!ok || ret.length < 32) return true;
        return abi.decode(ret, (bool));
    }

    function _require8(IAggregatorV3 feed) private view {
        if (address(feed) == address(0) || feed.decimals() != 8) revert BadFeed(address(feed));
    }

    function _resolveHops(IUniswapV3Factory factory, bytes memory path, Hop[] storage out, uint256 i) private {
        uint256 legs = (path.length - 20) / 23;
        for (uint256 k; k < legs; ++k) {
            uint256 o = k * 23;
            address a;
            uint24 fee;
            address b;
            assembly ("memory-safe") {
                let p := add(add(path, 32), o)
                a := shr(96, mload(p))
                fee := shr(232, mload(add(p, 20)))
                b := shr(96, mload(add(p, 23)))
            }
            address pool = factory.getPool(a, b, fee);
            if (pool == address(0)) revert BadRoute(i);
            out.push(Hop({pool: pool, zeroForOne: a < b}));
        }
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
