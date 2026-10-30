// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {Hooks} from "v4-core/libraries/Hooks.sol";
import {HookMiner} from "v4-periphery/test/shared/HookMiner.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";

import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IBurnableToken} from "../src/interfaces/IBurnableToken.sol";
import {ISwapRouter02} from "../src/interfaces/ISwapRouter02.sol";
import {IWETH} from "../src/interfaces/IWETH.sol";
import {Ballot} from "../src/Ballot.sol";
import {Intake} from "../src/Intake.sol";
import {Underfoot} from "../src/Underfoot.sol";
import {UnderfootHook} from "../src/UnderfootHook.sol";
import {UnderfootLens, IStateView} from "../src/UnderfootLens.sol";
import {UnderfootPaymaster} from "../src/UnderfootPaymaster.sol";
import {Config} from "./Config.sol";

struct Deployment {
    Underfoot floor;
    Ballot ballot;
    Intake intake;
    UnderfootHook hook;
    UnderfootPaymaster paymaster;
    UnderfootLens lens;
}

/// @notice Deploys the whole system against Robinhood Chain mainnet addresses.
///         Shared by the deploy script and the fork tests so both run the same code.
abstract contract UnderfootDeployer {
    uint160 internal constant HOOK_FLAGS =
        uint160(Hooks.BEFORE_INITIALIZE_FLAG | Hooks.AFTER_SWAP_FLAG | Hooks.AFTER_SWAP_RETURNS_DELTA_FLAG);

    /// @param create2Deployer Who executes `new X{salt: _}`: the CREATE2 proxy inside a script,
    ///        the calling contract inside a test.
    function _deployAll(address sponsor, address create2Deployer) internal returns (Deployment memory d) {
        (address[] memory assets, address[] memory feeds) = Config.basket();
        d.floor = new Underfoot(IBurnableToken(Config.WIF), assets, feeds);
        d.ballot = new Ballot(d.floor, Config.DEFAULT_OPTION);
        d.intake = new Intake(
            d.floor,
            d.ballot,
            IWETH(Config.WETH),
            IERC20(Config.USDG),
            ISwapRouter02(Config.SWAP_ROUTER_02),
            IAggregatorV3(Config.ETH_USD),
            IAggregatorV3(Config.USDG_USD),
            Config.MAX_USD_PER_CONVERT,
            Config.routes()
        );

        bytes memory args = abi.encode(IPoolManager(Config.POOL_MANAGER), address(d.floor), Config.WIF, Config.SPY);
        (address predicted, bytes32 salt) =
            HookMiner.find(create2Deployer, HOOK_FLAGS, type(UnderfootHook).creationCode, args);
        d.hook = new UnderfootHook{salt: salt}(
            IPoolManager(Config.POOL_MANAGER), address(d.floor), IBurnableToken(Config.WIF), Config.SPY
        );
        require(address(d.hook) == predicted, "hook address mismatch");

        d.paymaster = new UnderfootPaymaster(
            IEntryPoint(Config.ENTRY_POINT_V08),
            Config.SIMPLE_7702_ACCOUNT,
            sponsor,
            d.floor,
            d.ballot,
            Config.PAYMASTER_MIN_BURN,
            Config.PAYMASTER_MAX_COST
        );
        d.lens = new UnderfootLens(d.intake, IStateView(Config.STATE_VIEW), Config.WIF_POOL_ID);
    }
}

/// @notice forge script script/Deploy.s.sol --rpc-url robinhood --broadcast --verify
contract Deploy is Script, UnderfootDeployer {
    function run() external returns (Deployment memory d) {
        require(block.chainid == Config.CHAIN_ID, "wrong chain");
        address sponsor = vm.envAddress("SPONSOR_ADDRESS");

        vm.startBroadcast();
        d = _deployAll(sponsor, Config.CREATE2_DEPLOYER);
        vm.stopBroadcast();

        string memory o = "deployment";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "block", block.number);
        vm.serializeAddress(o, "floor", address(d.floor));
        vm.serializeAddress(o, "ballot", address(d.ballot));
        vm.serializeAddress(o, "intake", address(d.intake));
        vm.serializeAddress(o, "hook", address(d.hook));
        vm.serializeAddress(o, "paymaster", address(d.paymaster));
        vm.serializeAddress(o, "sponsor", sponsor);
        string memory json = vm.serializeAddress(o, "lens", address(d.lens));
        vm.writeJson(json, string.concat("./deployments/", vm.toString(block.chainid), ".json"));

        console2.log("floor    ", address(d.floor));
        console2.log("ballot   ", address(d.ballot));
        console2.log("intake   ", address(d.intake));
        console2.log("hook     ", address(d.hook));
        console2.log("paymaster", address(d.paymaster));
        console2.log("lens     ", address(d.lens));
    }
}
