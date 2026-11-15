import * as Device from 'expo-device';
import * as Network from 'expo-network';
import type { ReactNode } from 'react';
import { Alert, Platform, StyleSheet, View } from 'react-native';

import { useAssistant } from '@/ai/assistant';
import { formatSize, modelsForMemory, totalBytes, VISION_MODELS, type VisionModel } from '@/ai/models';
import { IndexCard, LibraryButton, T } from '@/ui/components';
import { OwlIcon } from '@/ui/icons';
import { usePalette } from '@/ui/theme';

/**
 * Desk card for the optional on-device assistant: choose a model, watch it
 * download, or remove it.
 */
export function AssistantCard() {
  const p = usePalette();
  const { status, download, cancel, remove } = useAssistant();

  // The browser preview has no confirmation dialogs.
  const ask = Platform.OS === 'web' ? (_t: string, _m: string, buttons: { onPress?: () => void }[]) => buttons[1]?.onPress?.() : Alert.alert;

  const confirmRemove = () =>
    ask('Remove the assistant?', 'The model files are deleted from this phone. Your things and tags stay as they are.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => remove() },
    ]);

  // Only the tiers this phone has the memory to run.
  const offered = modelsForMemory(VISION_MODELS, Device.totalMemory);

  const confirmDownload = async (m: VisionModel) => {
    const net = await Network.getNetworkStateAsync().catch(() => null);
    const cellular = net?.type === Network.NetworkStateType.CELLULAR;
    const size = formatSize(totalBytes(m));
    ask(
      cellular ? `You're on mobile data` : `Download ${m.title}?`,
      cellular
        ? `${m.title} is ${size} and may count against your data plan. Wi-Fi is better if you can wait. Nothing from your catalog is sent: the files only come down.`
        : `${size} from Hugging Face. Nothing from your catalog is sent: the files only come down.`,
      [
        { text: 'Not now', style: 'cancel' },
        { text: cellular ? 'Download anyway' : 'Download', onPress: () => download(m.id) },
      ],
    );
  };

  let body: ReactNode;
  switch (status.state) {
    case 'off':
      body = (
        <View style={{ gap: 12 }}>
          {offered.length === 0 && (
            <T variant="small" color={p.inkSoft}>
              This phone doesn’t have enough memory to run the assistant. Everything else in Clew works without it.
            </T>
          )}
          {offered.map((m) => (
            <View key={m.id} style={[styles.option, { borderTopColor: p.rule }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <T variant="body">
                  {m.title} · {formatSize(totalBytes(m))}
                </T>
                <T variant="small">{m.blurb}</T>
              </View>
              <LibraryButton compact tone="lamp" label="Get" accessibilityLabel={`Download ${m.title}`} onPress={() => confirmDownload(m)} />
            </View>
          ))}
        </View>
      );
      break;
    case 'downloading': {
      const fraction = status.progress?.fraction ?? 0;
      body = (
        <View style={{ gap: 10 }}>
          <View
            style={[styles.track, { backgroundColor: p.rule }]}
            accessibilityRole="progressbar"
            accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
          >
            <View style={[styles.fill, { width: `${Math.max(2, fraction * 100)}%`, backgroundColor: p.lamp }]} />
          </View>
          <T variant="small">
            {status.progress?.phase === 'check' ? 'Checking the files' : `Fetching ${status.model.title}`}… {Math.round(fraction * 100)}% of{' '}
            {formatSize(totalBytes(status.model))}. Keep the app open.
          </T>
          <LibraryButton compact tone="ghost" label="Cancel" onPress={cancel} />
        </View>
      );
      break;
    }
    case 'ready':
      body = (
        <View style={{ gap: 10 }}>
          <T variant="small">
            {status.model.title} is on this phone ({formatSize(totalBytes(status.model))}). Look for “Suggest tags” on new cards, and
            “Might be what you mean” in search.
          </T>
          <LibraryButton compact tone="ghost" label="Remove assistant" onPress={confirmRemove} />
        </View>
      );
      break;
    case 'missing':
      body = (
        <View style={{ gap: 10 }}>
          <T variant="small" color={p.stamp}>
            The phone cleared the model files to free up space.
          </T>
          <View style={styles.buttons}>
            <LibraryButton style={{ flex: 1 }} compact tone="lamp" label="Download again" onPress={() => confirmDownload(status.model)} />
            <LibraryButton style={{ flex: 1 }} compact tone="ghost" label="Turn off" onPress={() => remove()} />
          </View>
        </View>
      );
      break;
    case 'failed':
      body = (
        <View style={{ gap: 10 }}>
          <T variant="small" color={p.stamp} accessibilityLiveRegion="polite">
            {status.error}
          </T>
          <View style={styles.buttons}>
            <LibraryButton style={{ flex: 1 }} compact tone="lamp" label="Try again" onPress={() => download(status.model.id)} />
            <LibraryButton style={{ flex: 1 }} compact tone="ghost" label="Cancel" onPress={cancel} />
          </View>
        </View>
      );
      break;
  }

  return (
    <IndexCard punched={false} ruled={false} style={{ paddingBottom: 16 }}>
      <View style={{ gap: 14 }}>
        <View style={styles.row}>
          <View style={[styles.badge, { backgroundColor: p.lamp }]}>
            <OwlIcon size={22} color={p.brassLight} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="heading">Library assistant</T>
            <T variant="small">
              Optional. An open model that runs on this phone suggests names and tags from a photo, and finds things by description.
            </T>
          </View>
        </View>
        {body}
      </View>
    </IndexCard>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  badge: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  buttons: { flexDirection: 'row', gap: 10 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
});
