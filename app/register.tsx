import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ScrollView, Platform, ActivityIndicator } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import AppModal, { useAppModal } from '@/components/AppModal';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';
import { APP_VARIANT } from '@/lib/variant';
import type { VehicleType } from '@shared/schema';

const VEHICLE_LABELS: Record<VehicleType, string> = {
  bike: 'Bike',
  auto: 'Auto',
  erickshaw: 'E-rickshaw',
  car: 'Car',
};

export default function RegisterScreen() {
  const { role } = useLocalSearchParams<{ role: string }>();
  const insets = useSafeAreaInsets();
  const { register } = useAuth();
  const userRole = (APP_VARIANT === 'all' ? (role === 'driver' ? 'driver' : 'rider') : APP_VARIANT) as 'rider' | 'driver';
  const isDriver = userRole === 'driver';

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('bike');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [enabledTypes, setEnabledTypes] = useState<VehicleType[]>(['bike']);
  const [fee, setFee] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const { showAlert, modalProps } = useAppModal();

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  useEffect(() => {
    if (!isDriver) return;
    (async () => {
      try {
        const res = await apiRequest('GET', '/api/config/public');
        const cfg = await res.json();
        if (Array.isArray(cfg.enabledVehicleTypes) && cfg.enabledVehicleTypes.length) {
          setEnabledTypes(cfg.enabledVehicleTypes);
          setVehicleType(cfg.enabledVehicleTypes[0]);
        }
        if (typeof cfg.platformFeePerRide === 'number') setFee(cfg.platformFeePerRide);
      } catch {}
    })();
  }, [isDriver]);

  const handleRegister = async () => {
    if (!fullName.trim() || !phone.trim() || !password) {
      showAlert('Missing Fields', 'Please fill in your name, mobile number and password');
      return;
    }
    if (password.length < 8) {
      showAlert('Weak Password', 'Use at least 8 characters');
      return;
    }
    if (isDriver && !vehicleNumber.trim()) {
      showAlert('Missing Vehicle Number', 'Enter your vehicle registration number, e.g. AP37AB1234');
      return;
    }

    setLoading(true);
    try {
      const data: Parameters<typeof register>[0] = {
        fullName: fullName.trim(),
        phone: phone.trim(),
        password,
        role: userRole,
      };
      if (isDriver) {
        data.vehicle = {
          type: vehicleType,
          number: vehicleNumber.trim(),
          make: make.trim() || undefined,
          model: model.trim() || undefined,
        };
      }
      const user = await register(data);
      if (user.role === 'rider') router.replace('/rider');
      else if (user.role === 'driver') router.replace('/driver');
    } catch (e: any) {
      showAlert('Registration Failed', e.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <Pressable style={styles.backBtn} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={24} color={Colors.textWhite} />
      </Pressable>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomInset + 24 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <Text style={styles.title}>{isDriver ? 'Become an InstaDriver' : 'Create InstaRider account'}</Text>
          <Text style={styles.subtitle}>
            {isDriver
              ? fee !== null
                ? `Pay a flat ₹${fee} per completed ride. No commission on fares.`
                : 'Register to start earning'
              : 'Book a ride in a few taps'}
          </Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.sectionLabel}>Personal Info</Text>
          <InputField icon="person-outline" placeholder="Full name" value={fullName} onChangeText={setFullName} />
          <InputField icon="call-outline" placeholder="Mobile number (10 digits)" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <InputField icon="lock-closed-outline" placeholder="Password (8+ characters)" value={password} onChangeText={setPassword} secure />

          {isDriver && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>Vehicle</Text>
              <View style={pillStyles.row}>
                {enabledTypes.map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setVehicleType(t)}
                    style={[pillStyles.pill, vehicleType === t && pillStyles.pillActive]}
                  >
                    <Text style={[pillStyles.pillText, vehicleType === t && pillStyles.pillTextActive]}>
                      {VEHICLE_LABELS[t]}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <InputField icon="document-text-outline" placeholder="Vehicle number, e.g. AP37AB1234" value={vehicleNumber} onChangeText={setVehicleNumber} autoCapitalize="characters" />
              <InputField icon="car-outline" placeholder="Make (optional)" value={make} onChangeText={setMake} />
              <InputField icon="speedometer-outline" placeholder="Model (optional)" value={model} onChangeText={setModel} />
              <Text style={pillStyles.note}>
                After signing up you will upload photos of your vehicle and documents. We check them by hand
                before you can take rides. Only yellow number plates are accepted.
              </Text>
            </>
          )}

          <Pressable
            style={({ pressed }) => [styles.registerBtn, pressed && styles.btnPressed, loading && styles.btnDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={Colors.secondary} size="small" />
            ) : (
              <Text style={styles.registerBtnText}>Create Account</Text>
            )}
          </Pressable>
        </View>
      </ScrollView>
      <AppModal {...modalProps} />
    </View>
  );
}

const pillStyles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  pill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  pillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  pillText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textWhite },
  pillTextActive: { color: Colors.secondary },
  note: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textLight, lineHeight: 19, marginTop: 4 },
});

function InputField({
  icon, placeholder, value, onChangeText, secure, keyboardType, autoCapitalize
}: {
  icon: string; placeholder: string; value: string; onChangeText: (t: string) => void;
  secure?: boolean; keyboardType?: any; autoCapitalize?: any;
}) {
  return (
    <View style={ifStyles.group}>
      <Ionicons name={icon as any} size={18} color={Colors.textLight} style={ifStyles.icon} />
      <TextInput
        style={ifStyles.input}
        placeholder={placeholder}
        placeholderTextColor={Colors.textLight}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
      />
    </View>
  );
}

const ifStyles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 16,
    height: 50,
  },
  icon: { marginRight: 12 },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.textWhite,
    height: '100%',
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.backgroundDark,
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
    marginTop: 8,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 28,
    paddingTop: 12,
  },
  header: {
    marginBottom: 28,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: Colors.textWhite,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textLight,
  },
  form: {
    gap: 12,
  },
  sectionLabel: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
  },
  registerBtn: {
    backgroundColor: Colors.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 12,
  },
  registerBtnText: {
    fontSize: 17,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.secondary,
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  btnDisabled: {
    opacity: 0.6,
  },
});
