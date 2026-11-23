/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Full-screen From / To place search.
 *   - Two independent fields, each with a search icon and a clear (x) button. Editing one never changes the other.
 *   - Suggestions appear directly under the active field while the rider types (debounced, 3+ letters).
 *   - GPS is only a suggestion: "Use current location" is one row, never forced.
 *   - Loading, "no results" and error (with retry) states are always shown. Nothing fails silently.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, Modal, ActivityIndicator, StyleSheet, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import {
  suggestPlaces, resolveSuggestion, newSearchSession, type LatLng, type Place, type Suggestion,
} from '@/lib/places';

export type SearchField = 'from' | 'to';

export interface RecentPlace { lat: number; lng: number; address: string }

interface Props {
  visible: boolean;
  /** Which field is active when the sheet opens. */
  initialField: SearchField;
  /** Text to show in each field when the sheet opens. */
  fromText: string;
  toText: string;
  /** The rider's position (used to rank nearby places first). Null when GPS is off or denied. */
  near: LatLng | null;
  /** Shown in the From field after the rider taps "Use current location". */
  currentLabel: string;
  recents: RecentPlace[];
  onPick: (field: SearchField, place: Place) => void;
  /** Resolves true when GPS gave a position, false when it is off or not allowed. */
  onUseCurrentLocation: () => Promise<boolean>;
  onChooseOnMap: () => void;
  onClose: () => void;
}

const MIN_CHARS = 3;
const DEBOUNCE_MS = 350;

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'results'; items: Suggestion[] }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

export default function PlaceSearchSheet({
  visible, initialField, fromText, toText, near, currentLabel, recents, onPick, onUseCurrentLocation, onChooseOnMap, onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState<SearchField>(initialField);
  const [from, setFrom] = useState(fromText);
  const [to, setTo] = useState(toText);
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const fromRef = useRef<TextInput>(null);
  const toRef = useRef<TextInput>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestId = useRef(0); // answers that arrive after a newer search started are ignored
  const session = useRef(newSearchSession());

  // Reset every time the sheet opens, so each field starts from what the screen currently holds.
  useEffect(() => {
    if (!visible) return;
    setActive(initialField);
    setFrom(fromText);
    setTo(toText);
    setState({ kind: 'idle' });
    setResolvingKey(null);
    session.current = newSearchSession();
    const t = setTimeout(() => (initialField === 'from' ? fromRef : toRef).current?.focus(), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const runSearch = useCallback(async (text: string) => {
    const q = text.trim();
    const id = ++requestId.current;
    if (q.length < MIN_CHARS) { setState({ kind: 'idle' }); return; }
    setState({ kind: 'loading' });
    try {
      const items = await suggestPlaces(q, near, session.current);
      if (id !== requestId.current) return;
      setState(items.length ? { kind: 'results', items } : { kind: 'empty' });
    } catch (e: any) {
      if (id !== requestId.current) return;
      setState({ kind: 'error', message: e?.message || 'Search is unavailable. Check your connection and try again.' });
    }
  }, [near]);

  const onType = (field: SearchField, text: string) => {
    if (field === 'from') setFrom(text); else setTo(text);
    setActive(field);
    if (timer.current) clearTimeout(timer.current);
    if (text.trim().length < MIN_CHARS) { requestId.current++; setState({ kind: 'idle' }); return; }
    setState({ kind: 'loading' });
    timer.current = setTimeout(() => runSearch(text), DEBOUNCE_MS);
  };

  const clearField = (field: SearchField) => {
    if (timer.current) clearTimeout(timer.current);
    requestId.current++;
    if (field === 'from') setFrom(''); else setTo('');
    setActive(field);
    setState({ kind: 'idle' });
    (field === 'from' ? fromRef : toRef).current?.focus();
  };

  // The search icon: focuses its field, and searches right away if there is already enough text.
  const tapSearchIcon = (field: SearchField) => {
    setActive(field);
    (field === 'from' ? fromRef : toRef).current?.focus();
    const text = field === 'from' ? from : to;
    if (timer.current) clearTimeout(timer.current);
    runSearch(text);
  };

  const pick = async (s: Suggestion) => {
    const key = s.placeId || `${s.lat},${s.lng},${s.label}`;
    setResolvingKey(key);
    try {
      const place = await resolveSuggestion(s, session.current);
      session.current = newSearchSession(); // the pick ends this billing session
      if (active === 'from') {
        setFrom(place.label);
        onPick('from', place);
        setState({ kind: 'idle' });
        setTimeout(() => toRef.current?.focus(), 50); // after pickup, go straight to destination
        setActive('to');
      } else {
        setTo(place.label);
        onPick('to', place);
      }
    } catch (e: any) {
      setState({ kind: 'error', message: e?.message || 'Could not open that place. Please pick another.' });
    } finally {
      setResolvingKey(null);
    }
  };

  const useGps = async () => {
    setResolvingKey('gps');
    try {
      const ok = await onUseCurrentLocation();
      if (ok) {
        setFrom(currentLabel);
        setActive('to');
        setState({ kind: 'idle' });
        setTimeout(() => toRef.current?.focus(), 50);
      } else {
        setState({ kind: 'error', message: 'Could not get your location. Turn on location for InstaRide, or search for a place instead.' });
      }
    } finally {
      setResolvingKey(null);
    }
  };

  const pickRecent = (r: RecentPlace) => {
    const place: Place = { label: r.address, address: r.address, lat: r.lat, lng: r.lng };
    if (active === 'from') {
      setFrom(place.label);
      onPick('from', place);
      setActive('to');
      setTimeout(() => toRef.current?.focus(), 50);
    } else {
      setTo(place.label);
      onPick('to', place);
    }
  };

  const activeText = active === 'from' ? from : to;
  // Quick options (current location, map, recents) show whenever no search is running or showing.
  const showQuickRows = state.kind === 'idle';

  const renderField = (field: SearchField) => {
    const isFrom = field === 'from';
    const value = isFrom ? from : to;
    const isActive = active === field;
    return (
      <View style={[styles.field, isActive && styles.fieldActive]}>
        <View style={[styles.dot, { backgroundColor: isFrom ? Colors.primary : Colors.accent }]} />
        <TextInput
          ref={isFrom ? fromRef : toRef}
          testID={isFrom ? 'search-from-input' : 'search-to-input'}
          style={styles.input}
          value={value}
          onChangeText={(t) => onType(field, t)}
          onFocus={() => setActive(field)}
          placeholder={isFrom ? 'Choose pickup location' : 'Search destination'}
          placeholderTextColor={Colors.textLight}
          returnKeyType="search"
          onSubmitEditing={() => runSearch(value)}
          selectTextOnFocus
          autoCorrect={false}
        />
        {value.length > 0 && (
          <Pressable
            testID={isFrom ? 'search-from-clear' : 'search-to-clear'}
            onPress={() => clearField(field)}
            hitSlop={8}
            accessibilityLabel={isFrom ? 'Clear pickup' : 'Clear destination'}
            style={styles.iconBtn}
          >
            <Ionicons name="close-circle" size={20} color={Colors.textLight} />
          </Pressable>
        )}
        <Pressable
          testID={isFrom ? 'search-from-icon' : 'search-to-icon'}
          onPress={() => tapSearchIcon(field)}
          hitSlop={8}
          accessibilityLabel={isFrom ? 'Search pickup' : 'Search destination'}
          style={styles.iconBtn}
        >
          <Ionicons name="search" size={20} color={isActive ? Colors.primaryDark : Colors.textLight} />
        </Pressable>
      </View>
    );
  };

  const header = (
    <View>
      {showQuickRows && (
        <View style={styles.quickBlock}>
          {active === 'from' ? (
            <Pressable
              testID="use-current-location"
              style={styles.row}
              onPress={useGps}
              disabled={resolvingKey !== null}
              accessibilityLabel="Use current location"
            >
              <Ionicons name="navigate" size={18} color={Colors.primary} style={styles.rowIcon} />
              <Text style={styles.primary}>Use current location</Text>
              {resolvingKey === 'gps' && <ActivityIndicator size="small" color={Colors.primary} style={{ marginLeft: 10 }} />}
            </Pressable>
          ) : (
            <Pressable testID="choose-on-map" style={styles.row} onPress={onChooseOnMap} accessibilityLabel="Choose destination on map">
              <Ionicons name="map-outline" size={18} color={Colors.primary} style={styles.rowIcon} />
              <Text style={styles.primary}>Choose on map</Text>
            </Pressable>
          )}
          {recents.length > 0 && <Text style={styles.sectionTitle}>Recent</Text>}
          {recents.slice(0, 5).map((r, i) => (
            <Pressable key={`recent-${i}`} testID={`recent-${i}`} style={styles.row} onPress={() => pickRecent(r)}>
              <Ionicons name="time-outline" size={18} color={Colors.textLight} style={styles.rowIcon} />
              <Text style={styles.primary} numberOfLines={1}>{r.address}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {!showQuickRows && state.kind === 'loading' && (
        <View style={styles.status} testID="search-loading">
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.statusText}>Searching…</Text>
        </View>
      )}
      {!showQuickRows && state.kind === 'empty' && (
        <View style={styles.status} testID="search-empty">
          <Ionicons name="search-outline" size={18} color={Colors.textLight} />
          <Text style={styles.statusText}>No places found. Try a nearby landmark or a different spelling.</Text>
        </View>
      )}
      {state.kind === 'error' && (
        <View style={styles.errorBox} testID="search-error">
          <Ionicons name="alert-circle-outline" size={18} color={Colors.error} />
          <Text style={[styles.statusText, { color: Colors.error, flex: 1 }]}>{state.message}</Text>
          <Pressable onPress={() => runSearch(activeText)} hitSlop={8} accessibilityLabel="Try again">
            <Text style={styles.retry}>Retry</Text>
          </Pressable>
        </View>
      )}
    </View>
  );

  const items = !showQuickRows && state.kind === 'results' ? state.items : [];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.topBar}>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Close search" testID="search-close" style={styles.back}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </Pressable>
          <Text style={styles.title}>Where are you going?</Text>
        </View>

        <View style={styles.fields}>
          {renderField('from')}
          {renderField('to')}
        </View>

        <FlatList
          data={items}
          keyExtractor={(s, i) => s.placeId || `${s.lat},${s.lng},${i}`}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListHeaderComponent={header}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          renderItem={({ item, index }) => {
            const key = item.placeId || `${item.lat},${item.lng},${item.label}`;
            const busy = resolvingKey === key;
            return (
              <Pressable
                testID={`suggestion-${index}`}
                style={({ pressed }) => [styles.row, styles.suggestionRow, pressed && { backgroundColor: Colors.background }]}
                onPress={() => pick(item)}
                disabled={resolvingKey !== null}
              >
                <Ionicons name="location-outline" size={18} color={Colors.primary} style={styles.rowIcon} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.primary} numberOfLines={1}>{item.label}</Text>
                  <Text style={styles.secondary} numberOfLines={2}>{item.address}</Text>
                </View>
                {busy && <ActivityIndicator size="small" color={Colors.primary} />}
              </Pressable>
            );
          }}
        />
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.surface },
  topBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 12 },
  back: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: Colors.text },
  fields: { paddingHorizontal: 16, gap: 10, paddingBottom: 8 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.background, borderRadius: 14,
    paddingHorizontal: 14, minHeight: 52, borderWidth: 1.5, borderColor: 'transparent',
  },
  fieldActive: { borderColor: Colors.primary, backgroundColor: Colors.surface },
  dot: { width: 10, height: 10, borderRadius: 5 },
  input: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: Colors.text, paddingVertical: 10 },
  iconBtn: { width: 28, height: 28, justifyContent: 'center', alignItems: 'center' },
  quickBlock: { paddingTop: 4 },
  sectionTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: Colors.textLight, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, minHeight: 52 },
  suggestionRow: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  rowIcon: { marginRight: 12 },
  primary: { fontSize: 15, fontFamily: 'Inter_500Medium', color: Colors.text, flexShrink: 1 },
  secondary: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textLight, marginTop: 2 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingVertical: 16 },
  statusText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.textLight, flexShrink: 1 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 8, padding: 12, borderRadius: 12, backgroundColor: '#FFF1F0' },
  retry: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.primaryDark },
});
