// Must be imported first. viem/noble need crypto.getRandomValues, which Hermes does not provide by default.
import * as ExpoCrypto from "expo-crypto";

const g = globalThis as unknown as { crypto?: { getRandomValues?: unknown } };
if (!g.crypto) g.crypto = {};
if (typeof g.crypto.getRandomValues !== "function") {
  g.crypto.getRandomValues = (arr: ArrayBufferView) => ExpoCrypto.getRandomValues(arr as Uint8Array);
}
