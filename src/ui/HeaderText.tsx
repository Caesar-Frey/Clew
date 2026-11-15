import { Pressable, StyleSheet } from 'react-native';

import { T } from './components';
import { fonts, usePalette } from './theme';

/** A plain-word header button ("Cancel", "Save", "Edit"). */
export function HeaderText({
  label,
  bold,
  accessibilityLabel,
  onPress,
}: {
  label: string;
  bold?: boolean;
  accessibilityLabel?: string;
  onPress: () => void;
}) {
  const p = usePalette();
  const color = p.scheme === 'dark' ? p.brass : p.leatherText;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? label} onPress={onPress} hitSlop={10} style={styles.button}>
      <T variant="typed" color={color} style={bold ? { fontFamily: fonts.typedBold } : undefined}>
        {label}
      </T>
    </Pressable>
  );
}

const styles = StyleSheet.create({ button: { minHeight: 44, minWidth: 44, justifyContent: 'center', paddingHorizontal: 4 } });
