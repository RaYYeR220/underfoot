// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Ballot} from "../src/Ballot.sol";
import {Intake} from "../src/Intake.sol";
import {Underfoot} from "../src/Underfoot.sol";
import {UnderfootHook} from "../src/UnderfootHook.sol";
import {Config} from "./Config.sol";
import {UnderfootSeeder} from "./Seed.s.sol";

/// @notice Every user action against the live deployment, one per run, so anyone can reproduce it.
///   ACTION=buy-wif     AMOUNT=<wei of ETH>
///   ACTION=vote        OPTION=<1-9> AMOUNT=<WIF wei>
///   ACTION=redeem      AMOUNT=<WIF wei>
///   ACTION=fund-wif    AMOUNT=<WIF wei>          (burned by the intake)
///   ACTION=sell-wif    AMOUNT=<WIF wei>          (hook pool: 0.5% of the SPY out goes to the floor)
///   ACTION=buy-back    AMOUNT=<SPY wei>          (hook pool: 0.5% of the WIF out is burned)
contract Demo is Script, UnderfootSeeder {
    function run() external {
        require(block.chainid == Config.CHAIN_ID, "wrong chain");
        string memory json = vm.readFile(vm.envOr("DEPLOYMENT", string("./deployments/4663.json")));
        Underfoot floor = Underfoot(vm.parseJsonAddress(json, ".floor"));
        Ballot ballot = Ballot(vm.parseJsonAddress(json, ".ballot"));
        Intake intake = Intake(payable(vm.parseJsonAddress(json, ".intake")));
        UnderfootHook hook = UnderfootHook(vm.parseJsonAddress(json, ".hook"));

        bytes32 action = keccak256(bytes(vm.envString("ACTION")));
        uint256 amount = vm.envUint("AMOUNT");
        IERC20 wif = IERC20(Config.WIF);
        uint256 supplyBefore = wif.totalSupply();

        vm.startBroadcast();
        if (action == keccak256("buy-wif")) {
            console2.log("WIF bought", _buyWif(amount, msg.sender));
        } else if (action == keccak256("vote")) {
            wif.approve(address(ballot), amount);
            ballot.vote(vm.envUint("OPTION"), amount);
        } else if (action == keccak256("redeem")) {
            wif.approve(address(floor), amount);
            uint256[] memory out = floor.redeem(amount, msg.sender, 0);
            for (uint256 i; i < out.length; ++i) {
                if (out[i] != 0) console2.log(floor.asset(i), out[i]);
            }
        } else if (action == keccak256("fund-wif")) {
            wif.approve(address(intake), amount);
            intake.fundToken(Config.WIF, amount);
        } else if (action == keccak256("sell-wif")) {
            _swapHookPool(hook, Config.WIF, amount);
        } else if (action == keccak256("buy-back")) {
            _swapHookPool(hook, Config.SPY, amount);
        } else {
            revert("unknown ACTION");
        }
        vm.stopBroadcast();

        console2.log("WIF burned", supplyBefore - wif.totalSupply());
        console2.log("floor SPY ", IERC20(Config.SPY).balanceOf(address(floor)));
    }
}
