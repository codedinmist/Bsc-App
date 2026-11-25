jest.mock("../src/chain/deployments.json", () => ({ network: "bscTestnet", chainId: 97, contracts: { token: "0x00000000000000000000000000000000000000AA", daily: "0x00000000000000000000000000000000000000bb" } }));
import { assertAllowedTarget, contracts, isDeployed } from "../src/chain/deployments";

describe("signing allowlist (anti-phishing)", () => {
  test("only pinned contract addresses may be called, case-insensitively", () => {
    expect(() => assertAllowedTarget("0x00000000000000000000000000000000000000aa")).not.toThrow();
    expect(() => assertAllowedTarget("0x00000000000000000000000000000000000000BB")).not.toThrow();
    expect(() => assertAllowedTarget("0x00000000000000000000000000000000000000cc")).toThrow(/not a known JanSetu contract/);
  });
  test("an incomplete deployment is reported as not deployed", () => { expect(isDeployed).toBe(false); expect(Object.keys(contracts)).toHaveLength(2); });
});
