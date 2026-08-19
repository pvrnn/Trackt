import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';
import { color, layout, nativeSurface, radius, space, surface } from '../theme/tokens';
import { type } from '../theme/typography';

/**
 * The undo toast (`Mobile System.dc.html` §04).
 *
 * It exists because of one rule: a check-in commits instantly and is **never**
 * confirmed by a dialog, "because the cost of a wrong check-in is one tap". The
 * toast is what makes that safe — it carries the undo, for five seconds, and
 * dismissing it is not confirmation of anything. It also carries the failures,
 * so a rejected write says so somewhere the user is already looking rather than
 * in a banner on a screen they have scrolled past.
 *
 * One toast at a time: a second `show()` replaces the first and restarts the
 * timer. A queue would mean an undo whose window opened after the thing it
 * undoes had scrolled out of memory.
 */

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastOptions {
  message: string;
  action?: ToastAction;
  /** Tints the pill pink and skips the 5s auto-dismiss for a beat longer. */
  tone?: 'neutral' | 'error';
}

type ShowToast = (options: ToastOptions) => void;

const ToastContext = createContext<ShowToast | null>(null);

const DISMISS_MS = 5_000;
const ERROR_DISMISS_MS = 7_000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastOptions & { id: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const show = useCallback<ShowToast>(
    (options) => {
      clearTimer();
      setToast({ ...options, id: Date.now() });
      timer.current = setTimeout(
        () => setToast(null),
        options.tone === 'error' ? ERROR_DISMISS_MS : DISMISS_MS,
      );
    },
    [clearTimer],
  );

  useEffect(() => clearTimer, [clearTimer]);

  const insets = useSafeAreaInsets();

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <View
          // 12pt above the tab bar (§04). The provider wraps the whole
          // navigator and cannot know whether the screen under it has one, so
          // the offset is unconditional: over a pushed screen the pill simply
          // floats a bar's height higher, which reads as intentional, whereas a
          // pill *under* the glass bar does not.
          style={[styles.wrap, { bottom: insets.bottom + layout.tabBarHeight + space.md }]}
          pointerEvents="box-none"
        >
          <View style={[styles.pill, toast.tone === 'error' ? styles.pillError : null]}>
            <Text style={[type.bodySm, styles.message]} numberOfLines={2}>
              {toast.message}
            </Text>
            {toast.action ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  clearTimer();
                  setToast(null);
                  toast.action?.onPress();
                }}
                style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Text style={[type.button, styles.actionText]}>
                  {toast.action.label.toUpperCase()}
                </Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

/**
 * Show a toast. Throws outside the provider rather than degrading to a no-op:
 * a silently swallowed undo is the failure mode this whole file exists to
 * prevent.
 */
export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) throw new Error('useToast() outside <ToastProvider>');
  return show;
}

/**
 * The toast a failed write shows, in one place so every call site words it the
 * same way. `error.message` is `@trackt/client`'s — already the server's
 * problem string where there was one.
 */
export function useWriteFailedToast() {
  const show = useToast();
  return useMemo(
    () =>
      (cause: unknown, fallback = 'That didn’t save — try again.') =>
        show({
          message: cause instanceof Error && cause.message ? cause.message : fallback,
          tone: 'error',
        }),
    [show],
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: layout.gutter,
    right: layout.gutter,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorderStrong,
    backgroundColor: nativeSurface.sheet,
  },
  pillError: {
    borderColor: color.pink,
  },
  message: {
    flex: 1,
    color: color.fg,
  },
  action: {
    minHeight: layout.touchTarget,
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  actionText: {
    color: color.pink,
  },
});
