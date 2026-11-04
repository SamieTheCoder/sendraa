import { forwardRef, type ComponentRef } from 'react';
import { Pressable, type PressableProps } from 'react-native';
import { haptic, type Feedback } from '@/lib/haptics';

export const HapticPressable = forwardRef<ComponentRef<typeof Pressable>, PressableProps & { feedback?:Feedback|false }>(function HapticPressable({onPress,onLongPress,disabled,feedback='selection',...props},ref) {
  return <Pressable {...props} ref={ref} disabled={disabled}
    onPress={onPress ? (event)=>{if(!disabled&&feedback)haptic(feedback);onPress(event);} : undefined}
    onLongPress={onLongPress ? (event)=>{if(!disabled&&feedback)haptic('impact');onLongPress(event);} : undefined}
  />;
});
