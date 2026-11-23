/* InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Sign in or sign up with a one-time code. Three steps: phone number, code, and (new accounts only) details. */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen, Field, PrimaryButton, Card } from '@/components/ui';
import { useAuth } from '@/lib/auth-context';
import { apiRequest } from '@/lib/query-client';
import { APP_VARIANT } from '@/lib/variant';
import { DEMO_MODE, DEMO_PHONE, DEMO_CODE } from '@/lib/demo';
import { VEHICLE_LABELS } from '@/lib/format';
import Colors from '@/constants/colors';
import type { VehicleType } from '@shared/schema';

type Step = 'phone' | 'code' | 'details';

export default function AuthScreen() {
  const params = useLocalSearchParams<{ role?: string; mode?: string }>();
  const role: 'rider' | 'driver' = APP_VARIANT === 'all' ? (params.role === 'driver' ? 'driver' : 'rider') : APP_VARIANT;
  const mode = params.mode === 'signup' ? 'signup' : 'signin';
  const { requestOtp, verifyOtp, signup } = useAuth();

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState(DEMO_MODE ? DEMO_PHONE : '');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('bike');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [enabledTypes, setEnabledTypes] = useState<VehicleType[]>(['bike']);
  const [signupToken, setSignupToken] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [countdown, setCountdown] = useState(0); // Firebase resend countdown
  const [appCooldown, setAppCooldown] = useState(0); // App-level 5-minute cooldown
  const [otpAttempts, setOtpAttempts] = useState(0); // App-level OTP send attempts (max 3)
  const verifying = useRef(false);
  const otpAttemptsRef = useRef<Record<string, number>>({}); // Track attempts per phone number

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  // App-level 5-minute cooldown (after 3 OTP attempts)
  useEffect(() => {
    if (appCooldown <= 0) return;
    const t = setTimeout(() => setAppCooldown(appCooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [appCooldown]);

  useEffect(() => {
    if (role !== 'driver') return;
    (async () => {
      try {
        const cfg = await (await apiRequest('GET', '/api/config/public')).json();
        if (Array.isArray(cfg.enabledVehicleTypes) && cfg.enabledVehicleTypes.length) {
          setEnabledTypes(cfg.enabledVehicleTypes);
          setVehicleType(cfg.enabledVehicleTypes[0]);
        }
      } catch {}
    })();
  }, [role]);

  const goHome = () => router.replace(role === 'driver' ? '/driver' : '/rider');
  const digits = phone.replace(/\D/g, '');
  const phoneOk = digits.length >= 10;

  const sendCode = async () => {
    setError(null);
    
    // Check app-level cooldown (5 minutes = 300 seconds after 3 attempts)
    if (appCooldown > 0) {
      const minutes = Math.ceil(appCooldown / 60);
      setError(`Too many attempts. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`);
      return;
    }

    // Track OTP send attempts per phone number
    const phoneKey = phone.replace(/\D/g, '');
    const attempts = (otpAttemptsRef.current[phoneKey] || 0) + 1;
    otpAttemptsRef.current[phoneKey] = attempts;
    setOtpAttempts(attempts);

    // Max 3 OTP attempts, then 5-minute app-level cooldown
    if (attempts > 3) {
      setError('Maximum OTP attempts reached. Please wait 5 minutes before trying again.');
      setAppCooldown(300); // 5 minutes
      return;
    }

    setLoading(true);
    try {
      const out = await requestOtp(phone.trim());
      setCountdown(out.resendAfterSeconds || 30);
      setCode('');
      setStep('code');
    } catch (e: any) {
      // If Firebase returns auth/too-many-requests, inform user to wait
      if (e.message?.includes('too-many-requests') || e.message?.includes('Too many')) {
        setError('Firebase rate limit reached. Please wait a while and try again.');
      } else {
        setError(e.message || 'Could not send the code');
      }
    } finally {
      setLoading(false);
    }
  };

  const check = async (value: string) => {
    if (verifying.current) return;
    verifying.current = true;
    setError(null);
    setLoading(true);
    try {
      const out = await verifyOtp(phone.trim(), value, role);
      if ('user' in out) return goHome();
      setSignupToken(out.signupToken);
      setNotice(
        mode === 'signin'
          ? `We could not find a ${role} account for this number. Add your details to create one.`
          : null,
      );
      setStep('details');
    } catch (e: any) {
      setError(e.message || 'Could not check the code');
      setCode('');
    } finally {
      setLoading(false);
      verifying.current = false;
    }
  };

  const onCodeChange = (t: string) => {
    const v = t.replace(/\D/g, '').slice(0, 6);
    setCode(v);
    if (v.length === 6) void check(v);
  };

  const create = async () => {
    setError(null);
    if (name.trim().length < 2) return setError('Please enter your name');
    if (role === 'driver' && vehicleNumber.trim().length < 6) return setError('Enter your vehicle number, for example AP37AB1234');
    setLoading(true);
    try {
      await signup(signupToken, {
        fullName: name.trim(),
        vehicle:
          role === 'driver'
            ? { type: vehicleType, number: vehicleNumber.trim(), make: make.trim() || undefined, model: model.trim() || undefined }
            : undefined,
      });
      goHome();
    } catch (e: any) {
      setError(e.message || 'Could not create the account');
    } finally {
      setLoading(false);
    }
  };

  const title =
    step === 'details'
      ? role === 'driver' ? 'Tell us about you and your vehicle' : 'Tell us your name'
      : `${role === 'driver' ? 'Driver' : 'Rider'} ${mode === 'signup' ? 'sign up' : 'sign in'}`;

  return (
    <Screen title={title} requireAuth={false}>
      {step === 'phone' && (
        <>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.textLight, lineHeight: 20, marginBottom: 16 }}>
            Enter your mobile number. We will text you a 6-digit code. No password is needed.
          </Text>
          <Field label="Mobile number" value={phone} onChangeText={setPhone} placeholder="10-digit mobile number" keyboardType="phone-pad" maxLength={14} autoFocus />
          <PrimaryButton title="Send code" onPress={sendCode} loading={loading} disabled={!phoneOk} />
        </>
      )}

      {step === 'code' && (
        <>
          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.textLight, lineHeight: 20, marginBottom: 16 }}>
            We sent a 6-digit code to {digits.slice(-10)}. It works for 5 minutes. Do not share it with anyone.
          </Text>
          <Field label="Code" value={code} onChangeText={onCodeChange} placeholder="6-digit code" keyboardType="number-pad" maxLength={6} autoFocus hint={DEMO_MODE ? `Demo: the code is ${DEMO_CODE}` : undefined} />
          <PrimaryButton title="Verify" onPress={() => check(code)} loading={loading} disabled={code.length !== 6} />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 16 }}>
            <Pressable onPress={() => { setStep('phone'); setError(null); setCode(''); }} accessibilityRole="button">
              <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: Colors.primaryDark }}>Change number</Text>
            </Pressable>
            <Pressable onPress={sendCode} disabled={countdown > 0 || appCooldown > 0 || loading} accessibilityRole="button">
              <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: (countdown > 0 || appCooldown > 0) ? Colors.textLight : Colors.primaryDark }}>
                {appCooldown > 0
                  ? `Try again in ${Math.ceil(appCooldown / 60)}m`
                  : countdown > 0
                    ? `Resend in ${countdown}s`
                    : 'Resend code'}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      {step === 'details' && (
        <>
          {notice ? <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: Colors.text, marginBottom: 14 }}>{notice}</Text> : null}
          <Field label="Full name" value={name} onChangeText={setName} placeholder="Your name" autoCapitalize="words" maxLength={80} />
          {role === 'driver' && (
            <>
              <Text style={{ fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.textLight, marginBottom: 6 }}>Vehicle type</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
                {enabledTypes.map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setVehicleType(t)}
                    accessibilityRole="button"
                    style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: vehicleType === t ? Colors.primary : Colors.border, backgroundColor: vehicleType === t ? Colors.primary : Colors.surface }}
                  >
                    <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: vehicleType === t ? Colors.secondary : Colors.text }}>{VEHICLE_LABELS[t]}</Text>
                  </Pressable>
                ))}
              </View>
              <Field label="Vehicle number" value={vehicleNumber} onChangeText={setVehicleNumber} placeholder="e.g. AP37AB1234" autoCapitalize="characters" maxLength={14} />
              <Field label="Make (optional)" value={make} onChangeText={setMake} maxLength={40} />
              <Field label="Model (optional)" value={model} onChangeText={setModel} maxLength={40} />
              <Card style={{ padding: 14, marginBottom: 14 }}>
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.textLight, lineHeight: 19 }}>
                  After this you will upload photos of your vehicle and documents. We check them by hand before you can take rides. Only yellow number plates are accepted.
                </Text>
              </Card>
            </>
          )}
          <PrimaryButton title="Create account" onPress={create} loading={loading} />
        </>
      )}

      {error ? <Text accessibilityRole="alert" style={{ marginTop: 14, color: Colors.error, fontFamily: 'Inter_500Medium', fontSize: 14 }}>{error}</Text> : null}
    </Screen>
  );
}
