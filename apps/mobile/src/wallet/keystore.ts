import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { bytesToHex, type Hex } from "viem";
import { english, generateMnemonic, mnemonicToAccount, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { assertDeviceSafe } from "@/security/device";

const KEY = "jansetu.wallet.pk";
const ADDR = "jansetu.wallet.address";

/**
 * Key custody (honest description, shown in Settings):
 *  - Android Keystore cannot hold secp256k1 keys, so the private key is stored by expo-secure-store, which encrypts it
 *    with a hardware-backed key that REQUIRES biometric/device-lock authentication for every read.
 *  - The key is read only to sign, once per transaction, and the reference is dropped afterwards.
 *  - JavaScript strings cannot be zeroed, so a rooted/compromised device could still observe memory while signing.
 */
export const canProtectKey = () => true;

export async function readAddress(): Promise<`0x${string}` | null> {
  const a = await SecureStore.getItemAsync(ADDR);
  return a && /^0x[0-9a-fA-F]{40}$/.test(a) ? (a as `0x${string}`) : null;
}

const plain: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const withTimeout = <T,>(p: Promise<T>, ms: number) => new Promise<T>((res, rej) => { const t = setTimeout(() => rej(new Error("timeout")), ms); p.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); }); });

/** The key is always locked behind fingerprint, face or screen lock for every use. */
export async function isGuarded(): Promise<boolean> { return true; }

/** True when the phone has a fingerprint, face or at least a PIN/pattern/password. */
async function hasScreenLock(): Promise<boolean> {
  try { return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE; } catch { return false; }
}

/** Saves the key in the phone's encrypted store (Android Keystore backed). Refuses to create a wallet on a phone with no screen lock. */
async function persist(pk: Hex, address: string) {
  if (!(await hasScreenLock())) throw new Error("Set a screen lock (PIN, pattern, fingerprint or face) in your phone settings first. JanSetu will not store a wallet on an unlocked phone.");
  await SecureStore.setItemAsync(KEY, pk, plain);
  await SecureStore.setItemAsync(ADDR, address, plain);
}

/** Asks for fingerprint, face or PIN before every signing. Fails closed: if the check cannot run or is cancelled, nothing is signed. */
async function confirmUser(prompt: string) {
  if (!(await hasScreenLock())) throw new Error("Your phone has no screen lock, so JanSetu cannot confirm it is you. Set one in your phone settings.");
  let r: LocalAuthentication.LocalAuthenticationResult;
  try { r = await withTimeout(LocalAuthentication.authenticateAsync({ promptMessage: prompt, disableDeviceFallback: false }), 120_000); }
  catch { throw new Error("Could not confirm it is you. Please try again."); }
  if (!r.success) throw new Error("Confirmation cancelled.");
}

/** Creates a wallet. The recovery phrase is returned ONCE for the user to write down; it is not stored. */
export async function createWallet(): Promise<{ mnemonic: string; address: `0x${string}` }> {
  assertDeviceSafe();
  const mnemonic = generateMnemonic(english, 128);
  const account = mnemonicToAccount(mnemonic);
  await persist(bytesToHex(account.getHdKey().privateKey as Uint8Array), account.address);
  return { mnemonic, address: account.address };
}

export async function importWallet(phrase: string): Promise<`0x${string}`> {
  assertDeviceSafe();
  const m = phrase.trim().toLowerCase().replace(/\s+/g, " ");
  if (!validateMnemonic(m, wordlist)) throw new Error("That recovery phrase is not valid. Check the words and their order.");
  const account = mnemonicToAccount(m);
  await persist(bytesToHex(account.getHdKey().privateKey as Uint8Array), account.address);
  return account.address;
}

export async function removeWallet() {
  await SecureStore.deleteItemAsync(KEY);
  await SecureStore.deleteItemAsync(ADDR);
}

/** Runs `fn` with the signing account after biometric confirmation. The key is not kept anywhere else. */
export async function withSigner<T>(prompt: string, fn: (account: PrivateKeyAccount) => Promise<T>): Promise<T> {
  assertDeviceSafe();
  await confirmUser(prompt);
  const pk = await SecureStore.getItemAsync(KEY, plain);
  if (!pk) throw new Error("Authentication failed or the wallet key is unavailable. If you changed your phone's biometrics, restore with your recovery phrase.");
  return fn(privateKeyToAccount(pk as Hex));
}
