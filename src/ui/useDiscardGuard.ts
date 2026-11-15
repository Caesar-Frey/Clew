import { usePreventRemove } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert } from 'react-native';

import { goBackOrHome } from '../lib/nav';

/**
 * While `dirty`, swiping the screen away or pressing back asks "Discard this
 * card?" instead of silently losing what was typed. Returns `leave`, which a
 * screen calls after saving to close without being asked.
 */
export function useDiscardGuard(dirty: boolean, title = 'Discard this card?') {
  const [released, setReleased] = useState(false);
  const disable = usePreventRemove(dirty && !released, ({ repeat }) => {
    Alert.alert(title, 'What you typed will be lost.', [
      { text: 'Keep editing', style: 'cancel' },
      {
        text: 'Discard',
        style: 'destructive',
        onPress: () => {
          setReleased(true);
          repeat();
        },
      },
    ]);
  });
  const leave = useCallback(() => {
    disable();
    setReleased(true);
    goBackOrHome();
  }, [disable]);
  return { leave };
}
