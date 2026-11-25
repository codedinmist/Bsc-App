jest.mock("jail-monkey", () => ({ __esModule: true, default: { isJailBroken: jest.fn(), hookDetected: jest.fn(), canMockLocation: jest.fn() } }));
jest.mock("react-native-ssl-public-key-pinning", () => ({ addSslPinningErrorListener: jest.fn(), initializeSslPinning: jest.fn(), isSslPinningAvailable: () => true }));

import JailMonkey from "jail-monkey";
import { assertDeviceSafe, checkDevice } from "../src/security/device";
import { parsePins } from "../src/security/pinning";

const mock = JailMonkey as unknown as { isJailBroken: jest.Mock; hookDetected: jest.Mock; canMockLocation: jest.Mock };
const G = globalThis as unknown as { __DEV__: boolean };
const reset = (jb = false, hook = false, mockLoc = false) => {
  mock.isJailBroken.mockReset(); mock.hookDetected.mockReset(); mock.canMockLocation.mockReset(); mock.isJailBroken.mockReturnValue(jb); mock.hookDetected.mockReturnValue(hook); mock.canMockLocation.mockReturnValue(mockLoc); };

describe("rooted-phone detection", () => {
  beforeEach(() => { G.__DEV__ = false; delete process.env.EXPO_PUBLIC_ALLOW_ROOTED; });
  test("a clean phone is safe", () => { reset(); expect(checkDevice().safe).toBe(true); expect(() => assertDeviceSafe()).not.toThrow(); });
  test("a rooted phone is blocked in release builds", () => { reset(true); expect(checkDevice().safe).toBe(false); expect(() => assertDeviceSafe()).toThrow(/will not sign/); });
  test("hooking tools are blocked", () => { reset(false, true); expect(() => assertDeviceSafe()).toThrow(/Frida|hooking/); });
  test("a detector that crashes fails closed", () => { mock.isJailBroken.mockImplementation(() => { throw new Error("x"); }); expect(checkDevice().safe).toBe(false); });
  test("the build flag allows testing on a rooted phone, and says so", () => { reset(true); process.env.EXPO_PUBLIC_ALLOW_ROOTED = "1"; const c = checkDevice(); expect(c.safe).toBe(true); expect(c.overridden).toBe(true); });
  test("debug builds are allowed", () => { reset(true); G.__DEV__ = true; expect(checkDevice().safe).toBe(true); });
});

describe("certificate pin config", () => {
  const h = (c: string) => c.repeat(43) + "=";
  test("needs two valid hashes per host and drops junk", () => {
    const cfg = parsePins(JSON.stringify({ "api.example.com": { publicKeyHashes: [h("A"), h("B")] }, "bad.example.com": { publicKeyHashes: [h("A")] }, "x y": { publicKeyHashes: [h("A"), h("B")] }, "short.com": { publicKeyHashes: ["abc", "def"] } }));
    expect(Object.keys(cfg)).toEqual(["api.example.com"]);
  });
  test("bad JSON or empty means pinning stays off", () => { expect(parsePins("{oops")).toEqual({}); expect(parsePins(undefined)).toEqual({}); });
});
