import { api } from "./api";
import { withSigner } from "@/wallet/keystore";

/**
 * Asks the (testnet) KYC desk to verify this wallet. The request is a signed message, so nobody can ask on someone else's behalf.
 * On a real launch an operator checks documents off-chain first; here the desk may approve automatically, which is clearly a test feature.
 */
export async function requestKyc(): Promise<"approved" | "pending"> {
  return withSigner("Confirm your identity request", async (account) => {
    const ts = Math.floor(Date.now() / 1000);
    const signature = await account.signMessage({ message: `JanSetu KYC request\naddress:${account.address.toLowerCase()}\nts:${ts}` });
    return (await api.requestKyc(account.address, ts, signature)).status;
  });
}

/** Signs and posts the agent's public search listing (name and area only; no exact location is stored). */
export async function listAgent(name: string, pincode: string, district: string): Promise<void> {
  await withSigner("Confirm your agent listing", async (account) => {
    const ts = Math.floor(Date.now() / 1000);
    const message = `JanSetu agent profile\naddress:${account.address.toLowerCase()}\nname:${name}\npincode:${pincode}\ndistrict:${district}\nts:${ts}`;
    const signature = await account.signMessage({ message });
    await api.listAgent({ address: account.address, name, pincode, district, ts, signature });
  });
}
