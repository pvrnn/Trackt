import { removeAvatar, updateProfile, uploadAvatar } from '@trackt/client';
import { AVATAR_MAX_BYTES, AVATAR_MIME_TYPES, type ProfileUser } from '@trackt/shared';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { commitHaptic, errorHaptic } from '../lib/haptics';
import { space, surface, text } from '../theme/tokens';
import { type } from '../theme/typography';
import { Avatar } from './Avatar';
import { Field } from './Field';
import { PrismButton } from './PrismButton';
import { Sheet, SheetError, useSheetController } from './Sheet';

/** The picked asset in the shape `uploadAvatar` wants (RN has no `File`). */
interface PickedAvatar {
  uri: string;
  name: string;
  type: string;
}

/**
 * What happens to the avatar when the form is saved. Nothing touches the server
 * until SAVE — a picked image is previewed locally, so CANCEL genuinely cancels
 * rather than leaving a photo already uploaded (the bug web's `AvatarChange`
 * exists to prevent, and the same fix).
 */
type AvatarChange = { kind: 'keep' } | { kind: 'replace'; file: PickedAvatar } | { kind: 'remove' };

const AVATAR_SIZE = 88;

/**
 * Edit the viewer's profile: photo, display name, bio (`PATCH /me/profile`,
 * `POST|DELETE /me/avatar`). The username is fixed, as on web.
 *
 * Social links are not here, because the app does not show them anywhere yet —
 * a form that edits fields the reader can't see is a worse gap than the one it
 * closes. `UpdateProfileBody` is a partial, so omitting the key leaves whatever
 * was set on web untouched; that is what makes leaving it out safe rather than
 * destructive.
 */
export function EditProfileSheet({
  user,
  onSaved,
  onClose,
}: {
  user: ProfileUser;
  /** Re-pull the summary and the session (the tab header reads both). */
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const sheet = useSheetController(onClose);
  const [name, setName] = useState(user.name);
  const [bio, setBio] = useState(user.bio ?? '');
  const [avatar, setAvatar] = useState<AvatarChange>({ kind: 'keep' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasPhoto = avatar.kind === 'replace' || (avatar.kind === 'keep' && user.image !== null);

  const pick = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    // The server enforces both of these too; catching them here saves a 2MB
    // upload over a phone connection to be told no at the end of it.
    if (asset.fileSize !== undefined && asset.fileSize > AVATAR_MAX_BYTES) {
      setError('That image is over 2MB — pick a smaller one.');
      return;
    }
    const mime = asset.mimeType ?? 'image/jpeg';
    if (!(AVATAR_MIME_TYPES as readonly string[]).includes(mime)) {
      setError('PNG, JPEG or WebP only.');
      return;
    }
    setError(null);
    setAvatar({
      kind: 'replace',
      file: { uri: asset.uri, name: asset.fileName ?? `avatar.${mime.split('/')[1]}`, type: mime },
    });
  };

  const dropPhoto = () => {
    setError(null);
    // Dropping a just-picked image falls back to the saved one; dropping the
    // saved one marks it for deletion on save.
    setAvatar((current) =>
      current.kind === 'replace' && user.image ? { kind: 'keep' } : { kind: 'remove' },
    );
  };

  const save = async () => {
    if (!name.trim()) {
      setError('Name can’t be empty.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // Fields first, photo second: the upload is the step that actually fails
      // (size, slow connection), and running it first leaves the avatar changed
      // on the server while the sheet still shows an error and a CANCEL.
      await updateProfile({ name: name.trim(), bio: bio.trim() || null });
      if (avatar.kind === 'replace') {
        try {
          await uploadAvatar(avatar.file);
        } catch (cause) {
          throw new Error(
            cause instanceof Error
              ? `Your details saved, but the photo didn’t: ${cause.message}`
              : 'Your details saved, but the photo didn’t upload.',
          );
        }
      } else if (avatar.kind === 'remove' && user.image) {
        await removeAvatar();
      }
      commitHaptic();
      await onSaved();
      sheet.dismiss();
    } catch (cause) {
      errorHaptic();
      setError(cause instanceof Error ? cause.message : 'Saving failed — try again.');
      setSaving(false);
    }
  };

  return (
    <Sheet title="Edit profile" subtitle={`@${user.username}`} controller={sheet} tall>
      <View style={styles.photoRow}>
        {avatar.kind === 'replace' ? (
          // The picked file is a local `file://` uri, which is not an instance
          // path — `<Avatar>` would resolve it to null and draw the gradient.
          <Image
            source={{ uri: avatar.file.uri }}
            style={styles.preview}
            contentFit="cover"
            accessibilityLabel="Selected profile photo"
          />
        ) : (
          <Avatar
            name={user.username}
            image={avatar.kind === 'remove' ? null : user.image}
            size={AVATAR_SIZE}
          />
        )}
        <View style={styles.photoActions}>
          <PrismButton
            label={hasPhoto ? 'Change photo' : 'Upload photo'}
            variant="secondary"
            disabled={saving}
            onPress={() => void pick()}
          />
          {hasPhoto ? (
            <PrismButton
              label={avatar.kind === 'replace' ? 'Discard new photo' : 'Remove photo'}
              variant="secondary"
              disabled={saving}
              onPress={dropPhoto}
            />
          ) : null}
          <Text style={[type.bodySm, text.faint]}>PNG, JPEG or WebP — 2MB max.</Text>
        </View>
      </View>

      <Field label="Display name" value={name} maxLength={80} onChangeText={setName} />
      <Field
        label="Bio"
        value={bio}
        maxLength={280}
        multiline
        numberOfLines={3}
        style={styles.multiline}
        placeholder="Watches too much neo-noir. Reads webtoons on the tram."
        onChangeText={setBio}
      />

      {error ? <SheetError message={error} /> : null}

      <PrismButton label="Save" busy={saving} onPress={() => void save()} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  preview: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: surface.glass,
  },
  photoActions: {
    flex: 1,
    gap: space.sm,
  },
  multiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
});
