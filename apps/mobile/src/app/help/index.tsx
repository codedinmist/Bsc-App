import { useCallback, useState } from "react";
import { TextInput, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { radius, space, useColors } from "@/design/tokens";
import { ARTICLES, GLOSSARY, TOPICS } from "@/content/help";
import { getRead } from "@/lib/tour";
import { LargeTitleScreen } from "@/ui/LargeTitleScreen";
import { Icon } from "@/ui/Icon";
import { List, Row, Section } from "@/ui/parts";
import { T } from "@/ui/Text";

export default function Help() {
  const c = useColors();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [read, setRead] = useState<string[]>([]);
  useFocusEffect(useCallback(() => { getRead().then(setRead); }, []));
  const query = q.trim().toLowerCase();
  const hits = query ? ARTICLES.filter((a) => (a.title + " " + a.summary + " " + a.steps.join(" ")).toLowerCase().includes(query)) : [];
  const gloss = query ? GLOSSARY.filter((g) => (g.term + " " + g.meaning).toLowerCase().includes(query)) : [];
  const done = ARTICLES.filter((a) => read.includes(a.id)).length;

  return (
    <LargeTitleScreen title="Help" back>
      <Section index={0}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: c.surfaceAlt, borderRadius: radius.md, paddingHorizontal: space.md, minHeight: 44 }}>
          <Icon name="search" size={18} color={c.textSecondary} />
          <TextInput value={q} onChangeText={setQ} placeholder="Search help" placeholderTextColor={c.textSecondary} accessibilityLabel="Search help" autoCorrect={false} style={{ flex: 1, color: c.text, fontFamily: "Inter_400Regular", fontSize: 16, paddingVertical: 10 }} />
        </View>
      </Section>

      {query ? (
        <Section title={`Results`} index={1}>
          {hits.length + gloss.length === 0 ? <T v="body" color="textSecondary" style={{ marginLeft: 4 }}>Nothing found. Try another word.</T> : null}
          {hits.length ? <List>{hits.map((a, i) => <Row key={a.id} icon="book" title={a.title} subtitle={a.summary} onPress={() => router.push(`/help/${a.id}`)} last={i === hits.length - 1} />)}</List> : null}
          {gloss.length ? <List>{gloss.map((g, i) => <Row key={g.term} title={g.term} subtitle={g.meaning} last={i === gloss.length - 1} />)}</List> : null}
        </Section>
      ) : (
        <>
          <Section index={1}>
            <List>
              <Row icon="help" title="Take the quick tour" subtitle="Four short screens" onPress={() => router.push("/tour")} />
              <Row icon="check" title="Your progress" subtitle={`${done} of ${ARTICLES.length} guides read`} last />
            </List>
          </Section>
          {TOPICS.map((t, ti) => (
            <Section key={t} title={t} index={2 + ti}>
              <List>
                {ARTICLES.filter((a) => a.topic === t).map((a, i, arr) => (
                  <Row key={a.id} icon="book" title={a.title} subtitle={a.summary} right={read.includes(a.id) ? <Icon name="check" size={18} color={c.success} /> : undefined} onPress={() => router.push(`/help/${a.id}`)} last={i === arr.length - 1} />
                ))}
              </List>
            </Section>
          ))}
          <Section title="Glossary" index={7}>
            <List>{GLOSSARY.map((g, i) => <Row key={g.term} title={g.term} subtitle={g.meaning} last={i === GLOSSARY.length - 1} />)}</List>
          </Section>
        </>
      )}
    </LargeTitleScreen>
  );
}
