/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). InstaDriver onboarding: upload photos, wait for review. */
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import AppModal, { useAppModal } from '@/components/AppModal';
import { pickPhotoBase64, uploadDocument, submitVerification } from '@/lib/doc-upload';
import { VEHICLE_LABELS } from '@/lib/format';
import { DOCUMENT_KINDS } from '@shared/schema';
import type { DocumentKind, User } from '@shared/schema';

const ITEMS: Record<DocumentKind, { title: string; hint: string }> = {
  vehicle_front: { title: 'Front of vehicle', hint: 'Whole vehicle from the front' },
  vehicle_back: { title: 'Back of vehicle', hint: 'Whole vehicle from behind' },
  vehicle_left: { title: 'Left side', hint: 'Whole vehicle, left side' },
  vehicle_right: { title: 'Right side', hint: 'Whole vehicle, right side' },
  plate: { title: 'Number plate', hint: 'Close-up. Must be a yellow plate and clearly readable' },
  rc: { title: 'RC (registration certificate)', hint: 'Both the number and owner name must be readable' },
  licence: { title: 'Driving licence', hint: 'Front side, photo and number visible' },
  insurance: { title: 'Insurance', hint: 'Policy page with the validity dates' },
  selfie: { title: 'Selfie with vehicle number', hint: 'Your face and the number plate in the same photo' },
};

interface Props {
  user: User;
  onUserChange: () => void;
  onLogout: () => void;
}

export default function DriverVerification({ user, onUserChange, onLogout }: Props) {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;
  const { showAlert, modalProps } = useAppModal();
  const [busyKind, setBusyKind] = useState<DocumentKind | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const v = user.verification;
  const status = v?.status ?? 'not_submitted';
  const uploaded = new Set(v?.uploaded ?? []);
  const fixKinds = new Set(v?.fixKinds ?? []);
  const editable = status === 'not_submitted' || status === 'needs_fix';
  const allDone = DOCUMENT_KINDS.every((k) => uploaded.has(k)) && fixKinds.size === 0;

  // While waiting for review, check for the decision every 15 seconds.
  useEffect(() => {
    if (status !== 'pending') return;
    const t = setInterval(onUserChange, 15000);
    return () => clearInterval(t);
  }, [status]);

  const upload = async (kind: DocumentKind) => {
    setBusyKind(kind);
    try {
      const b64 = await pickPhotoBase64();
      if (!b64) return;
      await uploadDocument(kind, b64);
      onUserChange();
    } catch (e: any) {
      showAlert('Upload failed', e.message || 'Please try again');
    } finally {
      setBusyKind(null);
    }
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      await submitVerification();
      onUserChange();
    } catch (e: any) {
      showAlert('Cannot submit yet', e.message || 'Please try again');
    } finally {
      setSubmitting(false);
    }
  };

  const banner =
    status === 'pending'
      ? { color: Colors.warning, icon: 'time', title: 'Under review', text: 'We are checking your vehicle on the government VAHAN site. You can go online once approved.' }
      : status === 'needs_fix'
        ? { color: Colors.warning, icon: 'alert-circle', title: 'Please fix and re-upload', text: v?.rejectionReason || 'Some photos need to be taken again.' }
        : status === 'rejected'
          ? { color: Colors.error, icon: 'close-circle', title: 'Application not approved', text: v?.rejectionReason || 'Please contact support.' }
          : { color: Colors.primary, icon: 'camera', title: 'Verify your vehicle', text: 'Upload all 9 photos below. We check them by hand before you can take rides.' };

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: bottomInset + 32 }} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.hello}>Hi {user.fullName.split(' ')[0]}</Text>
            <Text style={styles.vehicle}>
              {user.vehicle ? `${VEHICLE_LABELS[user.vehicle.type]} · ${user.vehicle.number}` : ''}
            </Text>
          </View>
          <Pressable onPress={onLogout} style={styles.logout}>
            <Ionicons name="log-out-outline" size={22} color={Colors.textLight} />
          </Pressable>
        </View>

        <View style={[styles.banner, { borderColor: banner.color }]}>
          <Ionicons name={banner.icon as any} size={22} color={banner.color} />
          <View style={{ flex: 1 }}>
            <Text style={styles.bannerTitle}>{banner.title}</Text>
            <Text style={styles.bannerText}>{banner.text}</Text>
          </View>
        </View>

        {status !== 'rejected' &&
          DOCUMENT_KINDS.map((kind) => {
            const done = uploaded.has(kind);
            const needsFix = fixKinds.has(kind);
            return (
              <View key={kind} style={[styles.item, needsFix && styles.itemFix]}>
                <Ionicons
                  name={done ? 'checkmark-circle' : needsFix ? 'alert-circle' : 'ellipse-outline'}
                  size={24}
                  color={done ? Colors.success : needsFix ? Colors.warning : Colors.textLight}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle}>{ITEMS[kind].title}</Text>
                  <Text style={styles.itemHint}>{ITEMS[kind].hint}</Text>
                </View>
                {editable && (!done || needsFix || status === 'not_submitted') && (
                  <Pressable
                    style={styles.itemBtn}
                    onPress={() => upload(kind)}
                    disabled={busyKind !== null}
                  >
                    {busyKind === kind ? (
                      <ActivityIndicator size="small" color={Colors.secondary} />
                    ) : (
                      <Text style={styles.itemBtnText}>{done ? 'Retake' : 'Take photo'}</Text>
                    )}
                  </Pressable>
                )}
              </View>
            );
          })}

        {editable && (
          <Pressable
            style={[styles.submit, (!allDone || submitting) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={!allDone || submitting}
          >
            {submitting ? (
              <ActivityIndicator color={Colors.secondary} />
            ) : (
              <Text style={styles.submitText}>Submit for review</Text>
            )}
          </Pressable>
        )}
      </ScrollView>
      <AppModal {...modalProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.backgroundDark },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  hello: { fontSize: 24, fontFamily: 'Inter_700Bold', color: Colors.textWhite },
  vehicle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.textLight, marginTop: 2 },
  logout: { padding: 8 },
  banner: {
    flexDirection: 'row', gap: 12, padding: 16, borderRadius: 16, borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.05)', marginBottom: 20,
  },
  bannerTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.textWhite },
  bannerText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.textLight, marginTop: 4, lineHeight: 20 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 10,
  },
  itemFix: { borderWidth: 1, borderColor: Colors.warning },
  itemTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.textWhite },
  itemHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textLight, marginTop: 2 },
  itemBtn: { backgroundColor: Colors.primary, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10, minWidth: 92, alignItems: 'center' },
  itemBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.secondary },
  submit: { backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 12 },
  submitText: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: Colors.secondary },
});
