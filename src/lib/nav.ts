import { router } from 'expo-router';

/**
 * Back if there is somewhere to go back to; otherwise (opened from a
 * notification or a link, or the stack was reset) to the catalog.
 */
export function goBackOrHome(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
