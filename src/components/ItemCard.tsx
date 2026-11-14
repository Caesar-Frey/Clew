import { router } from "expo-router";
import { memo } from "react";
import { Image, StyleSheet, View } from "react-native";

import type { Item } from "@/db/types";
import { callNumber, dueState, shortDate } from "@/lib/format";
import { jpegUri } from "@/photos/capture";
import { PATH_SEPARATOR } from "@/lib/locations";
import { IndexCard, T } from "@/ui/components";
import { usePalette } from "@/ui/theme";

/** A thing, as its catalog card. */
export const ItemCard = memo(function ItemCard({
  item,
  place,
  enterIndex,
}: {
  item: Item;
  /** `index.pathString(item.locationId)`; a string so memo can compare it. */
  place: string;
  enterIndex?: number;
}) {
  const p = usePalette();
  const path = place ? place.split(PATH_SEPARATOR) : [];
  const loan = item.activeLoan;
  const due = loan ? dueState(loan.dueAt) : "none";
  return (
    <IndexCard
      enterIndex={enterIndex}
      onPress={() =>
        router.push({ pathname: "/item/[id]", params: { id: item.id } })
      }
      accessibilityRole="button"
      accessibilityLabel={`${item.name}. ${loan ? `Lent to ${loan.person}` : path.length ? `In ${path.join(", ")}` : "No place yet"}`}
    >
      <View style={styles.top}>
        <T
          variant="small"
          color={p.headRule}
          numberOfLines={1}
          style={styles.callNo}
        >
          {callNumber(path)}
        </T>
        {loan ? (
          <View
            style={[
              styles.out,
              { borderColor: due === "overdue" ? p.stamp : p.leatherText },
            ]}
          >
            <T
              variant="label"
              color={due === "overdue" ? p.stamp : p.leatherText}
            >
              {due === "overdue" ? "Overdue" : "Out"}
            </T>
          </View>
        ) : null}
      </View>
      {item.cover ? (
        <View
          style={[
            styles.thumb,
            { borderColor: p.cardEdge, backgroundColor: p.cardEdge },
          ]}
        >
          <Image
            source={{ uri: jpegUri(item.cover) }}
            style={StyleSheet.absoluteFill}
            accessibilityIgnoresInvertColors
          />
        </View>
      ) : null}
      <T
        variant="heading"
        numberOfLines={2}
        style={[styles.title, item.cover ? { marginRight: 64 } : null]}
      >
        {item.name}
      </T>
      {loan ? (
        <T
          variant="typed"
          color={p.inkSoft}
          numberOfLines={1}
          style={item.cover ? { marginRight: 64 } : null}
        >
          With {loan.person}
          {loan.dueAt ? ` · due ${shortDate(loan.dueAt)}` : ""}
        </T>
      ) : (
        <T
          variant="typed"
          color={path.length ? p.inkSoft : p.inkFaint}
          numberOfLines={2}
          style={item.cover ? { marginRight: 64 } : null}
        >
          {place || "No place yet"}
        </T>
      )}
      {item.tags.length > 0 && (
        <T
          variant="small"
          color={p.inkFaint}
          numberOfLines={1}
          style={{ marginTop: 4 }}
        >
          {item.tags.map((t) => `#${t}`).join("  ")}
        </T>
      )}
    </IndexCard>
  );
});

const styles = StyleSheet.create({
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 22,
    marginBottom: 6,
  },
  callNo: { letterSpacing: 1.5, flexShrink: 1 },
  out: {
    borderWidth: 1.5,
    borderRadius: 3,
    paddingHorizontal: 6,
    paddingVertical: 1,
    transform: [{ rotate: "-4deg" }],
  },
  title: { marginBottom: 2 },
  thumb: {
    position: "absolute",
    right: 16,
    top: 44,
    width: 54,
    height: 54,
    borderWidth: 3,
    borderRadius: 2,
    overflow: "hidden",
    transform: [{ rotate: "2deg" }],
  },
});
