// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IStockToken} from "./interfaces/IStockToken.sol";
import {Ballot} from "./Ballot.sol";
import {Intake} from "./Intake.sol";
import {Underfoot} from "./Underfoot.sol";

interface IStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

/// @title UnderfootLens
/// @notice One read for everything an app needs. View-only, holds nothing, never reverts on a
///         bad feed: it reports the feed's timestamp and a `stale` flag instead of guessing.
contract UnderfootLens {
    struct Asset {
        address token;
        string symbol;
        uint256 balance;
        uint256 multiplier;
        uint256 price;
        uint256 updatedAt;
        bool stale;
        bool paused;
        bool oraclePaused;
        uint256 valueUsd;
        uint256 backingPerWif;
        uint256 tally;
    }

    struct Snapshot {
        uint256 timestamp;
        uint256 totalSupply;
        uint256 dead;
        uint256 circulating;
        uint256 navUsd;
        uint256 backingPerWifUsd;
        uint256 wifPriceUsd;
        uint256 epoch;
        uint256 epochEnd;
        uint256 target;
        uint256 leader;
        uint256 epochBurned;
        uint256 pendingEth;
        uint256 pendingUsdg;
        Asset[] assets;
    }

    Underfoot public immutable FLOOR;
    Ballot public immutable BALLOT;
    Intake public immutable INTAKE;
    IStateView public immutable STATE_VIEW;
    /// @notice The deepest native-ETH / WIF v4 pool, read for a display price only.
    bytes32 public immutable WIF_POOL_ID;
    IAggregatorV3 public immutable ETH_USD;
    uint256 public immutable MAX_AGE;

    constructor(Intake intake, IStateView stateView, bytes32 wifPoolId) {
        INTAKE = intake;
        FLOOR = intake.FLOOR();
        BALLOT = intake.BALLOT();
        ETH_USD = intake.ETH_USD();
        MAX_AGE = intake.MAX_AGE();
        STATE_VIEW = stateView;
        WIF_POOL_ID = wifPoolId;
    }

    /// @notice USD values carry 18 decimals; prices are raw Chainlink answers (8 decimals).
    function snapshot() external view returns (Snapshot memory s) {
        s.timestamp = block.timestamp;
        s.totalSupply = FLOOR.WIF().totalSupply();
        s.dead = FLOOR.WIF().balanceOf(FLOOR.DEAD());
        s.circulating = s.totalSupply - s.dead;

        uint256 e = BALLOT.currentEpoch();
        s.epoch = e;
        s.epochEnd = BALLOT.epochEnd(e);
        s.target = BALLOT.currentTarget();
        s.leader = BALLOT.winner(e);
        s.epochBurned = BALLOT.epochBurned(e);
        (s.pendingEth, s.pendingUsdg) = INTAKE.pending();

        uint256 n = FLOOR.assetCount();
        s.assets = new Asset[](n);
        for (uint256 i; i < n; ++i) {
            Asset memory a = _asset(i, e, s.circulating);
            s.navUsd += a.valueUsd;
            s.assets[i] = a;
        }
        if (s.circulating != 0) s.backingPerWifUsd = Math.mulDiv(s.navUsd, 1e18, s.circulating);
        s.wifPriceUsd = wifPriceUsd();
    }

    /// @notice Spot WIF price in USD (18 decimals) from the WIF pool and Chainlink ETH/USD.
    ///         Display only — nothing in the protocol uses it.
    function wifPriceUsd() public view returns (uint256) {
        (uint256 ethUsd,, bool stale) = _read(ETH_USD);
        if (stale || ethUsd == 0) return 0;
        (uint160 sqrtP,,,) = STATE_VIEW.getSlot0(WIF_POOL_ID);
        if (sqrtP == 0) return 0;
        // currency0 = ETH, currency1 = WIF, so P = WIF per ETH
        uint256 priceX96 = Math.mulDiv(sqrtP, sqrtP, 1 << 96);
        if (priceX96 == 0) return 0;
        return Math.mulDiv(ethUsd * 1e10, 1 << 96, priceX96);
    }

    function _asset(uint256 i, uint256 e, uint256 circulating) private view returns (Asset memory a) {
        IStockToken t = IStockToken(FLOOR.asset(i));
        a.token = address(t);
        a.symbol = _symbol(address(t));
        a.balance = _try(address(t), abi.encodeCall(IERC20.balanceOf, (address(FLOOR))));
        a.multiplier = _try(address(t), abi.encodeCall(IStockToken.uiMultiplier, ()));
        a.paused = _try(address(t), abi.encodeCall(IStockToken.paused, ())) != 0;
        a.oraclePaused = _try(address(t), abi.encodeCall(IStockToken.oraclePaused, ())) != 0;
        (a.price, a.updatedAt, a.stale) = _read(IAggregatorV3(FLOOR.feed(i)));
        // Chainlink's Stock Token price already includes the multiplier, so raw balance * price
        a.valueUsd = Math.mulDiv(a.balance, a.price, 1e8);
        if (circulating != 0) a.backingPerWif = Math.mulDiv(a.balance, 1e18, circulating);
        if (i != 0) a.tally = BALLOT.tally(e, i);
    }

    function _read(IAggregatorV3 f) private view returns (uint256 price, uint256 updatedAt, bool stale) {
        try f.latestRoundData() returns (uint80, int256 answer, uint256, uint256 ts, uint80) {
            if (answer <= 0) return (0, ts, true);
            return (uint256(answer), ts, ts == 0 || ts > block.timestamp || block.timestamp - ts > MAX_AGE);
        } catch {
            return (0, 0, true);
        }
    }

    function _symbol(address token) private view returns (string memory) {
        try IERC20Metadata(token).symbol() returns (string memory sym) {
            return sym;
        } catch {
            return "";
        }
    }

    function _try(address target, bytes memory data) private view returns (uint256 v) {
        (bool ok, bytes memory ret) = target.staticcall(data);
        if (ok && ret.length >= 32) v = abi.decode(ret, (uint256));
    }
}
