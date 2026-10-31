// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {IV4Router} from "v4-periphery/src/interfaces/IV4Router.sol";
import {Actions} from "v4-periphery/src/libraries/Actions.sol";
import {IPositionManager} from "v4-periphery/src/interfaces/IPositionManager.sol";
import {IAllowanceTransfer} from "permit2/src/interfaces/IAllowanceTransfer.sol";

import {Config} from "../../script/Config.sol";
import {Deployment, UnderfootDeployer} from "../../script/Deploy.s.sol";
import {IUniversalRouter, UnderfootSeeder} from "../../script/Seed.s.sol";

/// @notice The real launch path: buy both sides, open the hook pool through the official
///         PositionManager, then trade it through the official UniversalRouter.
contract SeedForkTest is Test, UnderfootDeployer, UnderfootSeeder {
    Deployment d;
    IERC20 wif = IERC20(Config.WIF);
    IERC20 spy = IERC20(Config.SPY);

    function setUp() public {
        vm.createSelectFork(vm.envOr("ROBINHOOD_RPC_URL", string("https://rpc.mainnet.chain.robinhood.com")));
        d = _deployAll(address(1), address(this));
        vm.deal(address(this), 10 ether);
    }

    function test_fork_seedAndTradeThroughUniversalRouter() public {
        uint256 w = _buyWif(0.03 ether, address(this));
        uint256 s = _buySpy(0.03 ether, address(this));
        assertGt(w, 0);
        assertGt(s, 0);
        (uint256 liquidity,) = _seedPool(d.hook, d.lens, s, w, address(this));
        assertGt(liquidity, 0);
        assertEq(IERC721Like(Config.POSITION_MANAGER).balanceOf(address(this)), 1, "we own the LP position");

        // a trader sells WIF for SPY through the official router: the floor gets SPY
        address trader = makeAddr("trader");
        deal(Config.WIF, trader, 20_000e18);
        uint256 floorSpy = spy.balanceOf(address(d.floor));
        _routerSwap(trader, Config.WIF, 20_000e18);
        assertGt(spy.balanceOf(address(d.floor)), floorSpy, "fee in SPY reached the floor");

        // and buys WIF back with SPY: the fee is burned
        uint256 supply = wif.totalSupply();
        _routerSwap(trader, Config.SPY, spy.balanceOf(trader));
        assertLt(wif.totalSupply(), supply, "fee in WIF was burned");
    }

    function _routerSwap(address trader, address tokenIn, uint256 amount) internal {
        PoolKey memory key = d.hook.poolKey();
        bool zeroForOne = Currency.unwrap(key.currency0) == tokenIn;
        address tokenOut = zeroForOne ? Currency.unwrap(key.currency1) : Currency.unwrap(key.currency0);
        bytes memory actions = abi.encodePacked(uint8(Actions.SWAP_EXACT_IN_SINGLE), uint8(Actions.SETTLE_ALL), uint8(Actions.TAKE_ALL));
        bytes[] memory p = new bytes[](3);
        p[0] = abi.encode(
            IV4Router.ExactInputSingleParams({
                poolKey: key,
                zeroForOne: zeroForOne,
                amountIn: uint128(amount),
                amountOutMinimum: 0,
                minHopPriceX36: 0,
                hookData: ""
            })
        );
        p[1] = abi.encode(Currency.wrap(tokenIn), amount);
        p[2] = abi.encode(Currency.wrap(tokenOut), uint256(0));
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(actions, p);
        vm.startPrank(trader);
        IERC20(tokenIn).approve(Config.PERMIT2, type(uint256).max);
        IAllowanceTransfer(Config.PERMIT2).approve(tokenIn, UNIVERSAL_ROUTER, type(uint160).max, uint48(block.timestamp + 1 hours));
        IUniversalRouter(UNIVERSAL_ROUTER).execute(hex"10", inputs, block.timestamp + 60);
        vm.stopPrank();
    }

    receive() external payable {}
}

interface IERC721Like {
    function balanceOf(address) external view returns (uint256);
}
