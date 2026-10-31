// A gasless vote from an account that holds WIF and no ETH: EIP-7702 delegation to the canonical
// Simple7702Account, an ERC-4337 v0.8 user operation, and gas paid by the Underfoot paymaster.
//   USER_PK=0x... OPTION=3 AMOUNT=100 APP_URL=http://localhost:3000 node scripts/sponsored-vote.mjs
import { MAINNET, BASKET, robinhood, voteCalls, txUrl } from "@underfoot/sdk";
import { createPublicClient, formatEther, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createBundlerClient, createPaymasterClient, toSimple7702SmartAccount } from "viem/account-abstraction";

const app = process.env.APP_URL ?? "http://localhost:3000";
const option = Number(process.env.OPTION ?? 3);
const amount = parseEther(process.env.AMOUNT ?? "100");

const owner = privateKeyToAccount(process.env.USER_PK);
const client = createPublicClient({
  chain: robinhood,
  transport: http(process.env.ROBINHOOD_RPC_URL, { retryCount: 8, retryDelay: 1_500 }),
});
const account = await toSimple7702SmartAccount({ client, owner });

const bundlerTransport = http(`${app}/api/bundler`);
const bundler = createBundlerClient({
  account,
  client,
  transport: bundlerTransport,
  paymaster: createPaymasterClient({ transport: http(`${app}/api/paymaster`) }),
  userOperation: {
    // the bundler quotes the fee it will accept
    estimateFeesPerGas: async () => {
      const res = await bundlerTransport({ chain: robinhood }).request({ method: "pimlico_getUserOperationGasPrice" });
      return { maxFeePerGas: BigInt(res.fast.maxFeePerGas), maxPriorityFeePerGas: BigInt(res.fast.maxPriorityFeePerGas) };
    },
  },
});

console.log(`account ${owner.address}: ${formatEther(await client.getBalance({ address: owner.address }))} ETH`);
console.log(`voting ${formatEther(amount)} WIF for ${BASKET[option].symbol}, gas sponsored`);

const delegated = (await client.getCode({ address: owner.address }))?.startsWith("0xef0100");
const authorization = delegated
  ? undefined
  : await owner.signAuthorization({
      contractAddress: account.authorization.address,
      chainId: robinhood.id,
      nonce: await client.getTransactionCount({ address: owner.address }),
    });

const hash = await bundler.sendUserOperation({ calls: voteCalls(MAINNET, { option, amount }), authorization });
console.log(`user operation ${hash}`);
const receipt = await bundler.waitForUserOperationReceipt({ hash, timeout: 120_000 });
console.log(`included: ${receipt.success ? "success" : "reverted"}  ${txUrl(receipt.receipt.transactionHash)}`);
console.log(`account still holds ${formatEther(await client.getBalance({ address: owner.address }))} ETH`);
