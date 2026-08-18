import { Pressable } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { PRESS_SCALE, duration, springPress } from '../lib/motion';

/** `Pressable` with an animated style prop — the base every pressed control uses. */
export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/**
 * The press feedback every tappable surface in the app shares (`Mobile
 * System.dc.html` §06 and §07): the platform opacity dip, and a 140ms spring
 * down to 0.96 under the finger.
 *
 * It replaces `Pressable`'s `({ pressed }) => …` style function rather than
 * sitting beside it. The two cannot coexist: `pressed` re-renders on every
 * touch, which is precisely the work the spring exists to move off the JS
 * thread, and a component doing both would dip twice.
 *
 * Under **reduce motion** the scale is dropped and only the opacity remains.
 * That is not a degradation — the opacity dip is the platform's own feedback,
 * and it is what the setting asks to be left with (PRD §6).
 */
export function usePressMotion() {
  const pressed = useSharedValue(0);
  const reduced = useReducedMotion();

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - pressed.value * 0.3,
    transform: reduced ? [] : [{ scale: 1 - pressed.value * (1 - PRESS_SCALE) }],
  }));

  return {
    animatedStyle,
    onPressIn: () => {
      pressed.value = reduced
        ? withTiming(1, { duration: duration.micro })
        : withSpring(1, springPress);
    },
    onPressOut: () => {
      pressed.value = reduced
        ? withTiming(0, { duration: duration.micro })
        : withSpring(0, springPress);
    },
  };
}

/** The pink ripple Android draws over the dip, borderless where the target is round. */
export function ripple(borderless = false) {
  return { color: 'rgba(217,107,176,0.12)', borderless };
}
