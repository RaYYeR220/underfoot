// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// @notice Reads a Chainlink feed and refuses anything it can't vouch for.
library OracleLib {
    error StaleFeed(address feed, uint256 updatedAt);
    error BadAnswer(address feed, int256 answer);

    /// @return price The answer, guaranteed positive.
    /// @return updatedAt When the answer was written.
    function fresh(IAggregatorV3 feed, uint256 maxAge) internal view returns (uint256 price, uint256 updatedAt) {
        (uint80 roundId, int256 answer,, uint256 ts, uint80 answeredInRound) = feed.latestRoundData();
        if (answer <= 0 || answeredInRound < roundId) revert BadAnswer(address(feed), answer);
        if (ts == 0 || ts > block.timestamp || block.timestamp - ts > maxAge) revert StaleFeed(address(feed), ts);
        return (uint256(answer), ts);
    }
}
