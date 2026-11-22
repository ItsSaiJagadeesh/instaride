/* InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * A short review form: stars, quick tags, a written review that the other person can read WITHOUT the writer's name, and an optional
 * private note to the admins. Used by the driver to review the rider. */
import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';
import AppModal, { useAppModal } from '@/components/AppModal';

type Props = {
  title: string; // for example "Rate your rider"
  tags: readonly string[];
  endpoint: string; // the PUT route that stores the review
  reviewLabel: string; // for example "Review for the rider"
  onDone: () => void; // after sending, or after skipping
};

export default function TripReviewForm({ title, tags, endpoint, reviewLabel, onDone }: Props) {
  const { showAlert, modalProps } = useAppModal();
  const [rating, setRating] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (rating === 0) return;
    setBusy(true);
    try {
      await apiRequest('PUT', endpoint, {
        rating,
        tags: picked.length ? picked : undefined,
        peerReview: text.trim() || undefined,
        comment: note.trim() || undefined,
      });
      onDone();
    } catch (e: any) {
      showAlert('Could not send', e.message || 'Please try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <View style={styles.stars}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable key={n} onPress={() => setRating(n)} hitSlop={8} accessibilityLabel={`${n} ${n === 1 ? 'star' : 'stars'}`}>
            <Ionicons name={n <= rating ? 'star' : 'star-outline'} size={38} color={n <= rating ? '#FFB800' : Colors.border} />
          </Pressable>
        ))}
      </View>
      <View style={styles.tagRow}>
        {tags.map((tag) => {
          const on = picked.includes(tag);
          return (
            <Pressable
              key={tag}
              accessibilityLabel={`Tag ${tag}`}
              accessibilityState={{ selected: on }}
              onPress={() => setPicked((p) => (on ? p.filter((x) => x !== tag) : [...p, tag]))}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{tag}</Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        style={styles.input}
        placeholder={`Write a review (optional)`}
        placeholderTextColor={Colors.textLight}
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
        maxLength={300}
        accessibilityLabel={reviewLabel}
      />
      <Text style={styles.note}>
        <Ionicons name="eye-outline" size={11} color={Colors.textLight} /> They will read this review, but will not see your name
      </Text>
      {showNote ? (
        <>
          <TextInput
            style={styles.input}
            placeholder="Private note for the InstaRide team (optional)"
            placeholderTextColor={Colors.textLight}
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            maxLength={500}
            accessibilityLabel="Private note to admins"
          />
          <Text style={styles.note}>
            <Ionicons name="lock-closed" size={11} color={Colors.textLight} /> This note is private and only visible to platform admins
          </Text>
        </>
      ) : (
        <Pressable onPress={() => setShowNote(true)} accessibilityLabel="Add a private note for the InstaRide team" style={{ marginBottom: 12 }}>
          <Text style={styles.link}>Add a private note for the InstaRide team</Text>
        </Pressable>
      )}
      <View style={styles.btnRow}>
        <Pressable onPress={onDone} accessibilityLabel="Skip review" style={({ pressed }) => [styles.skip, pressed && { opacity: 0.7 }]}>
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
        <Pressable
          onPress={send}
          disabled={rating === 0 || busy}
          accessibilityLabel="Submit review"
          style={({ pressed }) => [styles.submit, (rating === 0 || busy) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
        >
          {busy ? <ActivityIndicator size="small" color={Colors.secondary} /> : <Text style={styles.submitText}>Submit review</Text>}
        </Pressable>
      </View>
      <AppModal {...modalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'stretch', paddingBottom: 8 },
  title: { fontSize: 18, fontFamily: 'Inter_700Bold', color: Colors.text, textAlign: 'center', marginBottom: 8 },
  stars: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 12 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  chipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.text },
  chipTextOn: { color: Colors.secondary },
  input: { backgroundColor: Colors.background, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.text, minHeight: 80, marginBottom: 6 },
  note: { fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textLight, textAlign: 'center', marginBottom: 14 },
  link: { fontSize: 12, fontFamily: 'Inter_500Medium', color: Colors.textLight, textAlign: 'center', textDecorationLine: 'underline' },
  btnRow: { flexDirection: 'row', gap: 10 },
  skip: { paddingVertical: 14, paddingHorizontal: 22, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  skipText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textLight },
  submit: { flex: 1, backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.secondary },
});
