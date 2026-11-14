import { router, Stack } from 'expo-router';
import { StyleSheet } from 'react-native';

import { LibraryButton, Room, Stamp, T } from '@/ui/components';
import { usePalette } from '@/ui/theme';

/** A link or notification pointed at something that isn't in the catalog. */
export default function NotFound() {
  const p = usePalette();
  return (
    <Room style={styles.center}>
      <Stack.Screen options={{ title: 'Not found' }} />
      <Stamp text="Not on file" color={p.stamp} animate={false} />
      <T variant="heading" style={{ textAlign: 'center' }} accessibilityRole="header">
        That page isn&apos;t in the catalog
      </T>
      <T variant="small" style={{ textAlign: 'center' }}>
        It may have been deleted, or the link is out of date.
      </T>
      <LibraryButton label="Go to the catalog" tone="lamp" onPress={() => router.replace('/')} />
    </Room>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 },
});
