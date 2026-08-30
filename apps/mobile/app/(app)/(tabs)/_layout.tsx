import { BlurView } from 'expo-blur';
import { TabList, TabSlot, TabTrigger, Tabs } from 'expo-router/ui';
import type { TabTriggerSlotProps } from 'expo-router/ui';
import { forwardRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Ref } from 'react';
import type { View as RNView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TabIcon, type TabName } from '../../../src/components/TabIcon';
import { color, layout, space, stroke, surface } from '../../../src/theme/tokens';
import { type } from '../../../src/theme/typography';

/**
 * The four-tab spine: HOME · DISCOVER · NEWS · PROFILE (`Mobile System.dc.html`
 * §03). Four, not the six the web nav carries and the mobile plan's phase-2
 * table listed — four 90pt targets clear the 44pt minimum with room for a
 * mis-tap, and a fifth squeezes the labels below 10px. **Lists and History are
 * destinations inside Profile**; both are weekly, not daily.
 *
 * Headless `expo-router/ui` tabs rather than the drop-in `Tabs` navigator: the
 * bar is glass over the aura with a gradient-free active state (a pink glyph, a
 * pink label and an 18×2 rule), which is not a tint the navigator's options can
 * express.
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs>
      <TabSlot />
      {/* Absolute, not in the flow: the aura is painted per screen behind it, and
          each screen pads its own scroll content past the bar (useTabContentInset). */}
      {/* `StyleSheet.flatten`, not an array: `TabList asChild` renders a Radix
          Slot, which merges its own style into the child's and throws in
          development if that child's style is an array it cannot merge into. */}
      <TabList asChild>
        <View
          style={StyleSheet.flatten([
            styles.bar,
            { paddingBottom: insets.bottom, height: layout.tabBarHeight + insets.bottom },
          ])}
        >
          <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
          <View style={[StyleSheet.absoluteFill, styles.barFill]} />
          <TabTrigger name="home" href="/home" asChild>
            <TabButton icon="home" label="Home" />
          </TabTrigger>
          <TabTrigger name="discover" href="/discover" asChild>
            <TabButton icon="discover" label="Discover" />
          </TabTrigger>
          <TabTrigger name="news" href="/news" asChild>
            <TabButton icon="news" label="News" />
          </TabTrigger>
          <TabTrigger name="profile" href="/profile" asChild>
            <TabButton icon="profile" label="Profile" />
          </TabTrigger>
        </View>
      </TabList>
    </Tabs>
  );
}

const TabButton = forwardRef(function TabButton(
  {
    icon,
    label,
    isFocused,
    style: _slotStyle,
    ...props
  }: TabTriggerSlotProps & { icon: TabName; label: string },
  ref: Ref<RNView>,
) {
  const tint = isFocused ? color.pink : color.dim;
  return (
    <Pressable
      ref={ref}
      accessibilityRole="tab"
      accessibilityState={{ selected: !!isFocused }}
      accessibilityLabel={label}
      // `style` is dropped from `props` and the spread goes first, both
      // deliberately: `TabTrigger asChild` hands this component its own
      // `flexDirection: 'row'` as a plain `style` prop, and spreading it after
      // ours replaced the whole tab layout — glyph beside label, no `flex: 1`.
      {...props}
      style={({ pressed }) => [styles.tab, { opacity: pressed ? 0.7 : 1 }]}
    >
      <TabIcon name={icon} color={tint} />
      <Text style={[type.tabLabel, { color: tint }]}>{label.toUpperCase()}</Text>
      <View style={[styles.rule, isFocused && styles.ruleActive]} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    paddingTop: space.sm,
    borderTopWidth: stroke,
    borderTopColor: surface.glassBorderStrong,
  },
  barFill: {
    // 82% ink, per the spec — the blur alone washes the near-black grey.
    backgroundColor: 'rgba(14,12,16,0.82)',
  },
  tab: {
    flex: 1,
    // Stated, not defaulted: `TabTrigger asChild` merges the trigger's own
    // `flexDirection: 'row'` into this style, which would otherwise put each
    // glyph beside its label instead of above it.
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: space.xs,
    minHeight: layout.touchTarget,
  },
  rule: {
    width: 18,
    height: 2,
    borderRadius: 2,
    backgroundColor: 'transparent',
  },
  ruleActive: {
    backgroundColor: color.pink,
  },
});
