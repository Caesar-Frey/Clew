import { useLocalSearchParams } from 'expo-router';
import { Alert, Image, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { goBackOrHome } from '@/lib/nav';
import { useFullPhoto } from '@/components/PhotoPlate';
import { jpegUri } from '@/photos/capture';
import { useData } from '@/state/data';
import { LibraryButton, Room } from '@/ui/components';
import { BinIcon } from '@/ui/icons';

/** One photo, as large as the screen allows. */
export default function PhotoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const photo = useFullPhoto(id);
  const { actions } = useData();
  const insets = useSafeAreaInsets();

  const remove = () =>
    Alert.alert('Remove this photo?', undefined, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          goBackOrHome();
          await actions.deletePhoto(id!).catch(() => {});
        },
      },
    ]);

  return (
    <Room style={{ paddingBottom: insets.bottom + 12 }}>
      <View style={styles.frame}>
        {photo && <Image source={{ uri: jpegUri(photo.data) }} style={styles.image} resizeMode="contain" accessibilityLabel="Photo" />}
      </View>
      <View style={{ paddingHorizontal: 18 }}>
        <LibraryButton label="Remove photo" tone="ghost" compact icon={(c) => <BinIcon size={18} color={c} />} onPress={remove} />
      </View>
    </Room>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, padding: 12 },
  image: { flex: 1 },
});
