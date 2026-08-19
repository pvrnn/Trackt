import { BlurView } from 'expo-blur';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView, Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';
import { duration, springBack } from '../lib/motion';
import { color, nativeSurface, space } from '../theme/tokens';
import { type } from '../theme/typography';

/**
 * The bottom sheet every write happens in (`Mobile System.dc.html` §05):
 * rating, status, log dates, list add, list edit, profile edit.
 *
 * Built on React Native's own `Modal` rather than a gesture-driven sheet
 * library, and **mounted on demand** (`{showing && <Sheet …/>}`) rather than
 * kept mounted behind an `open` flag: several sheets run a query of their own,
 * and one held `open={false}` on the media screen would fetch the viewer's
 * lists on every title they opened. The surface is solid `#191520`, not glass —
 * the sheet covers content the user was just reading, and a translucent panel
 * over a cover grid is unreadable. Only the backdrop is blurred.
 *
 * Phase 3 accepted two costs for that shape, and phase 4 pays them both back.
 * The **dismiss animation** needs the element to outlive the state that renders
 * it, which is what `useSheetController` is for: `dismiss()` plays the 220ms
 * exit and only then calls the `onClose` that unmounts. And the sheet now
 * **drags** — down past 96pt, or a flick, dismisses; short of it the panel
 * springs back. The grabber is a real handle rather than decoration.
 *
 * Presentation is ours rather than `Modal`'s `animationType="slide"`, because
 * the drag has to hand off to the exit from wherever the finger left the panel;
 * two animations owned by different layers cannot do that.
 */

/** How far down the panel has to travel before releasing dismisses it. */
const DRAG_DISMISS = 96;
/** …or how fast, for a flick that never gets that far. */
const FLICK_VELOCITY = 900;

export interface SheetController {
  /** 0 offscreen, 1 presented. */
  readonly progress: SharedValue<number>;
  /** Live drag offset, in points below the resting position. */
  readonly drag: SharedValue<number>;
  /** Play the exit, then unmount. Idempotent — a double tap dismisses once. */
  readonly dismiss: () => void;
}

/**
 * Owns a sheet's presentation state, in the component that decides whether the
 * sheet exists at all.
 *
 * It lives here rather than inside `<Sheet>` because the sheets close
 * themselves from handlers defined outside their own JSX — `RatingSheet` closes
 * on SAVE, `ConfirmSheet` on confirm — and those handlers need the animated
 * dismiss, not the raw unmount.
 */
export function useSheetController(onClose: () => void): SheetController {
  const progress = useSharedValue(0);
  const drag = useSharedValue(0);
  const closing = useRef(false);

  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    progress.value = withTiming(0, { duration: duration.commit }, (finished) => {
      if (finished) runOnJS(onClose)();
    });
  }, [onClose, progress]);

  return useMemo(() => ({ progress, drag, dismiss }), [progress, drag, dismiss]);
}

export function Sheet({
  title,
  subtitle,
  controller,
  children,
  /** 92% for pickers with a long list; the default 60% suits a short form. */
  tall = false,
}: {
  title: string;
  subtitle?: string | undefined;
  controller: SheetController;
  children: ReactNode;
  tall?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { progress, drag, dismiss } = controller;
  // The panel's own height, so the entrance travels exactly its own distance
  // rather than a guess. Until the first layout it is a screen's worth, which
  // is off the bottom on every device — the wrong direction to be wrong in is
  // *too small*, which would show a strip of the panel on the first frame.
  const panelHeight = useSharedValue(1200);

  useEffect(() => {
    progress.value = withTiming(1, { duration: duration.commit });
  }, [progress]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: progress.value }));

  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - progress.value) * panelHeight.value + drag.value }],
  }));

  // The handle drags; the body does not. A pan that started on a scrolling list
  // has to stay that list's, or a long form becomes impossible to scroll.
  const pan = Gesture.Pan()
    .onUpdate((event) => {
      drag.value = Math.max(0, event.translationY);
    })
    .onEnd((event) => {
      if (drag.value > DRAG_DISMISS || event.velocityY > FLICK_VELOCITY) {
        runOnJS(dismiss)();
      } else {
        drag.value = withSpring(0, springBack);
      }
    });

  const onPanelLayout = (event: LayoutChangeEvent) => {
    panelHeight.value = event.nativeEvent.layout.height;
  };

  return (
    <Modal
      visible
      transparent
      // Ours, not the platform's — see the note above.
      animationType="none"
      statusBarTranslucent
      // Android's back button, and iOS's swipe-down when the OS provides it.
      onRequestClose={dismiss}
    >
      {/* Android renders a `Modal` into its own window, which is outside the
          root view in `app/_layout.tsx`; without a second root here the pan
          detector below never receives a touch. */}
      <GestureHandlerRootView style={styles.root}>
        {/* Tap-to-dismiss, per §05. Labelled rather than left as bare chrome:
            with the sheet up it is the only other thing on screen. */}
        <AnimatedPressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${title}`}
          style={[styles.backdrop, backdropStyle]}
          onPress={dismiss}
        >
          <BlurView intensity={6} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={styles.scrim} />
        </AnimatedPressable>

        <Animated.View
          onLayout={onPanelLayout}
          style={[
            styles.sheet,
            { maxHeight: tall ? '92%' : '60%', paddingBottom: insets.bottom + space.lg },
            panelStyle,
          ]}
        >
          <GestureDetector gesture={pan}>
            <View style={styles.handle}>
              {/* Still hidden from assistive tech: a drag is not something
                  VoiceOver or switch control can perform, and the backdrop
                  button above is the accessible way out. */}
              <View
                accessibilityElementsHidden
                importantForAccessibility="no"
                style={styles.grabber}
              />
              <View style={styles.head}>
                <Text style={[type.section, styles.title]}>{title.toUpperCase()}</Text>
                {subtitle ? (
                  <Text style={[type.bodySm, styles.subtitle]} numberOfLines={2}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
            </View>
          </GestureDetector>
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
        </Animated.View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** The error line a sheet shows when the write came back rejected. */
export function SheetError({ message }: { message: string }) {
  return (
    <Text accessibilityRole="alert" style={[type.bodySm, styles.error]}>
      {message}
    </Text>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: nativeSurface.scrim,
  },
  sheet: {
    backgroundColor: nativeSurface.sheet,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: space.xl,
    paddingTop: 10,
  },
  handle: {
    // The whole title block is the drag target, not just the 4pt grabber —
    // 36 × 4 is a hint, never a hit area.
    paddingBottom: space.xs,
  },
  grabber: {
    width: 36,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  head: {
    gap: space.xs,
    paddingTop: space.lg,
    paddingBottom: space.md,
  },
  title: {
    color: color.fg,
  },
  subtitle: {
    color: color.muted,
  },
  body: {
    gap: space.lg,
    paddingBottom: space.lg,
  },
  error: {
    color: color.pink,
  },
});
