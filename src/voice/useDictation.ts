import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { useData } from '../state/data';

import { deviceSpeechLocale, hasOfflineLocale } from './locale';

export type DictationState = 'idle' | 'listening';

/** The user agreed that speech may be processed by Apple or Google on this phone. */
export const VOICE_SERVER_OK_KEY = 'device.voiceServerOk';

/**
 * Whether this phone can recognise `locale` without sending audio anywhere.
 * iOS reports this for the phone's own language (which is what we use);
 * Android lists its installed offline languages (Android 13+ only, so older
 * versions count as "not guaranteed").
 */
async function canRecogniseOffline(locale: string): Promise<boolean> {
  if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) return false;
  if (Platform.OS !== 'android') return true;
  try {
    const { installedLocales } = await ExpoSpeechRecognitionModule.getSupportedLocales({});
    return hasOfflineLocale(locale, installedLocales);
  } catch {
    return false;
  }
}

function askServerOk(locale: string): Promise<boolean> {
  const who = Platform.OS === 'ios' ? 'Apple' : 'Google';
  return new Promise((resolve) => {
    Alert.alert(
      'Speech leaves the phone here',
      `On this phone, speech is processed by ${who}. Clew sends only what you say into the microphone, nothing from your catalog. Use it anyway?`,
      [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        ...(Platform.OS === 'android'
          ? [
              {
                text: 'Get offline speech',
                onPress: () => {
                  ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale }).catch(() => {});
                  resolve(false);
                },
              },
            ]
          : []),
        { text: 'Use it anyway', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * Speech to text in the phone's language. Recognition runs on the phone
 * where it can; where it can't, the user is told once and decides.
 */
export function useDictation(onFinal: (text: string) => void) {
  const { settings, actions } = useData();
  const serverOk = settings[VOICE_SERVER_OK_KEY] === '1';
  const [state, setState] = useState<DictationState>('idle');
  const [transcript, setTranscript] = useState('');
  const final = useRef(onFinal);
  useEffect(() => {
    final.current = onFinal;
  });
  const delivered = useRef(false);

  useSpeechRecognitionEvent('start', () => setState('listening'));
  useSpeechRecognitionEvent('end', () => setState('idle'));
  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results[0]?.transcript ?? '';
    setTranscript(text);
    if (e.isFinal && text.trim() && !delivered.current) {
      delivered.current = true;
      final.current(text.trim());
    }
  });
  useSpeechRecognitionEvent('error', (e) => {
    setState('idle');
    if (e.error === 'aborted' || e.error === 'no-speech' || e.error === 'speech-timeout') return;
    if (e.error === 'not-allowed') {
      Alert.alert('Microphone is off', 'Allow the microphone and speech recognition for Clew in Settings to add things by voice.');
      return;
    }
    if (e.error === 'language-not-supported') {
      Alert.alert('Voice input unavailable', "This phone can't recognise speech in its current language.");
      return;
    }
    Alert.alert("Didn't catch that", e.message || 'Try again, or type it instead.');
  });

  const start = useCallback(async (hints: string[] = []) => {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      Alert.alert('Voice input unavailable', 'Speech recognition is turned off or missing on this phone.');
      return;
    }
    const lang = deviceSpeechLocale();
    const offline = await canRecogniseOffline(lang);
    if (!offline && !serverOk) {
      if (!(await askServerOk(lang))) return;
      await actions.setSetting(VOICE_SERVER_OK_KEY, '1');
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Microphone is off', 'Allow the microphone and speech recognition for Clew in Settings to add things by voice.');
      return;
    }
    delivered.current = false;
    setTranscript('');
    ExpoSpeechRecognitionModule.start({
      lang,
      interimResults: true,
      requiresOnDeviceRecognition: offline,
      addsPunctuation: false,
      continuous: false,
      // Biases recognition toward the user's own places and names.
      contextualStrings: hints.slice(0, 100),
    });
  }, [serverOk, actions]);

  const stop = useCallback(() => ExpoSpeechRecognitionModule.stop(), []);

  return { state, transcript, start, stop };
}
