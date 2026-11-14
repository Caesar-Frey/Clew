import { CourierPrime_400Regular } from '@expo-google-fonts/courier-prime/400Regular';
import { CourierPrime_700Bold } from '@expo-google-fonts/courier-prime/700Bold';
import { Fraunces_400Regular } from '@expo-google-fonts/fraunces/400Regular';
import { Fraunces_400Regular_Italic } from '@expo-google-fonts/fraunces/400Regular_Italic';
import { Fraunces_600SemiBold } from '@expo-google-fonts/fraunces/600SemiBold';
import { SpecialElite_400Regular } from '@expo-google-fonts/special-elite/400Regular';
import { useFonts } from 'expo-font';
import { Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AssistantProvider } from '@/ai/assistant';
import { DataGate } from '@/components/DataGate';
import { ReminderSync } from '@/components/ReminderSync';
import { sweepPlaintextCaches } from '@/photos/tempFiles';
import { LockGate } from '@/security/lock';
import { DataProvider } from '@/state/data';
import { fonts, usePalette } from '@/ui/theme';
import { ToastProvider } from '@/ui/toast';

SplashScreen.preventAutoHideAsync().catch(() => {});
// Plaintext photo copies left behind if the app was killed mid-capture.
if (Platform.OS !== 'web') sweepPlaintextCaches();
// The drawer fades into the reading room rather than snapping away.
SplashScreen.setOptions({ fade: true, duration: 350 });

/** A cold start straight onto a card (e.g. from a reminder) still has the tabs underneath. */
export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RootLayout() {
  const p = usePalette();
  const [loaded, error] = useFonts({
    Fraunces_400Regular,
    Fraunces_400Regular_Italic,
    Fraunces_600SemiBold,
    CourierPrime_400Regular,
    CourierPrime_700Bold,
    SpecialElite_400Regular,
  });

  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);

  if (!loaded && !error) return null;

  const font = (fontFamily: string) => ({ fontFamily, fontWeight: 'normal' as const });
  return (
    <SafeAreaProvider>
      <ThemeProvider
        value={{
          dark: p.scheme === 'dark',
          colors: { primary: p.scheme === 'dark' ? p.brass : p.leather, background: p.room, card: p.room, text: p.ink, border: p.cardEdge, notification: p.stamp },
          fonts: { regular: font(fonts.serif), medium: font(fonts.serif), bold: font(fonts.display), heavy: font(fonts.display) },
        }}
      >
        <StatusBar style={p.scheme === 'dark' ? 'light' : 'dark'} />
        <LockGate>
          <DataProvider>
            <DataGate>
              <AssistantProvider>
              <ToastProvider>
              <ReminderSync />
              <Stack
                screenOptions={{
                  headerStyle: { backgroundColor: p.room },
                  headerShadowVisible: false,
                  headerTintColor: p.scheme === 'dark' ? p.brass : p.leather,
                  headerTitleStyle: { fontFamily: fonts.display, color: p.ink },
                  headerBackButtonDisplayMode: 'minimal',
                  contentStyle: { backgroundColor: p.room },
                }}
              >
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="add" options={{ presentation: 'modal', title: 'New card' }} />
                <Stack.Screen name="item/[id]" options={{ title: '' }} />
                <Stack.Screen name="place/[id]" options={{ title: '' }} />
                <Stack.Screen name="browse" options={{ title: 'All things' }} />
                <Stack.Screen name="move/[id]" options={{ presentation: 'modal', title: 'Re-shelve' }} />
                <Stack.Screen name="lend/[id]" options={{ presentation: 'modal', title: 'Check out' }} />
                <Stack.Screen name="archive" options={{ presentation: 'modal', title: 'Backup' }} />
                <Stack.Screen name="photo/[id]" options={{ presentation: 'modal', title: 'Photo' }} />
                <Stack.Screen name="identify" options={{ presentation: 'modal', title: 'Which box is this?' }} />
                <Stack.Screen name="seal" options={{ presentation: 'modal', title: 'Seal the catalog' }} />
              </Stack>
              </ToastProvider>
              </AssistantProvider>
            </DataGate>
          </DataProvider>
        </LockGate>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
