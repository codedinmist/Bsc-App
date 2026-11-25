import { useEffect } from "react";
import { View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { space, useColors } from "@/design/tokens";
import { ARTICLES } from "@/content/help";
import { markRead } from "@/lib/tour";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { Banner, Section } from "@/ui/parts";
import { Card } from "@/ui/Card";
import { T } from "@/ui/Text";

export default function HelpArticle() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const a = ARTICLES.find((x) => x.id === id);
  useEffect(() => { if (a) markRead(a.id); }, [a]);
  if (!a) return <LargeTitleScreen title="Help" back><T v="body">This guide was not found.</T></LargeTitleScreen>;
  return (
    <LargeTitleScreen title={a.title} subtitle={a.summary} back>
      <Section index={0}>
        <Card style={{ gap: space.lg }}>
          {a.steps.map((s, i) => (
            <View key={i} style={{ flexDirection: "row", gap: space.md }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c.tint, alignItems: "center", justifyContent: "center" }}><T v="caption" color="tintText" style={{ fontFamily: "Inter_700Bold" }}>{i + 1}</T></View>
              <T v="body" style={{ flex: 1 }}>{s}</T>
            </View>
          ))}
        </Card>
      </Section>
      {a.note ? <Section index={1}><Banner title="Good to know" body={a.note} /></Section> : null}
    </LargeTitleScreen>
  );
}
