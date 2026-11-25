import { ethers } from "hardhat";
import { deployCore, E, k } from "../scripts/lib/deployAll";

export { E, k };
export const DAY = 24 * 3600;

export async function fixture(deckRewardTargets = false, extra: Record<string, any> = {}) {
  const [admin, alice, bob, carol, relayer, loan, ops] = await ethers.getSigners();
  const c = await deployCore({ admin, deckRewardTargets, ...extra });
  const vaults = [c.daily, c.rd, c.fd];
  for (const u of [alice, bob, carol]) {
    await c.registry.connect(u).register();
    await c.token.connect(admin).transfer(u.address, E(5_000_000));
    for (const v of vaults) await c.token.connect(u).approve(await v.getAddress(), ethers.MaxUint256);
  }
  await c.token.connect(admin).approve(await c.daily.getAddress(), ethers.MaxUint256);
  await c.token.connect(admin).approve(await c.rd.getAddress(), ethers.MaxUint256);
  await c.token.connect(admin).approve(await c.fd.getAddress(), ethers.MaxUint256);
  return { admin, alice, bob, carol, relayer, loan, ops, ...c };
}
