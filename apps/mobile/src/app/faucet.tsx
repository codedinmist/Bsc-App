import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { useChain } from "@/chain/DataProvider";
import { publicClient } from "@/chain/client";
import { faucetAbi } from "@/chain/abis";
import { contracts, isDeployed } from "@/chain/deployments";
import { useTx } from "@/chain/tx";
import { countdown, formatAmount } from "@/chain/format";
import { useWallet } from "@/wallet/WalletProvider";
import { useNow } from "@/hooks/useNow";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { Banner, Section, Stat } from "@/ui/parts";
import { Card } from "@/ui/Card";
import { Button } from "@/ui/Button";
import { Chip } from "@/ui/Chip";
import { Skeleton } from "@/ui/Skeleton";
import { T } from "@/ui/Text";
import { TxSheet } from "@/ui/TxSheet";

type Info = { amount: bigint; cooldown: bigint; max: bigint; next: bigint; claimed: bigint };

export default function Faucet() {
  const { address } = useWallet();
  const { refresh, bnb } = useChain();
  const now = useNow();
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState(false);

  const load = useCallback(async () => {
    if (!address || !isDeployed) return;
    try {
      const f = contracts.faucet!;
      const [amount, cooldown, max, next, claimed] = await Promise.all([
        publicClient.readContract({ address: f, abi: faucetAbi, functionName: "claimAmount" }),
        publicClient.readContract({ address: f, abi: faucetAbi, functionName: "cooldown" }),
        publicClient.readContract({ address: f, abi: faucetAbi, functionName: "maxPerWallet" }),
        publicClient.readContract({ address: f, abi: faucetAbi, functionName: "nextClaimAt", args: [address] }),
        publicClient.readContract({ address: f, abi: faucetAbi, functionName: "totalClaimed", args: [address] }),
      ]);
      setInfo({ amount, cooldown, max, next, claimed }); setErr(false);
    } catch { setErr(true); }
  }, [address]);
  useEffect(() => { load(); }, [load]);

  const tx = useTx(() => { load(); refresh(); });
  const wait = info ? Math.max(0, Number(info.next) - now) : 0;
  const atLimit = info ? info.claimed + info.amount > info.max : false;
  const canClaim = !!info && wait === 0 && !atLimit && bnb > 0n;

  return (
    <LargeTitleScreen title="Add money" subtitle="Top up your wallet, free of charge" back>
      <Section index={0}><Chip kind="testnet" label="Preview network · tINR has no cash value" /></Section>
      {!isDeployed ? <Section><Banner kind="warning" title="Faucet not deployed yet" body="It will work as soon as the contracts are deployed and linked." /></Section> : (
        <Section index={1}>
          <Card style={{ gap: 20 }}>
            {!info && !err ? <Skeleton height={80} /> : err ? <T color="error">Can't reach the network. Pull back and try again.</T> : info && (
              <>
                <View style={{ gap: 4 }}>
                  <T v="footnote" color="textSecondary">Each claim gives</T>
                  <T v="title1" style={{ fontVariant: ["tabular-nums"] }}>{formatAmount(info.amount)} tINR</T>
                </View>
                <View style={{ flexDirection: "row" }}>
                  <Stat label="You've claimed" value={formatAmount(info.claimed)} hint={`of ${formatAmount(info.max)} limit`} />
                  <Stat label="Cooldown" value={countdown(Number(info.cooldown))} hint="between claims" />
                </View>
                {bnb === 0n ? <Banner kind="warning" title="A small network fee is needed" body="Every action is recorded on the public network, which takes a tiny fee in BNB. You can get some free from the BNB faucet." /> : null}
                {atLimit ? <Banner title="Limit reached" body="This wallet has claimed the maximum from the faucet." /> : null}
                <Button label={wait > 0 ? `Next claim in ${countdown(wait)}` : "Add tINR"} disabled={!canClaim} onPress={() => tx.run("Add tINR", [{ label: "Claim from faucet", address: contracts.faucet!, abi: faucetAbi, functionName: "claim" }], { amount: formatAmount(info.amount), rows: [{ label: "Source", value: "JanSetu" }] })} />
              </>
            )}
          </Card>
        </Section>
      )}
      <TxSheet state={tx.state} onClose={tx.reset} />
    </LargeTitleScreen>
  );
}
