/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Proving that a phone number belongs to the person, for signing in and for confirming account deletion.
 *
 * The server decides how, number by number, and says so in its answer ("mode"):
 *   "code"      the 6-digit code (texted by our server, or a fixed test code). Works everywhere, including the web demo.
 *   "firebase"  Firebase texts the code. After the person types it, Firebase gives the app a signed proof, and the app passes that
 *               proof to our server, which checks it itself. The app never claims a number is verified on its own.
 * The Firebase library is only in builds made for it (EXPO_PUBLIC_AUTH=firebase). Other builds never load it.
 */
import { apiRequest } from '@/lib/query-client';

export const FIREBASE_ON = process.env.EXPO_PUBLIC_AUTH === 'firebase';
const fb: any = FIREBASE_ON ? require('@react-native-firebase/auth') : null;

type Mode = 'code' | 'firebase';
let mode: Mode = 'code';
let waiting: any = null; // Firebase's "enter the code" step, kept until the code is typed
let waitingPhone = '';

const tenDigits = (phone: string) => phone.replace(/\D/g, '').slice(-10);

/**
 * Turns Firebase's technical errors into sentences a person can act on. For anything that is not an ordinary
 * "wrong or old code" the error name is added in brackets, so a failure on a phone can be reported exactly.
 */
function friendly(e: any, stage: 'send' | 'check'): string {
  const code: string = typeof e?.code === 'string' ? e.code : '';
  const tag = code ? ` [${code}]` : e?.message ? ` [${String(e.message).slice(0, 80)}]` : '';
  switch (code) {
    case 'auth/invalid-verification-code':
      return 'Wrong code. Please check it and try again.';
    case 'auth/code-expired':
    case 'auth/session-expired':
      return 'This code has expired. Ask for a new one.';
    case 'auth/too-many-requests':
      return 'Too many tries. Please wait a while and try again.' + tag;
    case 'auth/invalid-phone-number':
      return 'That phone number does not look right.' + tag;
    case 'auth/network-request-failed':
      return 'No internet connection. Please check it and try again.' + tag;
    case 'auth/app-not-authorized':
    case 'auth/missing-client-identifier':
    case 'auth/invalid-app-credential':
    case 'auth/operation-not-allowed':
      return 'Phone sign-in is not fully set up for this app yet. Please tell the InstaRide team.' + tag;
    case 'auth/quota-exceeded':
      return 'We cannot send more codes right now. Please try again later.' + tag;
    default:
      return (stage === 'send' ? 'We could not send the code. Please try again.' : 'We could not check that code. Please try again.') + tag;
  }
}

/**
 * Step 1. Asks the server how this number proves itself (path is the server's request route), and for "firebase" starts the
 * Firebase text. Returns the server's answer ({ mode, sent, resendAfterSeconds }).
 */
export async function requestPhoneProof(path: string, phone: string, body?: object): Promise<any> {
  const res = await apiRequest('POST', path, body);
  const out = await res.json();
  mode = out.mode === 'firebase' ? 'firebase' : 'code';
  waiting = null;
  waitingPhone = tenDigits(phone);
  if (mode === 'firebase') {
    if (!FIREBASE_ON) throw new Error('Please update the InstaRide app to sign in with this number.');
    try {
      waiting = await fb.signInWithPhoneNumber(fb.getAuth(), '+91' + waitingPhone);
    } catch (e: any) {
      console.warn('Firebase could not send the code:', e?.code, e?.message);
      throw new Error(friendly(e, 'send'));
    }
  }
  return out;
}

/**
 * Step 2. Takes the code the person typed and returns what to send to the server: { otp } for the plain code,
 * or { idToken } (Firebase's signed proof) for a Firebase number.
 */
export async function finishPhoneProof(code: string): Promise<{ otp: string } | { idToken: string }> {
  if (mode !== 'firebase') return { otp: code };
  if (!waiting) throw new Error('Ask for a new code first.');
  try {
    const auth = fb.getAuth();
    let user = auth.currentUser;
    // Some phones read the text by themselves and are already signed in. Otherwise, check the typed code.
    if (!(user && user.phoneNumber === '+91' + waitingPhone)) {
      const credential = await waiting.confirm(code);
      user = credential?.user ?? auth.currentUser;
    }
    if (!user) throw new Error('not signed in');
    const idToken: string = await fb.getIdToken(user, true);
    try {
      await fb.signOut(auth); // our own session is what keeps the person signed in, not Firebase's
    } catch {}
    waiting = null;
    return { idToken };
  } catch (e: any) {
    console.warn('Firebase could not check the code:', e?.code, e?.message);
    throw new Error(friendly(e, 'check'));
  }
}
