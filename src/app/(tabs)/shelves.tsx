import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useBoxMatcher } from "@/components/BoxScanner";
import { ItemCard } from "@/components/ItemCard";
import { PlaceExistsError, useData } from "@/state/data";
import { useToast } from "@/ui/toast";
import {
  IndexCard,
  KeyboardScreen,
  LibraryButton,
  Room,
  SectionLabel,
  spineColor,
  Stamp,
  T,
  TypedInput,
} from "@/ui/components";
import { CameraIcon, ChevronIcon } from "@/ui/icons";
import { usePalette } from "@/ui/theme";

/** Browse the places tree from the top: rooms, then what's inside them. */
export default function ShelvesScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { items, index, actions } = useData();
  const [adding, setAdding] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { hasBoxes } = useBoxMatcher();
  const toast = useToast();

  const roots = useMemo(() => index.children.get(null) ?? [], [index]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const root of roots) {
      const ids = index.subtreeIds(root.id);
      c.set(
        root.id,
        items.filter((i) => i.locationId && ids.has(i.locationId)).length,
      );
    }
    return c;
  }, [roots, index, items]);
  const unshelved = items.filter((i) => !i.locationId && !i.activeLoan);

  const create = async () => {
    if (creating) return;
    if (!newPath.trim()) {
      setError("Type a place name.");
      return;
    }
    setCreating(true);
    try {
      await actions.addPlace(newPath);
      setNewPath("");
      setAdding(false);
      setError(null);
    } catch (e) {
      if (e instanceof PlaceExistsError) {
        setNewPath("");
        setAdding(false);
        setError(null);
        toast({ message: e.message });
        router.push({ pathname: "/place/[id]", params: { id: e.id } });
        return;
      }
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Room>
      <KeyboardScreen>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingTop: insets.top + 12,
            paddingHorizontal: 18,
            paddingBottom: 32,
            gap: 14,
          }}
        >
          <View>
            <T variant="label" color={p.headRule}>
              The stacks · {index.byId.size}{" "}
              {index.byId.size === 1 ? "place" : "places"}
            </T>
            <T variant="title">Shelves</T>
          </View>

          {hasBoxes && (
            <LibraryButton
              tone="lamp"
              label="Which box is this?"
              icon={(c) => <CameraIcon size={20} color={c} />}
              onPress={() => router.push("/identify")}
            />
          )}

          {roots.length === 0 && !adding && (
            <View style={styles.empty}>
              <Stamp
                text="Unshelved"
                sub="no places yet"
                color={p.leatherText}
              />
              <T
                variant="italic"
                color={p.inkSoft}
                style={{ textAlign: "center" }}
              >
                Places appear here as you add things, nested however you like:
                House › Garage › Blue box.
              </T>
            </View>
          )}

          {roots.map((root, i) => {
            const kids = index.children.get(root.id) ?? [];
            return (
              <IndexCard
                key={root.id}
                enterIndex={i}
                punched={false}
                ruled={false}
                style={{ paddingBottom: 16, paddingLeft: 26 }}
                onPress={() =>
                  router.push({
                    pathname: "/place/[id]",
                    params: { id: root.id },
                  })
                }
                accessibilityRole="button"
              >
                <View
                  style={[
                    styles.spineEdge,
                    { backgroundColor: spineColor(root.name) },
                  ]}
                />
                <View style={styles.rowBetween}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <T variant="heading">{root.name}</T>
                    <T variant="small" numberOfLines={1}>
                      {counts.get(root.id) ?? 0}{" "}
                      {counts.get(root.id) === 1 ? "thing" : "things"}
                      {kids.length
                        ? ` · ${kids.map((k) => k.name).join(", ")}`
                        : ""}
                    </T>
                  </View>
                  <ChevronIcon size={20} color={p.inkFaint} />
                </View>
              </IndexCard>
            );
          })}

          {adding ? (
            <View style={{ gap: 12 }}>
              <TypedInput
                label="New place"
                value={newPath}
                onChangeText={setNewPath}
                placeholder="e.g. Attic > Suitcase"
                autoFocus
                onSubmitEditing={create}
              />
              {error && (
                <T variant="small" color={p.stamp}>
                  {error}
                </T>
              )}
              <View style={styles.row}>
                <LibraryButton
                  style={{ flex: 1 }}
                  compact
                  tone="ghost"
                  label="Cancel"
                  onPress={() => setAdding(false)}
                />
                <LibraryButton
                  style={{ flex: 1 }}
                  compact
                  tone="lamp"
                  label={creating ? "Adding…" : "Add place"}
                  disabled={creating}
                  onPress={create}
                />
              </View>
            </View>
          ) : (
            <LibraryButton
              tone="ghost"
              label="+ New place"
              onPress={() => setAdding(true)}
            />
          )}

          {unshelved.length > 0 && (
            <View style={{ gap: 12, marginTop: 8 }}>
              <SectionLabel>Not shelved yet</SectionLabel>
              {unshelved.map((item) => (
                <ItemCard key={item.id} item={item} place="" />
              ))}
            </View>
          )}
        </ScrollView>
      </KeyboardScreen>
    </Room>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: "center",
    gap: 16,
    paddingVertical: 40,
    paddingHorizontal: 12,
  },
  spineEdge: { position: "absolute", left: 0, top: 0, bottom: 0, width: 10 },
  rowBetween: { flexDirection: "row", alignItems: "center", gap: 12 },
  row: { flexDirection: "row", gap: 10 },
});
