import { useLocalSearchParams } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { Chip, IconButton } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Field } from '../src/components/Controls';
import { Gutter, Screen } from '../src/components/Screen';
import { EmptyState, SafetyNotice } from '../src/components/States';
import { Body, Caption, Eyebrow, Label } from '../src/components/Text';
import { useInventory } from '../src/hooks/useInventory';
import { useTranslation } from '../src/i18n';
import { ApiError } from '../src/services/api/client';
import { askAssistant, toInventoryPayload } from '../src/services/api/endpoints';
import { usePreferences } from '../src/store/app';
import type { AssistantMessage, FoodStatus } from '../src/types';
import { GUTTER, colors, palette, radius, spacing } from '../src/theme';

/**
 * Ask AI.
 *
 * Grounded on the currently-viewed food and the user's inventory, both sent as
 * context. When no LLM is configured the backend answers from its knowledge
 * base and labels the reply, which this screen surfaces -- so the user always
 * knows whether they got a generated answer or a curated one.
 */

const SUGGESTIONS = [
  'assistant.suggested1',
  'assistant.suggested2',
  'assistant.suggested3',
  'assistant.suggested4',
  'assistant.suggested5',
  'assistant.suggested6',
];

export default function AssistantScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ food?: string; status?: string; score?: string }>();
  const preferences = usePreferences();
  const { candidates } = useInventory();

  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<FlatList<AssistantMessage>>(null);

  const send = useCallback(
    async (text: string) => {
      const question = text.trim();
      if (!question || busy) return;

      const userMessage: AssistantMessage = {
        id: `${Date.now()}-user`,
        role: 'user',
        content: question,
        created_at: new Date().toISOString(),
      };

      // Snapshot the history *before* adding this turn, so the request carries
      // the prior conversation rather than duplicating the new question.
      const history = messages.map((message) => ({
        role: message.role,
        content: message.content,
      }));

      setMessages((prior) => [...prior, userMessage]);
      setDraft('');
      setBusy(true);

      try {
        const response = await askAssistant({
          message: question,
          history,
          context: {
            current_food: params.food ?? null,
            current_status: (params.status as FoodStatus | undefined) ?? null,
            current_score: params.score ? Number(params.score) : null,
            inventory: candidates.slice(0, 12).map((item) =>
              toInventoryPayload({
                id: item.id,
                food_name: item.food_name,
                category: item.category,
                status: item.displayStatus,
                estimated_remaining_days: item.displayRemaining,
                quantity: item.quantity,
                unit: item.unit,
              }),
            ),
            language: preferences.language,
          },
        });

        setMessages((prior) => [
          ...prior,
          {
            id: `${Date.now()}-assistant`,
            role: 'assistant',
            content: response.reply,
            created_at: new Date().toISOString(),
          },
        ]);
      } catch (error) {
        const isApi = error instanceof ApiError;
        setMessages((prior) => [
          ...prior,
          {
            id: `${Date.now()}-error`,
            role: 'assistant',
            content: t(isApi ? error.bodyKey : 'errors.assistantFailed'),
            created_at: new Date().toISOString(),
            error: isApi ? error.code : 'unknown',
          },
        ]);
      } finally {
        setBusy(false);
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
      }
    },
    [busy, candidates, messages, params, preferences.language, t],
  );

  return (
    <Screen
      showBack
      title={t('assistant.title')}
      scroll={false}
      tabBarPadding={false}
      keyboardAware
    >
      {params.food ? (
        <Gutter style={styles.contextWrap}>
          <Caption>{t('assistant.contextLabel', { context: params.food })}</Caption>
        </Gutter>
      ) : null}

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(message) => message.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        renderItem={({ item }) => <Bubble message={item} />}
        ListEmptyComponent={
          <View>
            <EmptyState
              icon="message"
              title={t('assistant.emptyTitle')}
              body={t('assistant.emptyBody')}
            />
            <Gutter>
              <Eyebrow style={styles.suggestionsTitle}>
                {t('assistant.inputPlaceholder')}
              </Eyebrow>
              <View style={styles.suggestions}>
                {SUGGESTIONS.map((key) => (
                  <Chip key={key} label={t(key)} onPress={() => send(t(key))} />
                ))}
              </View>
            </Gutter>
          </View>
        }
        ListFooterComponent={
          busy ? (
            <Gutter>
              <Card tone="sage" style={styles.thinking}>
                <Body>{t('assistant.thinking')}</Body>
              </Card>
            </Gutter>
          ) : null
        }
      />

      <Gutter style={styles.composer}>
        <View style={styles.composerRow}>
          <Field
            label=""
            value={draft}
            onChangeText={setDraft}
            placeholder={t('assistant.inputPlaceholder')}
            style={styles.input}
            multiline
          />
          <IconButton
            icon="send"
            onPress={() => send(draft)}
            accessibilityLabel={t('assistant.send')}
            disabled={busy || draft.trim().length === 0}
            color={colors.textOnPrimary}
            background={colors.primary}
            style={styles.send}
          />
        </View>
        <SafetyNotice text={t('safety.shortNotice')} compact />
      </Gutter>
    </Screen>
  );
}

/** One chat bubble. User turns sit right, assistant turns left. */
function Bubble({ message }: { message: AssistantMessage }) {
  const isUser = message.role === 'user';
  const failed = Boolean(message.error);

  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : null]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
          failed ? styles.bubbleError : null,
        ]}
      >
        <Body
          style={[
            styles.bubbleText,
            isUser ? styles.bubbleTextUser : null,
            failed ? styles.bubbleTextError : null,
          ]}
        >
          {message.content}
        </Body>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  contextWrap: {
    paddingBottom: spacing.sm,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  suggestionsTitle: {
    marginBottom: spacing.md,
  },
  suggestions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  thinking: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.md,
  },
  bubbleRow: {
    paddingHorizontal: GUTTER,
    marginBottom: spacing.md,
    flexDirection: 'row',
  },
  bubbleRowUser: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '86%',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  bubbleAssistant: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderTopLeftRadius: radius.xs,
  },
  bubbleUser: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    borderTopRightRadius: radius.xs,
  },
  bubbleError: {
    backgroundColor: palette.red100,
    borderColor: palette.red500,
  },
  bubbleText: {
    color: colors.textPrimary,
    lineHeight: 22,
  },
  bubbleTextUser: {
    color: colors.textOnPrimary,
  },
  bubbleTextError: {
    color: palette.red600,
  },
  composer: {
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
  },
  send: {
    marginBottom: spacing.xs,
  },
});
