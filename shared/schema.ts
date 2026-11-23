/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later).
 * Roles: admin = Super Admin, rider = InstaRider (books), driver = InstaDriver (drives).
 * Money is in Indian rupees, distance in kilometres.
 */
import { z } from "zod";

export type UserRole = 'rider' | 'driver' | 'admin';

export const VEHICLE_TYPES = ['bike', 'auto', 'erickshaw', 'car'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const DOCUMENT_KINDS = [
  'vehicle_front',
  'vehicle_back',
  'vehicle_left',
  'vehicle_right',
  'plate',
  'rc',
  'licence',
  'insurance',
  'selfie',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type VerificationStatus =
  | 'not_submitted'
  | 'pending'
  | 'needs_fix'
  | 'approved'
  | 'rejected';

export interface Favourite {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
}

export interface EmergencyContact {
  name: string;
  phone: string;
}

export interface DriverVerification {
  status: VerificationStatus;
  /** Which documents have been uploaded (server keeps the file names private). */
  uploaded: DocumentKind[];
  /** Documents the admin asked the driver to upload again. */
  fixKinds?: DocumentKind[];
  rejectionReason?: string;
  submittedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  vahanChecked?: boolean;
  insuranceExpiry?: string; // YYYY-MM-DD, entered by admin from the VAHAN lookup
  fitnessExpiry?: string; // YYYY-MM-DD
}

export interface VehicleInfo {
  type: VehicleType;
  number: string; // registration number, upper case, no spaces
  make?: string;
  model?: string;
  color?: string;
}

/** Full user record as stored on the server. */
/** Chosen by the person in Edit profile. Used only to greet a rider properly; never guessed from a name. */
export type Gender = 'male' | 'female' | 'other';

export interface StoredUser {
  id: string;
  phone: string; // login id
  passwordHash?: string; // Super Admin only: riders and drivers sign in with a one-time code
  role: UserRole;
  fullName: string;
  createdAt: string;
  isOnline?: boolean;
  suspended?: boolean;
  currentLocation?: { lat: number; lng: number };
  vehicle?: VehicleInfo;
  verification?: DriverVerification & { files: Partial<Record<DocumentKind, string>> };
  rating?: number;
  totalRides?: number;
  totalEarnings?: number; // rupees earned by an InstaDriver (fare minus platform fee, plus tips)
  totalTips?: number; // rupees of tips an InstaDriver has received (already included in totalEarnings)
  feesDue?: number; // rupees of platform fee the driver has not paid yet
  emergencyContact?: EmergencyContact;
  favourites?: Favourite[];
  gender?: Gender;
  upiId?: string; // a driver's UPI ID, used for the payment QR. Only the owner and the admin ever see it as such
  email?: string; // optional, not verified. Only the owner and the admin see it.
  bank?: StoredBank; // a driver's bank account for payouts (the account number is saved encrypted)
}

/** What the owner and the admin list see of a bank account: never the full number. */
export interface BankDetails {
  holder: string;
  ifsc: string;
  last4: string;
}
export interface StoredBank extends BankDetails {
  accountEnc: string; // the account number, encrypted on the server
}

/** What the apps receive: no password hash, no file names. */
export type User = Omit<StoredUser, 'passwordHash' | 'verification' | 'bank'> & {
  verification?: DriverVerification;
  bank?: BankDetails;
};

export interface RateCard {
  baseFare: number;
  perKm: number;
  perMinute: number;
  minimumFare: number;
}

export interface PlatformConfig {
  enabledVehicleTypes: VehicleType[];
  rates: Record<VehicleType, RateCard>;
  platformFeePerRide: number; // flat rupees charged to the driver per completed ride
  maxFeesDue: number; // driver goes offline when unpaid fees reach this amount
  surgePricing: boolean;
  surgeMultiplier: number; // hard-capped at 2 by validation
  roadFactor: number; // straight-line distance multiplier to approximate road distance
  minutesPerKm: number;
  serviceArea: { name: string; lat: number; lng: number; radiusKm: number };
  supportPhone?: string; // shown on the Help screen
  supportEmail?: string;
  sourceCodeUrl?: string; // GPL: where the source code can be obtained
}

/** The reasons offered when cancelling. The server accepts only these (anything else is stored as "Other"). */
/** Quick tags a driver can pick for a rider after a trip. */
export const RIDER_REVIEW_TAGS = ['Polite', 'Ready at pickup', 'Respectful', 'Clear directions', 'Easy payment'] as const;
export type RiderReviewTag = (typeof RIDER_REVIEW_TAGS)[number];

/** One side's review of the other after a trip. comment is a private note to the admins. hidden: an admin hid the written review from the reviewed person. */
export interface TripReview<T extends string = string> {
  rating: number;
  comment?: string;
  tags?: T[];
  peerReview?: string;
  hidden?: boolean;
  createdAt: string;
}

/** Money for a finished trip. UPI cannot tell us a payment arrived, so the driver confirms it (cash or UPI). */
/** The most a rider can add as a tip for one trip, in whole rupees. */
export const MAX_TIP = 500;

export interface RidePayment {
  status: 'pending' | 'collected';
  amount: number; // rupees, the trip's total fare
  tip?: number; // whole rupees the rider added as a thank-you. It all goes to the driver (no platform fee).
  method?: 'cash' | 'upi';
  collectedAt?: string;
  riderClaimedAt?: string; // the rider tapped "I have paid"
}

/** What the rider and the driver of a finished trip see on the payment page (GET /api/rides/:id/payment). */
export interface PaymentInfo {
  rideId: string;
  status: 'pending' | 'collected';
  amount: number; // the fare
  tip: number; // 0 if none
  total: number; // fare + tip: what the QR code and the UPI link ask for
  method?: 'cash' | 'upi';
  collectedAt?: string;
  riderClaimedAt?: string;
  driverName?: string;
  hasUpiId: boolean; // does the driver have a UPI ID, so a QR can be shown
  upiUrl?: string; // upi://pay?... with the exact amount filled in. Only while the payment is pending.
}

/** Quick tags a rider can pick for a driver after a trip. */
export const REVIEW_TAGS = ['Polite', 'On time', 'Safe driving', 'Clean vehicle', 'Knew the route', 'Helpful'] as const;
export type ReviewTag = (typeof REVIEW_TAGS)[number];

export const RIDER_CANCEL_REASONS = [
  'Booked by mistake',
  'Driver is taking too long',
  'Changed my plans',
  'Wrong pickup or drop',
  'Found another ride',
  'Other',
] as const;
export const DRIVER_CANCEL_REASONS = [
  'Rider is not reachable',
  'Rider asked me to cancel',
  'Wrong pickup location',
  'Vehicle problem',
  'Emergency',
  'Other',
] as const;

export type RideStatus =
  | 'requested'
  | 'accepted'
  | 'arriving'
  | 'arrived'
  | 'in_progress'
  | 'completed'
  | 'cancelled';

export interface FareBreakdown {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  totalFare: number;
  driverEarnings: number;
  platformFee: number;
}

export interface Ride {
  id: string;
  riderId: string;
  driverId?: string;
  vehicleType: VehicleType;
  status: RideStatus;
  pickup: { lat: number; lng: number; address: string };
  dropoff: { lat: number; lng: number; address: string };
  journeyType?: 'local' | 'intercity'; // local = within service area, intercity = outside service area
  fare?: FareBreakdown;
  distance?: number; // km
  duration?: number; // minutes
  startOtp?: string; // shown to the InstaRider only
  createdAt: string;
  acceptedAt?: string;
  arrivedAt?: string;
  startedAt?: string;
  completedAt?: string;
  cancelledBy?: 'rider' | 'driver' | 'admin';
  cancelReason?: string; // why the rider cancelled (one of RIDER_CANCEL_REASONS)
  cancelledAt?: string;
  /** Drivers who rejected, let the request time out, or backed out. Never sent to riders or other drivers. */
  declinedBy?: string[];
  /** Every time someone backed out of this booking, with the reason. For the admin. */
  cancelLog?: Array<{ by: 'rider' | 'driver'; reason?: string; at: string }>;
  riderName?: string;
  driverName?: string;
  driverVehicle?: VehicleInfo;
  driverRating?: number;
  // rating: 1 to 5. tags and peerReview are what the rider says to the DRIVER (shown without the rider's name).
  // comment is a private note to the admins only. hidden: an admin hid the written review from the driver.
  review?: TripReview<ReviewTag>; // the rider's review of the driver
  riderReview?: TripReview<RiderReviewTag>; // the driver's review of the rider
  payment?: RidePayment; // set when the trip is completed; reviews open once it is collected
  sos?: { at: string; lat?: number; lng?: number; raisedBy: 'rider' | 'driver'; ackBy?: string; ackAt?: string };
}

export interface RideEvent {
  id: string;
  type:
    | 'ride_requested'
    | 'ride_accepted'
    | 'driver_arriving'
    | 'driver_arrived'
    | 'ride_started'
    | 'ride_completed'
    | 'ride_cancelled'
    | 'verification_update'
    | 'sos_alert';
  rideId: string;
  userId: string;
  data: Record<string, unknown>;
  createdAt: string;
  read: boolean;
}

export interface AuditEntry {
  id: string;
  actorId: string;
  actorName: string;
  action: string;
  entity: string;
  before?: unknown;
  after?: unknown;
  createdAt: string;
}

const phoneRegex = /^[6-9]\d{9}$/; // 10-digit Indian mobile number

export const phoneSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, '').replace(/^(\+91|91)(?=\d{10}$)/, ''))
  .refine((s) => phoneRegex.test(s), 'Enter a valid 10-digit mobile number');

export const vehicleNumberSchema = z
  .string()
  .transform((s) => s.replace(/[\s-]/g, '').toUpperCase())
  .refine((s) => /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(s), 'Enter a valid vehicle number, e.g. AP37AB1234');

const vehicleInputSchema = z.object({
  type: z.enum(VEHICLE_TYPES),
  number: vehicleNumberSchema,
  make: z.string().trim().max(40).optional(),
  model: z.string().trim().max(40).optional(),
  color: z.string().trim().max(30).optional(),
});

/** Step 1 of signing in or signing up: send a 6-digit code to the phone. */
export const otpRequestSchema = z.object({ phone: phoneSchema });

/** Step 2: check the code. An existing account is signed in; otherwise the app collects details. */
export const otpVerifySchema = z
  .object({
    phone: phoneSchema,
    otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code').optional(),
    idToken: z.string().min(100).max(5000).optional(), // Firebase's signed proof, instead of the code
    role: z.enum(['rider', 'driver']),
  })
  .refine((v) => !!(v.otp || v.idToken), { message: 'Enter the 6-digit code', path: ['otp'] });

/** Step 3 (new accounts only): details, with the proof that the phone number was verified. */
export const signupSchema = z.object({
  signupToken: z.string().min(20).max(600),
  fullName: z.string().trim().min(2).max(80),
  vehicle: vehicleInputSchema.optional(),
});

export const loginSchema = z.object({
  phone: phoneSchema,
  password: z.string().min(1).max(100),
});

const pointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  address: z.string().trim().max(200),
});

export const requestRideSchema = z.object({
  vehicleType: z.enum(VEHICLE_TYPES),
  pickup: pointSchema,
  dropoff: pointSchema,
});

export const updateLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const rateCardSchema = z.object({
  baseFare: z.number().min(0).max(1000),
  perKm: z.number().min(0).max(200),
  perMinute: z.number().min(0).max(50),
  minimumFare: z.number().min(0).max(2000),
});

export const configUpdateSchema = z
  .object({
    enabledVehicleTypes: z.array(z.enum(VEHICLE_TYPES)).min(1),
    rates: z.record(z.enum(VEHICLE_TYPES), rateCardSchema),
    platformFeePerRide: z.number().min(0).max(500),
    maxFeesDue: z.number().min(0).max(100000),
    surgePricing: z.boolean(),
    surgeMultiplier: z.number().min(1).max(2),
    roadFactor: z.number().min(1).max(2),
    minutesPerKm: z.number().min(0.5).max(10),
    serviceArea: z.object({
      name: z.string().trim().min(1).max(60),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      radiusKm: z.number().min(1).max(100),
    }),
    supportPhone: z.string().trim().max(20).regex(/^[+\d\s-]*$/, 'Support phone can only have digits, spaces, + and -'),
    supportEmail: z.string().trim().max(80).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid support email'),
    sourceCodeUrl: z.string().trim().max(200).refine((v) => v === '' || /^https:\/\//.test(v), 'Source code link must start with https://'),
  })
  .partial();

/** A UPI ID (VPA) looks like name@bank. */
export const UPI_ID_RE = /^[a-zA-Z0-9.\-_]{2,64}@[a-zA-Z][a-zA-Z0-9]{1,31}$/;

export const updateProfileSchema = z.object({
  fullName: z.string().trim().min(2).max(80),
  gender: z.enum(['male', 'female', 'other']).nullable().optional(), // null clears it
  upiId: z.string().trim().regex(UPI_ID_RE, 'Enter a UPI ID like name@bank').nullable().optional(), // drivers only; null clears it
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(120).nullable().optional(), // null clears it
});

/** Changing the mobile number: the new number and the proof that it belongs to the person (the 6-digit code, or Firebase's signed proof). */
export const phoneChangeSchema = z
  .object({
    phone: phoneSchema,
    otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code').optional(),
    idToken: z.string().min(100).max(5000).optional(),
  })
  .refine((v) => !!(v.otp || v.idToken), { message: 'Enter the 6-digit code', path: ['otp'] });

/** A driver's bank account for payouts. */
export const bankDetailsSchema = z.object({
  holder: z.string().trim().min(2, 'Enter the name on the account').max(80),
  account: z.string().trim().regex(/^\d{9,18}$/, 'An account number is 9 to 18 digits'),
  ifsc: z.string().trim().toUpperCase().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'An IFSC code looks like SBIN0001234'),
});

/** What the assigned driver may see about the rider of a live ride (from GET /api/rides/:id/rider-contact). */
export interface RiderContact {
  name: string;
  phone: string; // 10 digits
  pickupAddress: string;
  greeting: 'Namaste Sir' | 'Namaste Madam' | 'Namaste';
}

export const emergencyContactSchema = z.object({
  name: z.string().trim().min(2).max(60),
  phone: phoneSchema,
});

export const favouriteSchema = z.object({
  label: z.string().trim().min(1).max(30),
  address: z.string().trim().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

export const deleteAccountSchema = z
  .object({
    otp: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code').optional(),
    idToken: z.string().min(100).max(5000).optional(), // Firebase's signed proof, instead of the code
    reason: z.string().trim().max(200).optional(),
  })
  .refine((v) => !!(v.otp || v.idToken), { message: 'Enter the 6-digit code', path: ['otp'] });

export const sosSchema = z.object({
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export const submitVerificationSchema = z.object({
  vehicleNumber: vehicleNumberSchema.optional(),
});

export const verifyDecisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('approve'),
    vahanChecked: z.literal(true, { errorMap: () => ({ message: 'Confirm that you checked the bike on VAHAN' }) }),
    insuranceExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fitnessExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  }),
  z.object({
    decision: z.literal('needs_fix'),
    kinds: z.array(z.enum(DOCUMENT_KINDS)).min(1),
    reason: z.string().trim().min(3).max(200),
  }),
  z.object({
    decision: z.literal('reject'),
    reason: z.string().trim().min(3).max(200),
  }),
]);

export type SignupInput = z.infer<typeof signupSchema>;
