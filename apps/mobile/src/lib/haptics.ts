import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { getMail } from '@/mail/store';

export type Feedback = 'selection' | 'impact' | 'success' | 'error';
let lastFeedback = 0;

/** Feedback never blocks an action or fails it on unsupported devices. */
export function haptic(kind: Feedback = 'selection') {
  if (Platform.OS === 'web' || getMail().settings.haptics === false) return;
  const now = Date.now();
  if (now - lastFeedback < 75) return;
  lastFeedback = now;
  const feedback = Platform.OS === 'android'
    ? Haptics.performAndroidHapticsAsync(kind === 'success' ? Haptics.AndroidHaptics.Confirm : kind === 'error' ? Haptics.AndroidHaptics.Reject : kind === 'impact' ? Haptics.AndroidHaptics.Long_Press : Haptics.AndroidHaptics.Segment_Tick)
    : kind === 'selection' ? Haptics.selectionAsync()
    : kind === 'impact' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    : Haptics.notificationAsync(kind === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
  void feedback.catch(() => undefined);
}

