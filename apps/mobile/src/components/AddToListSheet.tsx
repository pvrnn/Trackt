import { listsApi, useCreateList, useLists, useListsInvalidator } from '@trackt/client';
import { LIST_TITLE_MAX } from '@trackt/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { commitHaptic, errorHaptic } from '../lib/haptics';
import { color, layout, radius, space, stroke, surface, text } from '../theme/tokens';
import { type } from '../theme/typography';
import { Field } from './Field';
import { Icon } from './Icon';
import { Loading } from './Page';
import { PrismButton } from './PrismButton';
import { Sheet, SheetError, useSheetController } from './Sheet';

/**
 * Add or remove a title across the viewer's lists (PRD §3.4).
 *
 * `containsMedia` comes back on each summary, so membership is server-stated
 * rather than inferred — a list edited on another device still shows the truth
 * here. Rows toggle in place and the sheet stays open: adding one title to
 * three lists is the common case, and a sheet that closed on each tap would
 * cost three re-opens.
 */
export function AddToListSheet({
  mediaId,
  mediaTitle,
  onClose,
}: {
  mediaId: string;
  mediaTitle: string;
  onClose: () => void;
}) {
  const sheet = useSheetController(onClose);
  const { data: lists, isPending, isError } = useLists(mediaId);
  const createList = useCreateList();
  const invalidate = useListsInvalidator();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');

  const toggle = async (listId: string, contains: boolean) => {
    setPending(listId);
    setError(null);
    try {
      if (contains) await listsApi.removeItem(listId, mediaId);
      else await listsApi.addItem(listId, mediaId);
      commitHaptic();
      invalidate(listId);
    } catch (cause) {
      errorHaptic();
      setError(cause instanceof Error ? cause.message : 'That didn’t save — try again.');
    } finally {
      setPending(null);
    }
  };

  const createAndAdd = () => {
    const title = newTitle.trim();
    if (!title) return;
    setError(null);
    createList.mutate(
      { title, description: null, isRanked: false, visibility: 'public' },
      {
        onSuccess: async (created) => {
          setNewTitle('');
          await toggle(created.id, false);
        },
        onError: (cause) => setError(cause.message || 'That didn’t save — try again.'),
      },
    );
  };

  return (
    <Sheet title="Add to list" subtitle={mediaTitle} controller={sheet} tall>
      {isError ? (
        <SheetError message="Couldn’t load your lists — try again in a moment." />
      ) : isPending ? (
        <Loading />
      ) : lists.length === 0 ? (
        <Text style={[type.body, text.muted]}>
          No lists yet — name one below and this title goes straight into it.
        </Text>
      ) : (
        <View style={styles.rows}>
          {lists.map((entry) => {
            const contains = entry.containsMedia === true;
            return (
              <Pressable
                key={entry.id}
                accessibilityRole="button"
                accessibilityState={{ selected: contains, busy: pending === entry.id }}
                disabled={pending !== null}
                onPress={() => void toggle(entry.id, contains)}
                android_ripple={{ color: 'rgba(217,107,176,0.12)' }}
                style={({ pressed }) => [
                  styles.row,
                  contains ? styles.rowSelected : null,
                  { opacity: pending !== null && pending !== entry.id ? 0.4 : pressed ? 0.7 : 1 },
                ]}
              >
                <View style={styles.rowText}>
                  <Text style={[type.cardTitle, text.fg]} numberOfLines={1}>
                    {entry.title}
                  </Text>
                  <Text style={[type.eyebrow, text.dim]}>
                    {entry.itemCount} {entry.itemCount === 1 ? 'TITLE' : 'TITLES'}
                  </Text>
                </View>
                <View style={styles.action}>
                  {pending === entry.id ? null : (
                    <Icon
                      name={contains ? 'check' : 'plus'}
                      color={contains ? color.pink : color.dim}
                      size={16}
                    />
                  )}
                  <Text style={[type.button, contains ? text.pink : text.dim]}>
                    {pending === entry.id ? '…' : contains ? 'ADDED' : 'ADD'}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.create}>
        <Field
          label="New list"
          value={newTitle}
          maxLength={LIST_TITLE_MAX}
          placeholder="Name a new list"
          returnKeyType="done"
          onChangeText={setNewTitle}
          onSubmitEditing={createAndAdd}
        />
        <PrismButton
          label="Create & add"
          variant="secondary"
          busy={createList.isPending}
          disabled={newTitle.trim().length === 0}
          onPress={createAndAdd}
        />
      </View>

      {error ? <SheetError message={error} /> : null}

      <PrismButton label="Done" onPress={sheet.dismiss} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  rows: {
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    minHeight: layout.touchTarget + 8,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.cover,
    borderWidth: stroke,
    borderColor: surface.glassBorder,
    backgroundColor: surface.glass,
  },
  rowSelected: {
    borderColor: color.pink,
    backgroundColor: surface.pinkSelected,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  rowText: {
    flex: 1,
    gap: space.xs,
  },
  create: {
    gap: space.md,
  },
});
