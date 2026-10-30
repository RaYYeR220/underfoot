// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {SafeCast} from "v4-core/libraries/SafeCast.sol";
import {BalanceDelta} from "v4-core/types/BalanceDelta.sol";
import {BeforeSwapDelta} from "v4-core/types/BeforeSwapDelta.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {IBurnableToken} from "./interfaces/IBurnableToken.sol";

/// @title UnderfootHook
/// @notice A Uniswap v4 hook for one pool: WIF / a basket Stock Token (SPY).
///
/// On every swap it takes 0.5% of the unspecified side on top of the 0.3% LP fee:
///   - if that side is the Stock Token, the fee is sent straight into the floor;
///   - if it is WIF, the fee is burned.
/// Either way the backing of every WIF left goes up. The hook holds nothing between swaps and
/// has no owner. `beforeInitialize` pins it to exactly one pool key.
contract UnderfootHook is IHooks {
    using SafeCast for uint256;
    using PoolIdLibrary for PoolKey;

    uint256 public constant BPS = 10_000;
    uint256 public constant HOOK_FEE_BPS = 50;
    uint24 public constant LP_FEE = 3_000;
    int24 public constant TICK_SPACING = 60;

    IPoolManager public immutable POOL_MANAGER;
    address public immutable FLOOR;
    IBurnableToken public immutable WIF;
    address public immutable STOCK;

    event FloorFee(PoolId indexed poolId, address indexed currency, uint256 amount, bool burned);

    error NotPoolManager();
    error WrongPool();
    error HookNotImplemented();

    constructor(IPoolManager poolManager, address floor, IBurnableToken wif, address stock) {
        POOL_MANAGER = poolManager;
        FLOOR = floor;
        WIF = wif;
        STOCK = stock;
        Hooks.validateHookPermissions(IHooks(address(this)), getHookPermissions());
    }

    modifier onlyPoolManager() {
        if (msg.sender != address(POOL_MANAGER)) revert NotPoolManager();
        _;
    }

    function getHookPermissions() public pure returns (Hooks.Permissions memory) {
        return Hooks.Permissions({
            beforeInitialize: true,
            afterInitialize: false,
            beforeAddLiquidity: false,
            afterAddLiquidity: false,
            beforeRemoveLiquidity: false,
            afterRemoveLiquidity: false,
            beforeSwap: false,
            afterSwap: true,
            beforeDonate: false,
            afterDonate: false,
            beforeSwapReturnDelta: false,
            afterSwapReturnDelta: true,
            afterAddLiquidityReturnDelta: false,
            afterRemoveLiquidityReturnDelta: false
        });
    }

    /// @notice The only pool this hook will ever serve.
    function poolKey() public view returns (PoolKey memory key) {
        (address a, address b) = address(WIF) < STOCK ? (address(WIF), STOCK) : (STOCK, address(WIF));
        key = PoolKey({
            currency0: Currency.wrap(a),
            currency1: Currency.wrap(b),
            fee: LP_FEE,
            tickSpacing: TICK_SPACING,
            hooks: IHooks(address(this))
        });
    }

    function beforeInitialize(address, PoolKey calldata key, uint160) external view onlyPoolManager returns (bytes4) {
        PoolKey memory k = poolKey();
        if (
            Currency.unwrap(key.currency0) != Currency.unwrap(k.currency0)
                || Currency.unwrap(key.currency1) != Currency.unwrap(k.currency1) || key.fee != k.fee
                || key.tickSpacing != k.tickSpacing || address(key.hooks) != address(this)
        ) revert WrongPool();
        return IHooks.beforeInitialize.selector;
    }

    function afterSwap(
        address,
        PoolKey calldata key,
        IPoolManager.SwapParams calldata params,
        BalanceDelta delta,
        bytes calldata
    ) external onlyPoolManager returns (bytes4, int128) {
        // the fee is charged on the unspecified side: the output of an exact-in swap,
        // the input of an exact-out swap
        bool specifiedIs0 = (params.amountSpecified < 0) == params.zeroForOne;
        (Currency currency, int128 amount) =
            specifiedIs0 ? (key.currency1, delta.amount1()) : (key.currency0, delta.amount0());
        if (amount < 0) amount = -amount;

        uint256 fee = uint256(uint128(amount)) * HOOK_FEE_BPS / BPS;
        if (fee == 0) return (IHooks.afterSwap.selector, 0);

        PoolId id = key.toId();
        if (Currency.unwrap(currency) == address(WIF)) {
            POOL_MANAGER.take(currency, address(this), fee);
            WIF.burn(fee);
            emit FloorFee(id, address(WIF), fee, true);
        } else {
            POOL_MANAGER.take(currency, FLOOR, fee);
            emit FloorFee(id, Currency.unwrap(currency), fee, false);
        }
        return (IHooks.afterSwap.selector, fee.toInt128());
    }

    // ------------------------------------------------------ not implemented

    function afterInitialize(address, PoolKey calldata, uint160, int24) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function beforeAddLiquidity(address, PoolKey calldata, IPoolManager.ModifyLiquidityParams calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterAddLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        bytes calldata
    ) external pure returns (bytes4) {
        revert HookNotImplemented();
    }

    function afterRemoveLiquidity(
        address,
        PoolKey calldata,
        IPoolManager.ModifyLiquidityParams calldata,
        BalanceDelta,
        BalanceDelta,
        bytes calldata
    ) external pure returns (bytes4, BalanceDelta) {
        revert HookNotImplemented();
    }

    function beforeSwap(address, PoolKey calldata, IPoolManager.SwapParams calldata, bytes calldata)
        external
        pure
        returns (bytes4, BeforeSwapDelta, uint24)
    {
        revert HookNotImplemented();
    }

    function beforeDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }

    function afterDonate(address, PoolKey calldata, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        revert HookNotImplemented();
    }
}
