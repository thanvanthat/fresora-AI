import { StyleSheet, View } from 'react-native';

import { Button, PrimaryButton, SecondaryButton } from '../../components/Button';
import { Card, Divider } from '../../components/Card';
import { Pill } from '../../components/Badge';
import { Gutter } from '../../components/Screen';
import { SafetyNotice } from '../../components/States';
import { Body, Caption, Eyebrow, Label, Title } from '../../components/Text';
import { useTranslation } from '../../i18n';
import type { RecipeResponseWire } from '../../services/api/endpoints';
import { colors, spacing, statusColors } from '../../theme';

interface RecipeDetailProps {
  recipe: RecipeResponseWire;
  onSave?: () => void;
  onCooked?: () => void;
  onDiscard?: () => void;
  busy?: boolean;
}

/**
 * A full recipe.
 *
 * Ingredients are split into what came from the user's food and what came from
 * the pantry, because the whole point is showing that the expiring items are
 * being used. The "N rescued" badge is the payoff of the feature.
 */
export function RecipeDetail({
  recipe,
  onSave,
  onCooked,
  onDiscard,
  busy = false,
}: RecipeDetailProps) {
  const { t, tPlural } = useTranslation();

  const rescued = recipe.ingredients.filter((ingredient) => ingredient.is_rescued);
  const fromFood = recipe.ingredients.filter(
    (ingredient) => ingredient.inventory_item_id !== null && !ingredient.is_rescued,
  );
  const pantry = recipe.ingredients.filter(
    (ingredient) => ingredient.inventory_item_id === null,
  );

  return (
    <Gutter style={styles.container}>
      <View>
        <Title heading>{recipe.title}</Title>
        {recipe.description ? (
          <Body style={styles.description}>{recipe.description}</Body>
        ) : null}
      </View>

      {/* Times and servings. */}
      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Caption>{t('recipes.prep')}</Caption>
          <Label>{t('recipes.minutes', { count: recipe.prep_minutes })}</Label>
        </View>
        <View style={styles.metaItem}>
          <Caption>{t('recipes.cook')}</Caption>
          <Label>{t('recipes.minutes', { count: recipe.cook_minutes })}</Label>
        </View>
        <View style={styles.metaItem}>
          <Caption>{t('recipes.servings')}</Caption>
          <Label>{recipe.servings}</Label>
        </View>
      </View>

      {/* The rescue payoff. */}
      {rescued.length > 0 ? (
        <Card tone="sage" style={styles.rescuedCard}>
          <Label style={{ color: statusColors.fresh.fg }}>
            ♻️ {tPlural('recipes.rescuedOne', 'recipes.rescued', rescued.length)}
          </Label>
        </Card>
      ) : null}

      {/* Provenance: generated or matched. The user is told which. */}
      <View style={styles.pills}>
        <Pill
          label={recipe.source === 'llm' ? 'AI generated' : 'Built-in matcher'}
          tone={recipe.source === 'llm' ? 'info' : 'neutral'}
          icon={recipe.source === 'llm' ? 'sparkle' : 'box'}
        />
        {recipe.excluded_item_ids.length > 0 ? (
          <Pill label={t('recipes.excludedSpoiled')} tone="warning" icon="alert-triangle" />
        ) : null}
      </View>

      {recipe.note ? <Caption style={styles.note}>{recipe.note}</Caption> : null}

      {/* Ingredients. */}
      <View style={styles.block}>
        <Eyebrow>{t('recipes.ingredients')}</Eyebrow>

        {rescued.length > 0 || fromFood.length > 0 ? (
          <View style={styles.group}>
            <Caption style={styles.groupLabel}>{t('recipes.expiringIngredients')}</Caption>
            {[...rescued, ...fromFood].map((ingredient, index) => (
              <View key={`own-${index}`} style={styles.ingredientRow}>
                <View style={styles.ingredientNameWrap}>
                  {ingredient.is_rescued ? <Body style={styles.marker}>♻️</Body> : null}
                  <Body style={styles.ingredientName}>{ingredient.ingredient_name}</Body>
                </View>
                <Caption>{ingredient.quantity}</Caption>
              </View>
            ))}
          </View>
        ) : null}

        {pantry.length > 0 ? (
          <View style={styles.group}>
            <Caption style={styles.groupLabel}>{t('recipes.pantryIngredients')}</Caption>
            {pantry.map((ingredient, index) => (
              <View key={`pantry-${index}`} style={styles.ingredientRow}>
                <Body style={styles.ingredientName}>{ingredient.ingredient_name}</Body>
                <Caption>{ingredient.quantity}</Caption>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      <Divider />

      {/* Method. */}
      <View style={styles.block}>
        <Eyebrow>{t('recipes.instructions')}</Eyebrow>
        {recipe.instructions.map((step, index) => (
          <View key={index} style={styles.step}>
            <View style={styles.stepNumber}>
              <Caption style={styles.stepNumberText}>{index + 1}</Caption>
            </View>
            <Body style={styles.stepText}>{step}</Body>
          </View>
        ))}
      </View>

      {recipe.tips.length > 0 ? (
        <View style={styles.block}>
          <Eyebrow>{t('recipes.tips')}</Eyebrow>
          {recipe.tips.map((tip, index) => (
            <Body key={index} style={styles.tip}>
              • {tip}
            </Body>
          ))}
        </View>
      ) : null}

      <SafetyNotice text={t('safety.recipeCaution')} compact />

      {/* Actions. */}
      <View style={styles.actions}>
        {onCooked && rescued.length > 0 ? (
          <PrimaryButton
            label={t('recipes.markCooked')}
            icon="check"
            onPress={onCooked}
            loading={busy}
          />
        ) : null}
        {onSave ? (
          <SecondaryButton label={t('recipes.saveRecipe')} icon="plus" onPress={onSave} />
        ) : null}
        {onDiscard ? (
          <Button
            label={t('common.close')}
            variant="ghost"
            onPress={onDiscard}
          />
        ) : null}
      </View>
    </Gutter>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  description: {
    marginTop: spacing.xs,
    lineHeight: 23,
  },
  metaRow: {
    flexDirection: 'row',
    gap: spacing.xxl,
  },
  metaItem: {
    gap: 2,
  },
  rescuedCard: {
    paddingVertical: spacing.md,
  },
  pills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  note: {
    lineHeight: 17,
  },
  block: {
    gap: spacing.sm,
  },
  group: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  groupLabel: {
    color: colors.textSecondary,
    marginBottom: spacing.xxs,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 3,
  },
  ingredientNameWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flex: 1,
  },
  marker: {
    fontSize: 13,
  },
  ingredientName: {
    color: colors.textPrimary,
    flexShrink: 1,
  },
  step: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stepNumberText: {
    color: colors.primary,
    fontWeight: '700',
  },
  stepText: {
    flex: 1,
    lineHeight: 23,
    color: colors.textPrimary,
  },
  tip: {
    lineHeight: 22,
  },
  actions: {
    gap: spacing.md,
    marginTop: spacing.sm,
  },
});
