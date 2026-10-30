// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {Config} from "../../script/Config.sol";
import {Deployment, UnderfootDeployer} from "../../script/Deploy.s.sol";

/// @notice Prints how far each route's pools sit from Chainlink right now (calibration aid).
contract DeviationForkTest is Test, UnderfootDeployer {
    function test_fork_printDeviations() public {
        vm.createSelectFork(vm.envOr("ROBINHOOD_RPC_URL", string("https://rpc.mainnet.chain.robinhood.com")));
        Deployment memory d = _deployAll(address(1), address(this));
        (, address[] memory feeds) = Config.basket();
        for (uint256 i; i < feeds.length; ++i) {
            for (uint256 j; j < 2; ++j) {
                bool fromEth = j == 0;
                (, int256 inP,,,) = IAggregatorV3(fromEth ? Config.ETH_USD : Config.USDG_USD).latestRoundData();
                (, int256 sP,, uint256 ts,) = IAggregatorV3(feeds[i]).latestRoundData();
                uint256 unit = fromEth ? 1e18 : 1e6;
                uint256 oracle = uint256(inP) * 1e18 * 1e18 / (unit * uint256(sP));
                uint256 spot = d.intake.spotRate(i, fromEth);
                int256 bps = (int256(spot) - int256(oracle)) * 10_000 / int256(oracle);
                console2.log(i, fromEth ? "ETH " : "USDG", vm.toString(bps), block.timestamp - ts);
            }
        }
    }
}
