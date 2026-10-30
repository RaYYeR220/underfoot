import "server-only";

import { ENTRY_POINT_V08, WIF, paymasterAbi, robinhood } from "@underfoot/sdk";
import { encodeAbiParameters, erc20Abi, hexToBigInt, isAddressEqual, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  formatUserOperation,
  toPackedUserOperation,
  type RpcUserOperation,
  type UserOperation,
} from "viem/account-abstraction";

import { requireAddresses } from "./config";
import { allow } from "./ratelimit";
import { serverClient } from "./server";

/** Gas our validation needs: calldata decode, one ECDSA recover, one EXTCODECOPY. */
const PM_VERIFICATION_GAS = 150_000n;
const PM_POST_OP_GAS = 0n;
const VALIDITY_SECONDS = 120;
/** A well-formed 65-byte signature for gas estimation; it recovers to some address, never the sponsor. */
const STUB_SIGNATURE: Hex = `0x${"ff".repeat(64)}1b`;
const DAY = 86_400_000;

export class SponsorRefusal extends Error {}

/** One live signature per (account, nonce): a second request for the same operation slot is refused. */
const signed = new Map<string, number>();
function takeQuota(sender: Address, nonce: bigint, ip: string) {
  const slot = `${sender.toLowerCase()}:${nonce}`;
  const prev = signed.get(slot);
  if (prev && Date.now() - prev < VALIDITY_SECONDS * 1000) throw new SponsorRefusal("this operation was already sponsored");
  if (!allow(`sponsor:acct:${sender.toLowerCase()}`, 20, DAY)) throw new SponsorRefusal("daily limit reached for this account");
  if (!allow(`sponsor:ip:${ip}`, 40, DAY)) throw new SponsorRefusal("daily limit reached for this connection");
  if (!allow("sponsor:all", 2_000, DAY)) throw new SponsorRefusal("sponsorship is paused for today");
  signed.set(slot, Date.now());
  if (signed.size > 20_000) signed.clear();
}

/** Ask the bundler to simulate the operation; refuse to sign anything that would revert. */
async function simulate(rpcOp: RpcUserOperation<"0.8">, draft: UserOperation<"0.8">) {
  const url = process.env.BUNDLER_URL;
  if (!url) return;
  const hex = (v: bigint) => `0x${v.toString(16)}`;
  const op = {
    ...rpcOp,
    paymaster: draft.paymaster,
    paymasterVerificationGasLimit: hex(draft.paymasterVerificationGasLimit ?? PM_VERIFICATION_GAS),
    paymasterPostOpGasLimit: hex(draft.paymasterPostOpGasLimit ?? PM_POST_OP_GAS),
    paymasterData: draft.paymasterData,
  };
  const res = (await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_estimateUserOperationGas", params: [op, ENTRY_POINT_V08] }),
    cache: "no-store",
  }).then((r) => r.json())) as { error?: { message?: string } };
  if (res.error) throw new SponsorRefusal(`simulation failed: ${res.error.message ?? "reverted"}`);
}

function sponsorAccount() {
  const pk = process.env.SPONSOR_PRIVATE_KEY as Hex | undefined;
  if (!pk) throw new SponsorRefusal("sponsorship is not configured");
  return privateKeyToAccount(pk);
}

function checkContext(entryPoint: Address, chainId: Hex) {
  if (!isAddressEqual(entryPoint, ENTRY_POINT_V08)) throw new SponsorRefusal("only EntryPoint v0.8 is sponsored");
  if (hexToBigInt(chainId) !== BigInt(robinhood.id)) throw new SponsorRefusal("only Robinhood Chain is sponsored");
}

/** The same rules the paymaster enforces on-chain, checked before we spend a signature. */
async function checkRules(op: UserOperation<"0.8">, paymaster: Address) {
  const [burned, minBurn, maxCost] = await Promise.all([
    serverClient
      .readContract({ address: paymaster, abi: paymasterAbi, functionName: "burnedBy", args: [op.callData] })
      .catch(() => {
        throw new SponsorRefusal("only votes and redemptions are sponsored");
      }),
    serverClient.readContract({ address: paymaster, abi: paymasterAbi, functionName: "MIN_BURN" }),
    serverClient.readContract({ address: paymaster, abi: paymasterAbi, functionName: "MAX_COST" }),
  ]);
  if (burned < minBurn) throw new SponsorRefusal(`a sponsored action must burn at least ${minBurn / 10n ** 18n} WIF`);

  const balance = await serverClient.readContract({ address: WIF, abi: erc20Abi, functionName: "balanceOf", args: [op.sender] });
  if (balance < burned) throw new SponsorRefusal("not enough WIF for this action");

  const gas =
    op.callGasLimit + op.verificationGasLimit + op.preVerificationGas + PM_VERIFICATION_GAS + PM_POST_OP_GAS;
  if (gas * op.maxFeePerGas > maxCost) throw new SponsorRefusal("operation is too expensive to sponsor");
}

function withPaymaster(op: UserOperation<"0.8">, paymaster: Address, data: Hex): UserOperation<"0.8"> {
  return {
    ...op,
    paymaster,
    paymasterData: data,
    paymasterVerificationGasLimit: op.paymasterVerificationGasLimit ?? PM_VERIFICATION_GAS,
    paymasterPostOpGasLimit: op.paymasterPostOpGasLimit ?? PM_POST_OP_GAS,
  };
}

const validity = () => {
  const now = Math.floor(Date.now() / 1000);
  return { validUntil: now + VALIDITY_SECONDS, validAfter: now - 30 };
};

const timeData = (validUntil: number, validAfter: number) =>
  encodeAbiParameters([{ type: "uint48" }, { type: "uint48" }], [validUntil, validAfter]);

/** ERC-7677 pm_getPaymasterStubData */
export async function stubData(rpcOp: RpcUserOperation<"0.8">, entryPoint: Address, chainId: Hex) {
  checkContext(entryPoint, chainId);
  const { paymaster } = requireAddresses();
  const op = formatUserOperation(rpcOp) as UserOperation<"0.8">;
  await checkRules(op, paymaster);
  const { validUntil, validAfter } = validity();
  return {
    paymaster,
    paymasterData: `${timeData(validUntil, validAfter)}${STUB_SIGNATURE.slice(2)}` as Hex,
    paymasterVerificationGasLimit: `0x${PM_VERIFICATION_GAS.toString(16)}`,
    paymasterPostOpGasLimit: `0x${PM_POST_OP_GAS.toString(16)}`,
    isFinal: false,
    sponsor: { name: "Underfoot" },
  };
}

/** ERC-7677 pm_getPaymasterData */
export async function finalData(rpcOp: RpcUserOperation<"0.8">, entryPoint: Address, chainId: Hex, ip: string) {
  checkContext(entryPoint, chainId);
  const { paymaster } = requireAddresses();
  const op = formatUserOperation(rpcOp) as UserOperation<"0.8">;
  await checkRules(op, paymaster);

  const { validUntil, validAfter } = validity();
  const prefix = timeData(validUntil, validAfter);
  const draft = withPaymaster(op, paymaster, `${prefix}${STUB_SIGNATURE.slice(2)}` as Hex);
  await simulate(rpcOp, draft);
  takeQuota(op.sender, op.nonce, ip);
  const hash = await serverClient.readContract({
    address: paymaster,
    abi: paymasterAbi,
    functionName: "getHash",
    args: [toPackedUserOperation(draft), validUntil, validAfter],
  });
  const signature = await sponsorAccount().signMessage({ message: { raw: hash } });
  return {
    paymaster,
    paymasterData: `${prefix}${signature.slice(2)}` as Hex,
    paymasterVerificationGasLimit: `0x${draft.paymasterVerificationGasLimit!.toString(16)}`,
    paymasterPostOpGasLimit: `0x${draft.paymasterPostOpGasLimit!.toString(16)}`,
  };
}
