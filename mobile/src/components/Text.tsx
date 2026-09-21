import type { ReactNode } from 'react';
import { Text as RNText, type StyleProp, type TextStyle } from 'react-native';

import { colors, typography, type TypographyKey } from '../theme';

interface TypeProps {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  color?: string;
  align?: TextStyle['textAlign'];
  numberOfLines?: number;
  /** Screen-reader override when the visible text is not the whole story. */
  accessibilityLabel?: string;
  /** Marks this as a heading for assistive technology. */
  heading?: boolean;
  /** Explicit role, e.g. 'alert' for validation messages. Overrides `heading`. */
  accessibilityRole?: 'text' | 'header' | 'alert' | 'summary';
}

/**
 * Typed text components. Screens never reach for a raw `<Text>` with inline
 * font sizes -- every size and weight in the app comes from the type scale.
 */
function make(variant: TypographyKey, defaultColor: string = colors.textPrimary) {
  return function Typed({
    children,
    style,
    color,
    align,
    numberOfLines,
    accessibilityLabel,
    heading,
    accessibilityRole,
  }: TypeProps) {
    return (
      <RNText
        style={[
          typography[variant] as TextStyle,
          { color: color ?? defaultColor },
          align ? { textAlign: align } : null,
          style,
        ]}
        numberOfLines={numberOfLines}
        accessibilityLabel={accessibilityLabel}
        accessibilityRole={accessibilityRole ?? (heading ? 'header' : undefined)}
        // Cap scaling so a very large system font cannot break the editorial
        // layout, while still honouring the user's accessibility setting.
        maxFontSizeMultiplier={variant === 'score' ? 1.2 : 1.6}
      >
        {children}
      </RNText>
    );
  };
}

export const Hero = make('hero');
export const Display = make('display');
export const Title = make('title');
export const Subtitle = make('subtitle');
export const Score = make('score');
export const ScoreSmall = make('scoreSmall');
export const BodyLg = make('bodyLg', colors.textSecondary);
export const Body = make('body', colors.textSecondary);
export const BodySm = make('bodySm', colors.textSecondary);
export const Label = make('label');
export const LabelSm = make('labelSm');
export const Caption = make('caption', colors.textTertiary);
export const Mono = make('mono', colors.textSecondary);

/**
 * Section eyebrow, e.g. "NEEDS YOUR ATTENTION". Uppercasing happens here so
 * translations are stored in natural case and the visual treatment stays
 * consistent -- and so a script without case (Tamil, Hindi) is unaffected.
 */
export function Eyebrow({ children, style, color, align }: TypeProps) {
  return (
    <RNText
      style={[
        typography.eyebrow as TextStyle,
        { color: color ?? colors.textTertiary, textTransform: 'uppercase' },
        align ? { textAlign: align } : null,
        style,
      ]}
      accessibilityRole="header"
      maxFontSizeMultiplier={1.4}
    >
      {children}
    </RNText>
  );
}
