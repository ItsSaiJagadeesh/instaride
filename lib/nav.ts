/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). Navigation helpers. */
import { router } from 'expo-router';

/** After logging out or deleting an account: clear the screen history, then show the welcome screen,
 *  so the back button can never return to a signed-in screen. */
export function goToWelcome() {
  try {
    router.dismissAll();
  } catch {
    // already at the first screen
  }
  router.replace('/');
}
