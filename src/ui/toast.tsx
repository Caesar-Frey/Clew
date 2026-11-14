import * as Haptics from "expo-haptics";
import { usePathname } from "expo-router";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAnimatedValue, useReducedMotion } from "./animated";
import { fonts, usePalette } from "./theme";
import { pushToast, runUndo, SHOW_MS, toastLift } from "./toastStack";

interface ToastInput {
  message: string;
  /** Shows an Undo button that runs this. */
  undo?: () => Promise<unknown> | void;
  /** A second button, such as View or Add place. */
  action?: { label: string; onPress: () => void };
}

interface Toast extends ToastInput {
  key: number;
}

const ToastContext = createContext<((t: ToastInput) => void) | null>(null);
const LiftContext = createContext<((height: number) => void) | null>(null);

export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast outside ToastProvider");
  return show;
}

/** The tab bar reports its measured height so notices sit just above it. */
export function useReportTabBarHeight() {
  return useContext(LiftContext);
}

function useScreenReader(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isScreenReaderEnabled()
      .then((v) => live && setOn(v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener(
      "screenReaderChanged",
      setOn,
    );
    return () => {
      live = false;
      sub.remove();
    };
  }, []);
  return on;
}

/**
 * Notices slide up like circulation slips pushed across the desk. Used for
 * reversible actions instead of "are you sure?" dialogs. Up to three stack,
 * so an earlier Undo stays reachable.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [tabBarHeight, setTabBarHeight] = useState(0);
  const counter = useRef(0);
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const screenReader = useScreenReader();

  const show = useCallback((t: ToastInput) => {
    counter.current += 1;
    const key = counter.current;
    setToasts((list) => pushToast(list, { ...t, key }));
    const extras = [t.undo && "Undo", t.action?.label]
      .filter(Boolean)
      .join(" and ");
    AccessibilityInfo.announceForAccessibility(
      extras ? `${t.message}. ${extras} available.` : t.message,
    );
  }, []);
  const remove = useCallback(
    (key: number) => setToasts((list) => list.filter((x) => x.key !== key)),
    [],
  );
  const reportHeight = useCallback(
    (h: number) => setTabBarHeight((cur) => (Math.abs(cur - h) < 1 ? cur : h)),
    [],
  );

  return (
    <ToastContext.Provider value={show}>
      <LiftContext.Provider value={reportHeight}>
        {children}
        {toasts.length > 0 && (
          <View
            pointerEvents="box-none"
            style={[
              styles.wrap,
              { bottom: toastLift(pathname, tabBarHeight, insets.bottom) },
            ]}
          >
            {toasts.map((t, i) => (
              <Slip
                key={t.key}
                toast={t}
                behind={toasts.length - 1 - i}
                paused={screenReader}
                onGone={remove}
                onUndoFailed={() => show({ message: "Couldn't undo that" })}
              />
            ))}
          </View>
        )}
      </LiftContext.Provider>
    </ToastContext.Provider>
  );
}

function Slip({
  toast,
  behind,
  paused,
  onGone,
  onUndoFailed,
}: {
  toast: Toast;
  /** How many newer notices sit in front of this one. */
  behind: number;
  /** Screen reader on: stay until dismissed. */
  paused: boolean;
  /** Stable across renders, so the timer isn't restarted. */
  onGone: (key: number) => void;
  onUndoFailed: () => void;
}) {
  const p = usePalette();
  const still = useReducedMotion();
  const v = useAnimatedValue(0);
  const [busy, setBusy] = useState(false);

  const hide = useCallback(() => {
    Animated.timing(v, {
      toValue: 0,
      duration: still ? 0 : 180,
      useNativeDriver: true,
    }).start(() => onGone(toast.key));
  }, [v, still, onGone, toast.key]);

  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: still ? 0 : 260,
      easing: Easing.out(Easing.back(1.4)),
      useNativeDriver: true,
    }).start();
  }, [v, still]);

  useEffect(() => {
    if (paused || busy) return;
    const t = setTimeout(hide, SHOW_MS);
    return () => clearTimeout(t);
  }, [hide, paused, busy]);

  const style = useMemo(
    () => ({
      opacity: v,
      transform: [
        {
          translateY: v.interpolate({
            inputRange: [0, 1],
            outputRange: [40, 0],
          }),
        },
        {
          rotate: v.interpolate({
            inputRange: [0, 1],
            outputRange: ["-2deg", behind % 2 ? "0.5deg" : "-0.6deg"],
          }),
        },
        { scale: 1 - Math.min(behind, 2) * 0.03 },
      ],
    }),
    [v, behind],
  );

  return (
    <Animated.View
      pointerEvents="box-none"
      style={style}
      accessibilityLiveRegion="polite"
    >
      <View
        style={[
          styles.slip,
          {
            backgroundColor: p.lampDeep,
            borderColor: p.brassDark,
            shadowColor: p.shadow,
          },
        ]}
      >
        <View style={[styles.perf, { borderColor: p.brass }]} />
        <Text style={[styles.message, { color: p.onLamp }]} numberOfLines={2}>
          {toast.message}
        </Text>
        {toast.action && (
          <SlipButton
            label={toast.action.label}
            color={p.brassLight}
            onPress={() => {
              toast.action?.onPress();
              hide();
            }}
          />
        )}
        {toast.undo && (
          <SlipButton
            label="Undo"
            color={p.brassLight}
            disabled={busy}
            onPress={async () => {
              setBusy(true);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(
                () => {},
              );
              const ok = await runUndo(toast.undo ?? (() => {}));
              hide();
              if (!ok) onUndoFailed();
            }}
          />
        )}
        {paused && (
          <SlipButton
            label="✕"
            accessibilityLabel="Dismiss"
            color={p.brassLight}
            onPress={hide}
            plain
          />
        )}
      </View>
    </Animated.View>
  );
}

function SlipButton({
  label,
  accessibilityLabel,
  color,
  disabled,
  plain,
  onPress,
}: {
  label: string;
  accessibilityLabel?: string;
  color: string;
  disabled?: boolean;
  plain?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      disabled={disabled}
      hitSlop={10}
      onPress={onPress}
      style={plain ? styles.plain : [styles.button, { borderColor: color }]}
    >
      <Text style={[styles.buttonText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 14, right: 14, gap: 8 },
  slip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingLeft: 22,
    paddingRight: 12,
    borderRadius: 2,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  perf: {
    position: "absolute",
    left: 8,
    top: 6,
    bottom: 6,
    borderLeftWidth: 1.5,
    borderStyle: "dashed",
  },
  message: { flex: 1, fontFamily: fonts.typed, fontSize: 15, lineHeight: 20 },
  button: {
    borderWidth: 1.5,
    borderRadius: 3,
    paddingHorizontal: 10,
    paddingVertical: 5,
    transform: [{ rotate: "-3deg" }],
  },
  plain: { paddingHorizontal: 6, paddingVertical: 5 },
  buttonText: {
    fontFamily: fonts.stamp,
    fontSize: 15,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
});
