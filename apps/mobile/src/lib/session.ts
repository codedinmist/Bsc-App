import { api, setSessionProvider } from "./api";
import { withSigner } from "@/wallet/keystore";

/** Signs a short message (after fingerprint, face or PIN) and receives a 12-hour read pass for this wallet's private data. */
setSessionProvider((address) =>
  withSigner("Confirm it is you to see your activity", async (account) => {
    const ts = Math.floor(Date.now() / 1000);
    const signature = await account.signMessage({ message: `JanSetu session\naddress:${address.toLowerCase()}\nts:${ts}` });
    return api.session(address, ts, signature);
  }),
);
