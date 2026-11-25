import { View } from "react-native";
import { api } from "@/lib/api";
import { useWallet } from "@/wallet/WalletProvider";
import { useAsync } from "@/hooks/useAsync";
import { space } from "@/design/tokens";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { Banner, Section } from "@/ui/parts";
import { Card } from "@/ui/Card";
import { Skeleton } from "@/ui/Skeleton";
import { T } from "@/ui/Text";

const when = (sec: number) => new Date(sec * 1000).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** In-app feed. It reads what the backend made from on-chain events (orders, loans, bonuses). Phone push alerts need Firebase set up for the build. */
export default function Notifications() {
  const { address } = useWallet();
  const feed = useAsync(async () => (address ? (await api.notifications(address)).items : []), [address], null as null | { id: string; title: string; body: string; at: number; read: boolean }[]);
  return (
    <LargeTitleScreen title="Notifications" subtitle="What happened on your accounts" back>
      {feed.error ? <Section index={0}><Banner kind="warning" title="Updates unavailable" body="We could not load your notifications just now. Your balances and accounts still update on every screen." /></Section> : null}
      {feed.loading && !feed.error ? <Skeleton height={90} /> : null}
      {feed.value?.length === 0 ? <Section index={0}><Card><T v="body" color="textSecondary">Nothing yet. Orders, loan reminders and bonuses will appear here.</T></Card></Section> : null}
      {feed.value?.map((n, i) => (
        <Section key={n.id} index={i}>
          <Card style={{ gap: space.xs }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", gap: space.md }}><T v="headline" style={{ flex: 1 }}>{n.title}</T><T v="caption" color="textSecondary">{when(n.at)}</T></View>
            <T v="footnote" color="textSecondary">{n.body}</T>
          </Card>
        </Section>
      ))}
    </LargeTitleScreen>
  );
}
