// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {TickMath} from "v4-core/libraries/TickMath.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {IV4Router} from "v4-periphery/src/interfaces/IV4Router.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {LiquidityAmounts} from "v4-periphery/src/libraries/LiquidityAmounts.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {ISwapRouter02} from "../src/interfaces/ISwapRouter02.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {Intake} from "../src/Intake.sol";
import {UnderfootHook} from "../src/UnderfootHook.sol";
import {UnderfootLens} from "../src/UnderfootLens.sol";
import {Config} from "./Config.sol";

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

/// @notice Opens the WIF/SPY pool behind the Underfoot hook and puts the first liquidity in it.
///         Shared by the seed script and the fork test.
abstract contract UnderfootSeeder {
    address internal constant UNIVERSAL_ROUTER = 0x8876789976dEcBfCbBbe364623C63652db8C0904;
    address internal constant PONS_HOOK = 0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044;
    /// @notice The LP position covers roughly ±20% around the opening price.
    int24 internal constant HALF_RANGE = 1_800;

    /// @dev Buy WIF with ETH through the deepest WIF pool (native ETH / WIF, Uniswap v4).
    function _buyWif(uint256 eth, address to) internal returns (uint256 got) {
        PoolKey memory pons = PoolKey({
            currency0: Currency.wrap(address(0)),
            currency1: Currency.wrap(Config.WIF),
            fee: 0,
            tickSpacing: 200,
            hooks: IHooks(PONS_HOOK)
        });
        bytes memory actions = abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL));
        bytes[] memory p = new bytes[](3);
        p[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: pons,
                zeroForOne: true,
                amountIn: uint128(eth),
                amountOutMinimum: 0,
                minHopPriceX36: 0,
                hookData: ""
            })
        );
        p[1] = abi.encode(Currency.wrap(address(0)), eth);
        p[2] = abi.encode(Currency.wrap(Config.WIF), uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, p);
        uint256 before = IERC20(Config.WIF).balanceOf(to);
        IUniversalRouter(UNIVERSAL_ROUTER).execute{value: eth}(hex"10", inputs, block.timestamp + 300);
        got = IERC20(Config.WIF).balanceOf(to) - before;
    }

    /// @dev Buy SPY with ETH through the deepest SPY pool (WETH / SPY, Uniswap v3).
    function _buySpy(uint256 eth, address to) internal returns (uint256 got) {
        IWETH(Config.WETH).deposit{value: eth}();
        IWETH(Config.WETH).approve(Config.SWAP_ROUTER_02, eth);
        got = ISwapRouter02(Config.SWAP_ROUTER_02).exactInput(
            ISwapRouter02.ExactInputParams({
                path: abi.encodePacked(Config.WETH, uint24(500), Config.SPY),
                recipient: to,
                amountIn: eth,
                amountOutMinimum: 0
            })
        );
    }

    /// @dev Opening price: WIF per SPY from Chainlink SPY/USD and the WIF spot price.
    function _openingSqrtPrice(UnderfootLens lens) internal view returns (uint160) {
        (, int256 spyUsd,,,) = IAggregatorV3(Config.SPY_USD).latestRoundData();
        uint256 wifUsd = lens.wifPriceUsd();
        require(wifUsd != 0 && spyUsd > 0, "no price");
        // currency0 = SPY, currency1 = WIF: price = WIF per SPY, both 18 decimals
        uint256 priceX18 = uint256(spyUsd) * 1e10 * 1e18 / wifUsd;
        return uint160(Math.sqrt(Math.mulDiv(priceX18, 1 << 192, 1e18)));
    }

    /// @notice Initialise the hook pool and mint a position owned by `owner`.
    function _seedPool(UnderfootHook hook, UnderfootLens lens, uint256 spyAmount, uint256 wifAmount, address owner)
        internal
        returns (uint256 liquidity, uint160 sqrtP)
    {
        PoolKey memory key = hook.poolKey();
        require(Currency.unwrap(key.currency0) == Config.SPY, "unexpected order");
        IPositionManager posm = IPositionManager(Config.POSITION_MANAGER);

        sqrtP = _openingSqrtPrice(lens);
        posm.initializePool(key, sqrtP);

        int24 tick = TickMath.getTickAtSqrtPrice(sqrtP);
        int24 lower = ((tick - HALF_RANGE) / 60) * 60;
        int24 upper = ((tick + HALF_RANGE) / 60) * 60;
        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtP, TickMath.getSqrtPriceAtTick(lower), TickMath.getSqrtPriceAtTick(upper), spyAmount, wifAmount
        );

        for (uint256 i; i < 2; ++i) {
            address t = i == 0 ? Config.SPY : Config.WIF;
            IERC20(t).approve(Config.PERMIT2, type(uint256).max);
            IAllowanceTransfer(Config.PERMIT2).approve(t, address(posm), type(uint160).max, uint48(block.timestamp + 1 days));
        }

        bytes memory actions = abi.encodePacked(uint8(Actions.MINT_POSITION), uint8(Actions.SETTLE_PAIR));
        bytes[] memory p = new bytes[](2);
        p[0] = abi.encode(key, lower, upper, liquidity, spyAmount, wifAmount, owner, bytes(""));
        p[1] = abi.encode(key.currency0, key.currency1);
        posm.modifyLiquidities(abi.encode(actions, p), block.timestamp + 300);
    }
}

/// @notice SEED_POOL_WIF_ETH / SEED_POOL_SPY_ETH buy each side of the pool;
///         SEED_FLOOR_ETH goes to the intake and is converted right away (weekdays only).
contract Seed is Script, UnderfootSeeder {
    function run() external {
        require(block.chainid == Config.CHAIN_ID, "wrong chain");
        string memory json = vm.readFile(vm.envOr("DEPLOYMENT", string("./deployments/4663.json")));
        UnderfootHook hook = UnderfootHook(vm.parseJsonAddress(json, ".hook"));
        UnderfootLens lens = UnderfootLens(vm.parseJsonAddress(json, ".lens"));
        Intake intake = Intake(payable(vm.parseJsonAddress(json, ".intake")));

        uint256 wifEth = vm.envUint("SEED_POOL_WIF_ETH");
        uint256 spyEth = vm.envUint("SEED_POOL_SPY_ETH");
        uint256 floorEth = vm.envOr("SEED_FLOOR_ETH", uint256(0));

        vm.startBroadcast();
        address me = msg.sender;
        uint256 wif = _buyWif(wifEth, me);
        uint256 spy = _buySpy(spyEth, me);
        (uint256 liquidity, uint160 sqrtP) = _seedPool(hook, lens, spy, wif, me);
        if (floorEth != 0) {
            intake.fund{value: floorEth}();
            intake.convert(true, floorEth);
        }
        vm.stopBroadcast();

        console2.log("WIF bought ", wif);
        console2.log("SPY bought ", spy);
        console2.log("liquidity  ", liquidity);
        console2.log("sqrtPrice  ", sqrtP);
    }
}
