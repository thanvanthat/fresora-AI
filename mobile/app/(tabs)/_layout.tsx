import { Tabs } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../src/components/Icon';
import { useTranslation } from '../../src/i18n';
import { colors, radius, shadows, spacing } from '../../src/theme';

/**
 * The five-tab bar.
 *
 * SCAN sits in the middle and is rendered as a raised circular button rather
 * than a flat icon, because it is the app's single most important action and
 * everything else flows from it (rule 8).
 */

/**
 * Bar height excluding the system inset.
 *
 * 72 leaves 56pt of content once the 8pt paddings are taken off, which fits a
 * 22pt icon above an 11pt label with room to spare at larger font scales.
 */
const TAB_BAR_CONTENT_HEIGHT = 72;

/** The raised centre action. */
function ScanTabIcon({ focused }: { focused: boolean }) {
  return (
    <View style={[styles.scanButton, focused ? styles.scanButtonFocused : null]}>
      <Icon name="scan" size={25} color={colors.textOnPrimary} />
    </View>
  );
}

export default function TabsLayout() {
  const { t } = useTranslation();
  // Android runs edge-to-edge (app.json), so the system gesture bar overlaps
  // the bottom of the screen. The bar grows by whatever the system reserves
  // rather than letting the labels slide underneath it.
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textTertiary,
        tabBarStyle: [
          styles.bar,
          {
            height: TAB_BAR_CONTENT_HEIGHT + insets.bottom,
            paddingBottom: insets.bottom + spacing.sm,
          },
        ],
        tabBarItemStyle: styles.item,
        tabBarLabelStyle: styles.label,
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color }) => <Icon name="home" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="inventory"
        options={{
          title: t('tabs.inventory'),
          tabBarIcon: ({ color }) => <Icon name="inventory" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="scan"
        options={{
          title: t('tabs.scan'),
          // The raised button carries its own visual weight; a label beneath it
          // would crowd the bar. The accessibility label keeps it announced.
          tabBarLabel: () => null,
          tabBarIcon: ({ focused }) => <ScanTabIcon focused={focused} />,
          tabBarAccessibilityLabel: t('tabs.scan'),
        }}
      />
      <Tabs.Screen
        name="recipes"
        options={{
          title: t('tabs.recipes'),
          tabBarIcon: ({ color }) => <Icon name="recipes" size={22} color={color} />,
        }}
      />
      <Tabs.Screen
        name="you"
        options={{
          title: t('tabs.you'),
          tabBarIcon: ({ color }) => <Icon name="you" size={22} color={color} />,
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    paddingTop: spacing.sm,
  },
  item: {
    paddingVertical: 2,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
  },
  scanButton: {
    width: 54,
    height: 54,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    // Lifts the button above the bar without changing the bar's height.
    marginTop: -18,
    borderWidth: 4,
    borderColor: colors.surface,
    ...shadows.md,
  },
  scanButtonFocused: {
    backgroundColor: colors.primaryDark,
  },
});
