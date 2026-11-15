import { forwardRef, useEffect, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextInputInstance,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useAnimatedValue, useReducedMotion } from './animated';
import { fonts, usePalette, type Palette } from './theme';
import { haptic } from './haptics';

/* ------------------------------------------------------------------ text */

type Variant = 'title' | 'heading' | 'body' | 'italic' | 'typed' | 'label' | 'small';

export function T({ variant = 'body', style, color, ...rest }: TextProps & { variant?: Variant; color?: string }) {
  const p = usePalette();
  return (
    <Text
      accessibilityRole={variant === 'title' ? 'header' : undefined}
      {...rest}
      style={[textStyles[variant], { color: color ?? (variant === 'small' || variant === 'label' ? p.inkSoft : p.ink) }, style]}
    />
  );
}

const textStyles = StyleSheet.create({
  title: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, letterSpacing: -0.4 },
  heading: { fontFamily: fonts.display, fontSize: 21, lineHeight: 27 },
  body: { fontFamily: fonts.serif, fontSize: 16, lineHeight: 23 },
  italic: { fontFamily: fonts.displayItalic, fontSize: 16, lineHeight: 23 },
  typed: { fontFamily: fonts.typed, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: fonts.typedBold, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase' },
  small: { fontFamily: fonts.typed, fontSize: 12, lineHeight: 17 },
});

/* ------------------------------------------------------------------ room */

/** The reading-room backdrop: paper tone with faint wood grain. */
export function Room({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return (
    <View style={[{ flex: 1, backgroundColor: p.room }, style]}>
      <Svg style={StyleSheet.absoluteFill} viewBox="0 0 100 200" preserveAspectRatio="none" pointerEvents="none">
        {GRAIN.map((d, i) => (
          <Path key={i} d={d} stroke={p.grain} strokeWidth={i % 3 === 0 ? 1.4 : 0.6} fill="none" />
        ))}
      </Svg>
      {children}
    </View>
  );
}

const GRAIN = Array.from({ length: 22 }, (_, i) => {
  const y = 6 + i * 9;
  const w = 1.5 + ((i * 7) % 5) * 0.6;
  return `M0 ${y} C 25 ${y - w}, 45 ${y + w}, 60 ${y} S 90 ${y - w * 0.7}, 100 ${y + 0.5}`;
});

/* ------------------------------------------------------------ index card */

interface IndexCardProps extends Omit<PressableProps, 'style' | 'children'> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Show the brass rod hole at the bottom, like a real catalog card. */
  punched?: boolean;
  ruled?: boolean;
  /** Stagger index for the slide-in animation. */
  enterIndex?: number;
}

/**
 * A library catalog card: card stock, red head rule, faint blue ruling and
 * the rod hole. Pressing it lifts it out of the drawer.
 */
export function IndexCard({ children, style, punched = true, ruled = true, enterIndex, onPress, ...rest }: IndexCardProps) {
  const p = usePalette();
  const lift = useAnimatedValue(0);
  const still = useReducedMotion();
  const enter = useAnimatedValue(enterIndex === undefined || still ? 1 : 0);

  useEffect(() => {
    if (enterIndex === undefined) return;
    if (still) {
      enter.setValue(1);
      return;
    }
    Animated.timing(enter, {
      toValue: 1,
      duration: 320,
      delay: Math.min(enterIndex, 10) * 35,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter, enterIndex, still]);

  const press = (to: number) =>
    still ? lift.setValue(0) : Animated.spring(lift, { toValue: to, useNativeDriver: true, speed: 40, bounciness: 6 }).start();

  const body = (
    <Animated.View
      style={[
        styles.card,
        { backgroundColor: p.card, borderColor: p.cardEdge, shadowColor: p.shadow },
        {
          opacity: enter,
          transform: [
            { translateY: Animated.add(Animated.multiply(lift, -3), Animated.multiply(Animated.subtract(1, enter), 18)) },
            { scale: Animated.add(1, Animated.multiply(lift, 0.012)) },
          ],
        },
        style,
      ]}
    >
      {ruled && <View style={[styles.headRule, { backgroundColor: p.headRule }]} />}
      {ruled && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {RULES.map((top) => (
            <View key={top} style={[styles.rule, { top, backgroundColor: p.rule }]} />
          ))}
        </View>
      )}
      {children}
      {punched && <View style={[styles.hole, { backgroundColor: p.room, borderColor: p.cardEdge }]} />}
    </Animated.View>
  );

  if (!onPress) return body;
  return (
    <Pressable {...rest} onPress={onPress} onPressIn={() => press(1)} onPressOut={() => press(0)}>
      {body}
    </Pressable>
  );
}

const RULES = Array.from({ length: 14 }, (_, i) => 46 + i * 22);

/* --------------------------------------------------------------- buttons */

type ButtonTone = 'leather' | 'lamp' | 'brass' | 'ghost';

export function LibraryButton({
  label,
  onPress,
  tone = 'leather',
  icon,
  disabled,
  style,
  compact,
  accessibilityLabel,
  haptic: buzz = true,
}: {
  label: string;
  accessibilityLabel?: string;
  /** False when the action ends with its own success buzz (no double buzz). */
  haptic?: boolean;
  onPress: () => void;
  tone?: ButtonTone;
  icon?: (color: string) => ReactNode;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  compact?: boolean;
}) {
  const p = usePalette();
  const scale = useAnimatedValue(1);
  const still = useReducedMotion();
  const { bg, fg, stitch } = buttonColors(p, tone);
  const spring = (toValue: number, speed: number, bounciness?: number) =>
    still ? undefined : Animated.spring(scale, { toValue, useNativeDriver: true, speed, bounciness }).start();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        if (buzz) haptic.selection().catch(() => {});
        onPress();
      }}
      onPressIn={() => spring(0.96, 50)}
      onPressOut={() => spring(1, 30, 8)}
      style={style}
    >
      <Animated.View
        style={[
          styles.button,
          compact && styles.buttonCompact,
          { backgroundColor: bg, opacity: disabled ? 0.45 : 1, transform: [{ scale }] },
          tone === 'ghost' && { borderWidth: 1, borderColor: p.inkFaint },
        ]}
      >
        {tone !== 'ghost' && <View style={[styles.stitch, { borderColor: stitch }]} pointerEvents="none" />}
        {icon?.(fg)}
        {label ? <Text style={[styles.buttonLabel, compact && { fontSize: 14 }, { color: fg }]}>{label}</Text> : null}
      </Animated.View>
    </Pressable>
  );
}

function buttonColors(p: Palette, tone: ButtonTone) {
  switch (tone) {
    case 'lamp':
      return { bg: p.lamp, fg: p.onLamp, stitch: 'rgba(239,230,207,0.35)' };
    case 'brass':
      return { bg: p.brass, fg: p.scheme === 'dark' ? '#1E150F' : '#2A1F17', stitch: 'rgba(42,31,23,0.3)' };
    case 'ghost':
      return { bg: 'transparent', fg: p.ink, stitch: 'transparent' };
    default:
      return { bg: p.leather, fg: p.onLeather, stitch: 'rgba(226,197,142,0.45)' };
  }
}

/* ----------------------------------------------------------------- spine */

const SPINES = ['#6E2620', '#2E4B3B', '#2D3E5C', '#8F6427', '#55304D', '#3F4E4A'];

export function spineColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return SPINES[h % SPINES.length]!;
}

/**
 * A place shown as a book spine with a paper label: used for quick picks of
 * remembered places.
 */
export function SpineChip({
  label,
  hint,
  onPress,
  selected,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  selected?: boolean;
}) {
  const p = usePalette();
  const pull = useAnimatedValue(selected ? 1 : 0);
  const still = useReducedMotion();
  useEffect(() => {
    if (still) pull.setValue(selected ? 1 : 0);
    else Animated.spring(pull, { toValue: selected ? 1 : 0, useNativeDriver: true, bounciness: 10 }).start();
  }, [pull, selected, still]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}, in ${hint}` : label}
      accessibilityState={{ selected }}
      onPress={() => {
        haptic.selection().catch(() => {});
        onPress();
      }}
    >
      <Animated.View
        style={[
          styles.spine,
          { backgroundColor: spineColor(label), transform: [{ translateY: Animated.multiply(pull, -5) }] },
          selected && { borderColor: p.brassLight, borderWidth: 2 },
        ]}
      >
        <View style={[styles.spineBand, { backgroundColor: p.brass }]} />
        <View style={[styles.spineLabel, { backgroundColor: p.scheme === 'dark' ? '#EADFC8' : '#F8F1DF' }]}>
          <Text numberOfLines={2} style={styles.spineText}>
            {label}
          </Text>
          {hint ? (
            <Text numberOfLines={2} style={styles.spineHint}>
              {hint}
            </Text>
          ) : null}
        </View>
        <View style={[styles.spineBand, { backgroundColor: p.brass }]} />
      </Animated.View>
    </Pressable>
  );
}

/* ----------------------------------------------------------------- stamp */

/**
 * A rubber stamp that thuds onto the card: drops from above, overshoots and
 * settles at a slight angle.
 */
export function Stamp({
  text,
  sub,
  color,
  angle = -7,
  animate = true,
  thud = false,
}: {
  text: string;
  sub?: string;
  color: string;
  angle?: number;
  animate?: boolean;
  /** A heavy buzz as it lands: only for stamps that answer a user action, not decoration. */
  thud?: boolean;
}) {
  const still = useReducedMotion();
  const v = useAnimatedValue(animate && !still ? 0 : 1);
  useEffect(() => {
    if (!animate) return;
    if (still) {
      // Keep the haptic thud, skip the slam-down.
      v.setValue(1);
      if (thud) haptic.impact('heavy').catch(() => {});
      return;
    }
    Animated.sequence([
      Animated.timing(v, { toValue: 0.85, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      Animated.spring(v, { toValue: 1, useNativeDriver: true, speed: 30, bounciness: 14 }),
    ]).start();
    if (!thud) return;
    const t = setTimeout(() => haptic.impact('heavy').catch(() => {}), 140);
    return () => clearTimeout(t);
  }, [animate, v, still, thud]);
  return (
    <Animated.View
      accessibilityLabel={sub ? `${text}, ${sub}` : text}
      style={[
        styles.stamp,
        { borderColor: color },
        {
          opacity: v.interpolate({ inputRange: [0, 0.85, 1], outputRange: [0, 0.9, 0.82] }),
          transform: [
            { rotate: `${angle}deg` },
            { scale: v.interpolate({ inputRange: [0, 0.85, 1], outputRange: [2.2, 0.94, 1] }) },
          ],
        },
      ]}
    >
      <View style={[styles.stampInner, { borderColor: color }]}>
        <Text style={[styles.stampText, { color }]}>{text}</Text>
        {sub ? <Text style={[styles.stampSub, { color }]}>{sub}</Text> : null}
      </View>
    </Animated.View>
  );
}

/* ----------------------------------------------------------------- input */

/**
 * Keeps focused inputs and the buttons under them above the keyboard. Android
 * draws edge-to-edge (SDK 58), so it needs an explicit behaviour too.
 */
export function KeyboardScreen({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <KeyboardAvoidingView style={[{ flex: 1 }, style]} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      {children}
    </KeyboardAvoidingView>
  );
}

export const TypedInput = forwardRef<TextInputInstance, TextInputProps & { label?: string; big?: boolean }>(
  function TypedInput({ label, big, style, ...rest }, ref) {
    const p = usePalette();
    return (
      <View style={{ gap: 4 }}>
        {label ? <T variant="label">{label}</T> : null}
        <TextInput
          ref={ref}
          placeholderTextColor={p.inkFaint}
          selectionColor={p.leather}
          cursorColor={p.leather}
          autoCorrect={false}
          accessibilityLabel={label}
          {...rest}
          style={[
            big ? styles.inputBig : styles.input,
            { color: p.ink, borderBottomColor: p.inkSoft },
            style,
          ]}
        />
      </View>
    );
  },
);

/* ----------------------------------------------------------------- misc */

export function SectionLabel({ children }: { children: string }) {
  const p = usePalette();
  return (
    <View style={styles.sectionRow} accessibilityRole="header">
      <View style={[styles.sectionLine, { backgroundColor: p.inkFaint }]} />
      <T variant="label">{children}</T>
      <View style={[styles.sectionLine, { backgroundColor: p.inkFaint }]} />
    </View>
  );
}

export function BrassPlate({ children }: { children: string }) {
  const p = usePalette();
  return (
    <View style={[styles.plate, { backgroundColor: p.brass, borderColor: p.brassDark }]}>
      <View style={[styles.screw, { backgroundColor: p.brassDark }]} />
      <Text numberOfLines={1} style={[styles.plateText, { color: p.scheme === 'dark' ? '#1E150F' : '#2A1F17' }]}>
        {children}
      </Text>
      <View style={[styles.screw, { backgroundColor: p.brassDark }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 3,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 26,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 4,
    elevation: 2,
  },
  headRule: { position: 'absolute', left: 0, right: 0, top: 40, height: 1.2, opacity: 0.7 },
  rule: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth },
  hole: {
    position: 'absolute',
    bottom: 7,
    alignSelf: 'center',
    left: '50%',
    marginLeft: -6,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
  },
  button: {
    minHeight: 52,
    borderRadius: 6,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  buttonCompact: { minHeight: 44, paddingHorizontal: 14 },
  stitch: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, margin: 4, borderRadius: 4, borderWidth: 1, borderStyle: 'dashed' },
  buttonLabel: { fontFamily: fonts.display, fontSize: 17, letterSpacing: 0.3 },
  spine: {
    width: 100,
    minHeight: 112,
    borderRadius: 3,
    paddingVertical: 10,
    paddingHorizontal: 8,
    justifyContent: 'space-between',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  spineBand: { height: 3, borderRadius: 1, opacity: 0.85 },
  spineLabel: { paddingVertical: 8, paddingHorizontal: 6, borderRadius: 2, gap: 2 },
  spineText: { fontFamily: fonts.display, fontSize: 14, color: '#2A1F17' },
  spineHint: { fontFamily: fonts.typed, fontSize: 10, color: '#6B5843' },
  stamp: { borderWidth: 2.5, borderRadius: 6, padding: 2, alignSelf: 'flex-start' },
  stampInner: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 10, paddingVertical: 4, alignItems: 'center' },
  stampText: { fontFamily: fonts.stamp, fontSize: 18, letterSpacing: 2, textTransform: 'uppercase' },
  stampSub: { fontFamily: fonts.stamp, fontSize: 12, letterSpacing: 1 },
  input: { fontFamily: fonts.typed, fontSize: 17, paddingVertical: 8, borderBottomWidth: 1, outlineWidth: 0 },
  inputBig: { fontFamily: fonts.display, fontSize: 26, paddingVertical: 6, borderBottomWidth: 1, outlineWidth: 0 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 8 },
  sectionLine: { flex: 1, height: StyleSheet.hairlineWidth },
  plate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
    borderWidth: 1,
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  screw: { width: 4, height: 4, borderRadius: 2 },
  plateText: { fontFamily: fonts.typedBold, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', flexShrink: 1 },
});
