import type { Address } from "viem";

export { robinhood } from "viem/chains";

export const WIF: Address = "0x5173b8ea6923c2d40267890d45c46a3480954773";
export const USDG: Address = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168";
export const WETH: Address = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73";
export const DEAD: Address = "0x000000000000000000000000000000000000dEaD";
export const EXPLORER = "https://robinhoodchain.blockscout.com";

export const ENTRY_POINT_V08: Address = "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108";
export const SIMPLE_7702_ACCOUNT: Address = "0xe6Cae83BdE06E4c305530e199D7217f42808555B";

export interface BasketAsset {
  index: number;
  symbol: string;
  name: string;
  token: Address;
  feed: Address;
  /** Index 0 is the cash leg: a fixed 20% of every buy, not votable. */
  cashLeg: boolean;
}

/** The floor's fixed basket, in contract order. */
export const BASKET: readonly BasketAsset[] = [
  { index: 0, symbol: "SGOV", name: "iShares 0-3 Month Treasury Bond ETF", token: "0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5", feed: "0xa0DF4ee0fFf975306345875E3548Fcc519577A11", cashLeg: true },
  { index: 1, symbol: "SPY", name: "SPDR S&P 500 ETF Trust", token: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", feed: "0x319724394D3A0e3669269846abE664Cd621f9f6A", cashLeg: false },
  { index: 2, symbol: "QQQ", name: "Invesco QQQ Trust", token: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", feed: "0x80901d846d5D7B030F26B480776EE3b29374C2ae", cashLeg: false },
  { index: 3, symbol: "NVDA", name: "NVIDIA", token: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15", cashLeg: false },
  { index: 4, symbol: "TSLA", name: "Tesla", token: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", feed: "0x4A1166a659A55625345e9515b32adECea5547C38", cashLeg: false },
  { index: 5, symbol: "AAPL", name: "Apple", token: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0", cashLeg: false },
  { index: 6, symbol: "MSFT", name: "Microsoft", token: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", feed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E", cashLeg: false },
  { index: 7, symbol: "GOOGL", name: "Alphabet", token: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", feed: "0xF6f373a037c30F0e5010d854385cA89185AE638b", cashLeg: false },
  { index: 8, symbol: "AMZN", name: "Amazon", token: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", feed: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C", cashLeg: false },
  { index: 9, symbol: "META", name: "Meta Platforms", token: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", feed: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1", cashLeg: false },
];

export const DEFAULT_OPTION = 1;
export const EXIT_FEE_BPS = 100n;
export const MIN_VOTE = 10n ** 18n;
/** Sponsored (gasless) operations must burn at least this much WIF. */
export const SPONSOR_MIN_BURN = 100n * 10n ** 18n;

export const txUrl = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const addressUrl = (a: string) => `${EXPLORER}/address/${a}`;
