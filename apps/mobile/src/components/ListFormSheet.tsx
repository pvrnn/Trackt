import { listsApi, useCreateList, useListsInvalidator } from '@trackt/client';
import {
  LIST_DESCRIPTION_MAX,
  LIST_TITLE_MAX,
  VISIBILITIES,
  type ListSummary,
  type Visibility,
} from '@trackt/shared';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { commitHaptic, errorHaptic } from '../lib/haptics';
import { color, layout, radius, space, surface } from '../theme/tokens';
import { type } from '../theme/typography';
import { Chip } from './Chip';
import { Field } from './Field';
import { PrismButton } from './PrismButton';
import { Sheet, SheetError } from './Sheet';

/** Human copy for each visibility, as web's new-list dialog words it. */
const VISIBILITY_HELP: Record<Visibility, string> = {
  public: 'Anyone with the link can see this list.',
  followers: 'Friends only — visible to accepted friends.',
  private: 'Only you can see this list.',
};

/**
 * Create a list, or edit the one you are looking at (`POST /lists`,
 * `PATCH /lists/:id`).
 *
 * One component for both because the fields are the same four and the only
 * difference is which call the button makes. Editing is the half web does not
 * have yet: `listsApi.update` has existed since the lists endpoint landed, and
 * on a phone "rename this" is the more likely of the two things you want from
 * a list you already made.
 *
 * `UpdateListBody` is deliberately not `CreateListBody.partial()` server-side —
 * an omitted `visibility` would default a private list back to public — so the
 * edit path sends all four fields, every one of them from a control the user
 * can see.
 */
export function ListFormSheet({
  list,
  onSaved,
  onClose,
}: {
  /** Absent creates; present edits that list. */
  list?: ListSummary | undefined;
  /** Handed the saved summary — the create path navigates to it. */
  onSaved?: ((saved: ListSummary) => void) | undefined;
  onClose: () => void;
}) {
  const createList = useCreateList();
  const invalidate = useListsInvalidator();
  const [title, setTitle] = useState(list?.title ?? '');
  const [description, setDescription] = useState(list?.description ?? '');
  const [isRanked, setIsRanked] = useState(list?.isRanked ?? false);
  const [visibility, setVisibility] = useState<Visibility>(list?.visibility ?? 'public');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setError('A list needs a name.');
      return;
    }
    const body = {
      title: trimmed,
      description: description.trim() || null,
      isRanked,
      visibility,
    };
    setError(null);
    setSaving(true);
    try {
      const saved = list
        ? await listsApi.update(list.id, body)
        : await createList.mutateAsync(body);
      commitHaptic();
      invalidate(saved.id);
      onSaved?.(saved);
      onClose();
    } catch (cause) {
      errorHaptic();
      setError(cause instanceof Error ? cause.message : 'That didn’t save — try again.');
      setSaving(false);
    }
  };

  return (
    <Sheet title={list ? 'Edit list' : 'New list'} onClose={onClose} tall>
      <Field
        label="Title"
        value={title}
        maxLength={LIST_TITLE_MAX}
        placeholder="Best webtoons, ranked"
        onChangeText={setTitle}
      />
      <Field
        label="Description"
        value={description}
        maxLength={LIST_DESCRIPTION_MAX}
        placeholder="What ties these together?"
        multiline
        numberOfLines={3}
        style={styles.multiline}
        onChangeText={setDescription}
      />

      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: isRanked }}
        accessibilityLabel="Ranked — order matters, and I can reorder it"
        onPress={() => setIsRanked((current) => !current)}
        style={({ pressed }) => [styles.toggle, { opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={[styles.box, isRanked ? styles.boxOn : null]}>
          {isRanked ? <Text style={[type.button, styles.pink]}>✓</Text> : null}
        </View>
        <Text style={[type.body, styles.fg]}>Ranked — order matters, and I can reorder it</Text>
      </Pressable>

      <View style={styles.visibility}>
        <Text style={[type.eyebrow, styles.dim]}>VISIBILITY</Text>
        <View style={styles.chips}>
          {VISIBILITIES.map((value) => (
            <Chip
              key={value}
              label={value}
              selected={visibility === value}
              onPress={() => setVisibility(value)}
            />
          ))}
        </View>
        <Text style={[type.bodySm, styles.faint]}>{VISIBILITY_HELP[visibility]}</Text>
      </View>

      {error ? <SheetError message={error} /> : null}

      <PrismButton
        label={list ? 'Save changes' : 'Create list'}
        busy={saving}
        disabled={title.trim().length === 0}
        onPress={() => void submit()}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  multiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: layout.touchTarget,
  },
  box: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.thumb,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: surface.glassBorderStrong,
    backgroundColor: surface.glass,
  },
  boxOn: {
    borderColor: color.pink,
    backgroundColor: surface.pinkSelected,
  },
  visibility: {
    gap: space.sm,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
  },
  fg: {
    flex: 1,
    color: color.fg,
  },
  dim: {
    color: color.dim,
  },
  faint: {
    color: color.faint,
  },
  pink: {
    color: color.pink,
  },
});
