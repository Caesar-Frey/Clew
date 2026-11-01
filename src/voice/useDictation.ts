import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

export type DictationState = 'idle' | 'listening';

const LANG = 'en-US';

/**
 * Speech to text that never leaves the phone: recognition is required to run
 * on-device, and voice input is unavailable where the phone can't do that.
 */
export function useDictation(onFinal: (text: string) => void) {
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
    if (e.error === 'language-not-supported' && Platform.OS === 'android') {
      offerAndroidDownload();
      return;
    }
    Alert.alert("Didn't catch that", e.message || 'Try again, or type it instead.');
  });

  const start = useCallback(async (hints: string[] = []) => {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      Alert.alert('Voice input unavailable', 'Speech recognition is turned off or missing on this phone.');
      return;
    }
    if (!ExpoSpeechRecognitionModule.supportsOnDeviceRecognition()) {
      if (Platform.OS === 'android') offerAndroidDownload();
      else Alert.alert('Voice input unavailable', "This phone can't recognise speech offline, and Clew never sends your voice anywhere.");
      return;
    }
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Microphone is off', 'Allow the microphone and speech recognition for Clew in Settings to add things by voice.');
      return;
    }
    delivered.current = false;
    setTranscript('');
    ExpoSpeechRecognitionModule.start({
      lang: LANG,
      interimResults: true,
      requiresOnDeviceRecognition: true,
      addsPunctuation: false,
      continuous: false,
      // Biases recognition toward the user's own places and names.
      contextualStrings: hints.slice(0, 100),
    });
  }, []);

  const stop = useCallback(() => ExpoSpeechRecognitionModule.stop(), []);

  return { state, transcript, start, stop };
}

function offerAndroidDownload() {
  Alert.alert('Download offline speech?', 'Clew only uses speech recognition that runs on the phone. Android can download the English offline model.', [
    { text: 'Not now', style: 'cancel' },
    {
      text: 'Download',
      onPress: () => ExpoSpeechRecognitionModule.androidTriggerOfflineModelDownload({ locale: LANG }).catch(() => {}),
    },
  ]);
}
