import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useMemo } from "react";
import { Alert, FlatList, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Item } from "@/db/types";
import { dueState, relativeDays, shortDate } from "@/lib/format";
import { useData } from "@/state/data";
import { IndexCard, LibraryButton, Room, Stamp, T } from "@/ui/components";
import { PersonIcon } from "@/ui/icons";
import { usePalette } from "@/ui/theme";
import { useToast } from "@/ui/toast";

/** Who has my stuff: active loans grouped by borrower, overdue first. */
export default function LentScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { items, actions } = useData();
  const toast = useToast();

  const groups = useMemo(() => {
    const byPerson = new Map<string, { person: string; items: Item[] }>();
    for (const item of items) {
      const loan = item.activeLoan;
      if (!loan) continue;
      const key = loan.person.toLowerCase();
      const g = byPerson.get(key) ?? { person: loan.person, items: [] };
      g.items.push(item);
      byPerson.set(key, g);
    }
    const dueKey = (i: Item) => i.activeLoan?.dueAt ?? Number.MAX_SAFE_INTEGER;
    const list = [...byPerson.values()];
    for (const g of list) g.items.sort((a, b) => dueKey(a) - dueKey(b));
    return list.sort(
      (a, b) =>
        dueKey(a.items[0]!) - dueKey(b.items[0]!) ||
        a.person.localeCompare(b.person),
    );
  }, [items]);

  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const overdue = items.filter(
    (i) => i.activeLoan && dueState(i.activeLoan.dueAt) === "overdue",
  ).length;

  return (
    <Room>
      <FlatList
        data={groups}
        keyExtractor={(g) => g.person}
        contentContainerStyle={{
          paddingTop: insets.top + 12,
          paddingHorizontal: 18,
          paddingBottom: 32,
          gap: 16,
        }}
        ListHeaderComponent={
          <View>
            <T variant="label" color={p.headRule}>
              Circulation desk · {total} out
              {overdue ? ` · ${overdue} overdue` : ""}
            </T>
            <T variant="title">Lent out</T>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Stamp
              text="All in"
              sub="nothing checked out"
              color={p.stampReturned}
            />
            <T
              variant="italic"
              color={p.inkSoft}
              style={{ textAlign: "center" }}
            >
              When you lend something, it shows up here with whoever has it.
            </T>
          </View>
        }
        renderItem={({ item: g, index: gi }) => (
          <IndexCard
            key={g.person}
            enterIndex={gi}
            punched={false}
            ruled={false}
            style={{ paddingBottom: 14 }}
          >
            <View style={styles.patron}>
              <View style={[styles.avatar, { backgroundColor: p.lamp }]}>
                <PersonIcon size={20} color={p.onLamp} />
              </View>
              <View style={{ flex: 1 }}>
                <T variant="label">Borrower&apos;s card</T>
                <T variant="heading">{g.person}</T>
              </View>
              <T variant="typed" color={p.inkSoft}>
                {g.items.length}
              </T>
            </View>
            {g.items.map((item) => {
              const loan = item.activeLoan!;
              const state = dueState(loan.dueAt);
              return (
                <View
                  key={item.id}
                  style={[styles.loanRow, { borderTopColor: p.rule }]}
                >
                  <Pressable
                    style={{ flex: 1, gap: 2 }}
                    accessibilityRole="button"
                    onPress={() =>
                      router.push({
                        pathname: "/item/[id]",
                        params: { id: item.id },
                      })
                    }
                  >
                    <T variant="body" numberOfLines={1}>
                      {item.name}
                    </T>
                    <T
                      variant="small"
                      color={
                        state === "overdue"
                          ? p.stamp
                          : state === "soon"
                            ? p.leatherText
                            : p.inkSoft
                      }
                    >
                      {loan.dueAt
                        ? state === "overdue"
                          ? `Overdue, was due ${relativeDays(loan.dueAt)}`
                          : `Due ${shortDate(loan.dueAt)} (${relativeDays(loan.dueAt)})`
                        : `Since ${shortDate(loan.lentAt)}`}
                    </T>
                  </Pressable>
                  <LibraryButton
                    compact
                    tone="lamp"
                    label="Back"
                    accessibilityLabel={`${item.name} is back`}
                    onPress={async () => {
                      try {
                        const loanId = await actions.returnItem(item.id);
                        Haptics.notificationAsync(
                          Haptics.NotificationFeedbackType.Success,
                        ).catch(() => {});
                        if (loanId)
                          toast({
                            message: `“${item.name}” is back`,
                            undo: () => actions.undoReturn(loanId),
                          });
                      } catch (e) {
                        Alert.alert(
                          "That didn't save",
                          e instanceof Error ? e.message : String(e),
                        );
                      }
                    }}
                  />
                </View>
              );
            })}
          </IndexCard>
        )}
      />
    </Room>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: "center",
    gap: 16,
    paddingVertical: 48,
    paddingHorizontal: 12,
  },
  patron: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 6,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  loanRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
