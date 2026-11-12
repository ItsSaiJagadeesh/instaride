/*
 * InstaRide: a fork of RideFlow (GPL-3.0-or-later). Super Admin panel.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, Platform,
  ActivityIndicator, RefreshControl, TextInput, Switch, Image, Linking,
} from 'react-native';
import { router, Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { apiRequest, getApiUrl, getAuthToken } from '@/lib/query-client';
import { formatINR, formatDate, parseIndianDate, VEHICLE_LABELS } from '@/lib/format';
import AppModal, { useAppModal } from '@/components/AppModal';
import Colors from '@/constants/colors';
import { roleAllowed } from '@/lib/variant';
import { DOCUMENT_KINDS, VEHICLE_TYPES } from '@shared/schema';
import type { Ride, PlatformConfig, User, DocumentKind, VehicleType, AuditEntry } from '@shared/schema';

const VAHAN_URL = 'https://vahan.parivahan.gov.in/nrservices/';

interface Stats {
  totalDrivers: number;
  totalRiders: number;
  pendingVerifications: number;
  onlineDrivers: number;
  totalRides: number;
  activeRides: number;
  completedRides: number;
  cancelledRides: number;
  suspendedUsers: number;
  totalFares: number;
  totalDriverEarnings: number;
  platformFeesEarned: number;
  platformFeesCollected: number;
  feesDueTotal: number;
}

type AdminTab = 'overview' | 'verify' | 'rides' | 'users' | 'settings';
type AlertFn = (title: string, message: string) => void;

const DOC_LABELS: Record<DocumentKind, string> = {
  vehicle_front: 'Vehicle front',
  vehicle_back: 'Vehicle back',
  vehicle_left: 'Vehicle left',
  vehicle_right: 'Vehicle right',
  plate: 'Number plate',
  rc: 'RC',
  licence: 'Driving licence',
  insurance: 'Insurance',
  selfie: 'Selfie with vehicle number',
};

function AdminScreenInner() {
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { showAlert, showConfirm, modalProps } = useAppModal();
  const [tab, setTab] = useState<AdminTab>('overview');
  const [stats, setStats] = useState<Stats | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [pending, setPending] = useState<User[]>([]);
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  const fetchAll = useCallback(async () => {
    try {
      const get = async (path: string) => (await apiRequest('GET', path)).json();
      const [s, r, u, c, p] = await Promise.all([
        get('/api/admin/stats'),
        get('/api/admin/rides'),
        get('/api/admin/users'),
        get('/api/admin/config'),
        get('/api/admin/verifications?status=pending'),
      ]);
      setStats(s);
      setRides(r);
      setUsers(u);
      setConfig(c);
      setPending(p);
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchAll();
  };

  const run = async (id: string, fn: () => Promise<unknown>) => {
    setActionLoading(id);
    try {
      await fn();
      await fetchAll();
    } catch (e: any) {
      showAlert('Could not complete', e.message || 'Please try again');
    } finally {
      setActionLoading(null);
    }
  };

  const suspendUser = (userId: string) =>
    run(userId, () => apiRequest('PUT', `/api/admin/users/${userId}/suspend`));

  const deleteUser = (userId: string, name: string) => {
    showConfirm(
      'Remove User',
      `Remove ${name} permanently? Their documents are deleted too. This cannot be undone.`,
      () => run(userId, () => apiRequest('DELETE', `/api/admin/users/${userId}`)),
      'Remove',
      true,
    );
  };

  const cancelRide = (rideId: string) =>
    run(rideId, () => apiRequest('PUT', `/api/admin/rides/${rideId}/cancel`));

  const settleFees = (u: User) => {
    const due = u.feesDue || 0;
    if (due <= 0) return;
    showConfirm(
      'Record payment',
      `Mark ${formatINR(due)} as paid by ${u.fullName}? Only do this after you have received the money.`,
      () => run(u.id, () => apiRequest('POST', `/api/admin/drivers/${u.id}/settle`, { amount: due })),
      'Mark paid',
      false,
    );
  };

  const updateConfig = async (updates: Partial<PlatformConfig>) => {
    const res = await apiRequest('PUT', '/api/admin/config', updates);
    setConfig(await res.json());
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'requested': return Colors.warning;
      case 'accepted': case 'arriving': return '#007AFF';
      case 'arrived': case 'in_progress': return Colors.primary;
      case 'completed': return Colors.success;
      case 'cancelled': return Colors.error;
      default: return Colors.textLight;
    }
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: Colors.backgroundDark }]}>
        <ActivityIndicator size="large" color={Colors.accent} />
      </View>
    );
  }

  const tabs: { key: AdminTab; icon: string }[] = [
    { key: 'overview', icon: 'stats-chart' },
    { key: 'verify', icon: 'shield-checkmark' },
    { key: 'rides', icon: 'car' },
    { key: 'users', icon: 'people' },
    { key: 'settings', icon: 'settings' },
  ];

  return (
    <View style={[styles.container, { paddingTop: topInset }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.headerLabel}>Super Admin</Text>
          <Text style={styles.headerName}>{user?.fullName || 'Super Admin'}</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.logoutBtn}
            onPress={() => { logout(); router.replace('/'); }}
          >
            <Ionicons name="log-out-outline" size={20} color={Colors.error} />
          </Pressable>
        </View>
      </View>

      <View style={styles.tabBar}>
        {tabs.map(t => (
          <Pressable
            key={t.key}
            style={[styles.tabItem, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
          >
            <Ionicons name={t.icon as any} size={16} color={tab === t.key ? Colors.textWhite : Colors.textLight} />
            {t.key === 'verify' && pending.length > 0 && (
              <View style={adm.badge}><Text style={adm.badgeText}>{pending.length}</Text></View>
            )}
          </Pressable>
        ))}
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: bottomInset + 24 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
      >
        {tab === 'overview' && stats && <OverviewTab stats={stats} config={config} />}
        {tab === 'verify' && <VerifyTab pending={pending} onDone={fetchAll} showAlert={showAlert} />}
        {tab === 'rides' && (
          <RidesTab rides={rides} statusColor={statusColor} cancelRide={cancelRide} actionLoading={actionLoading} />
        )}
        {tab === 'users' && (
          <UsersTab users={users} suspendUser={suspendUser} deleteUser={deleteUser} settleFees={settleFees} actionLoading={actionLoading} />
        )}
        {tab === 'settings' && config && (
          <SettingsTab config={config} updateConfig={updateConfig} showAlert={showAlert} />
        )}
      </ScrollView>
      <AppModal {...modalProps} />
    </View>
  );
}

function OverviewTab({ stats, config }: { stats: Stats; config: PlatformConfig | null }) {
  return (
    <>
      <View style={styles.revenueCard}>
        <Text style={styles.revenueLabel}>Platform fees earned</Text>
        <Text style={styles.revenueAmount}>{formatINR(stats.platformFeesEarned)}</Text>
        <View style={styles.revenueRow}>
          <View style={styles.revenueStat}>
            <Text style={styles.revenueStatValue}>{formatINR(stats.platformFeesCollected)}</Text>
            <Text style={styles.revenueStatLabel}>Collected</Text>
          </View>
          <View style={styles.revDivider} />
          <View style={styles.revenueStat}>
            <Text style={styles.revenueStatValue}>{formatINR(stats.feesDueTotal)}</Text>
            <Text style={styles.revenueStatLabel}>Still due from drivers</Text>
          </View>
        </View>
      </View>

      <View style={styles.statsGrid}>
        <StatCard icon="shield-checkmark" label="To verify" value={stats.pendingVerifications.toString()} color={Colors.warning} />
        <StatCard icon="people" label="InstaRiders" value={stats.totalRiders.toString()} color="#007AFF" />
        <StatCard icon="car" label="InstaDrivers" value={stats.totalDrivers.toString()} color={Colors.primary} />
        <StatCard icon="radio-button-on" label="Online" value={stats.onlineDrivers.toString()} color={Colors.success} />
        <StatCard icon="flash" label="Active" value={(stats.activeRides ?? 0).toString()} color={Colors.warning} />
        <StatCard icon="checkmark-circle" label="Done" value={(stats.completedRides ?? 0).toString()} color={Colors.success} />
        <StatCard icon="close-circle" label="Cancelled" value={(stats.cancelledRides ?? 0).toString()} color={Colors.error} />
        <StatCard icon="ban" label="Suspended" value={(stats.suspendedUsers ?? 0).toString()} color="#FF453A" />
      </View>

      <View style={styles.compSection}>
        <Text style={styles.sectionTitle}>Driver fee</Text>
        <View style={styles.compCard}>
          <View style={styles.compRow}>
            <Text style={styles.compLabel}>Flat fee per completed ride</Text>
            <Text style={styles.compValue}>{formatINR(config?.platformFeePerRide ?? 5)}</Text>
          </View>
          <View style={styles.compRow}>
            <Text style={styles.compLabel}>Total fares (paid to drivers in cash)</Text>
            <Text style={styles.compValue}>{formatINR(stats.totalFares)}</Text>
          </View>
          <View style={styles.compRow}>
            <Text style={styles.compLabel}>Driver earnings after fee</Text>
            <Text style={styles.compValue}>{formatINR(stats.totalDriverEarnings)}</Text>
          </View>
        </View>
      </View>
    </>
  );
}

function AuthImage({ userId, kind }: { userId: string; kind: DocumentKind }) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const url = new URL(`/api/admin/documents/${userId}/${kind}`, getApiUrl()).toString();
        if (Platform.OS === 'web') {
          // Browsers cannot send a login header from an <img>, so fetch the picture first.
          const res = await fetch(url, { headers: { Authorization: `Bearer ${getAuthToken()}` } });
          if (!res.ok) throw new Error('failed');
          objectUrl = URL.createObjectURL(await res.blob());
          if (!cancelled) setUri(objectUrl);
        } else if (!cancelled) {
          setUri(url);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [userId, kind]);

  if (failed) return <Text style={adm.imgFail}>Could not load photo</Text>;
  if (!uri) return <ActivityIndicator style={{ height: 120 }} color={Colors.accent} />;
  return (
    <Image
      source={{ uri, headers: { Authorization: `Bearer ${getAuthToken() ?? ''}` } }}
      style={adm.docImage}
      resizeMode="contain"
    />
  );
}

function VerifyTab({ pending, onDone, showAlert }: { pending: User[]; onDone: () => void; showAlert: AlertFn }) {
  return (
    <>
      <Text style={styles.sectionTitle}>Waiting for review ({pending.length})</Text>
      {pending.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="shield-checkmark-outline" size={36} color={Colors.textLight} />
          <Text style={styles.emptyText}>No applications waiting</Text>
        </View>
      ) : (
        pending.map((d) => <ReviewCard key={d.id} driver={d} onDone={onDone} showAlert={showAlert} />)
      )}
    </>
  );
}

function ReviewCard({ driver, onDone, showAlert }: { driver: User; onDone: () => void; showAlert: AlertFn }) {
  const [open, setOpen] = useState(false);
  const [vahan, setVahan] = useState(false);
  const [insurance, setInsurance] = useState('');
  const [fitness, setFitness] = useState('');
  const [reason, setReason] = useState('');
  const [fix, setFix] = useState<Set<DocumentKind>>(new Set());
  const [busy, setBusy] = useState(false);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      await apiRequest('POST', `/api/admin/drivers/${driver.id}/verify`, body);
      onDone();
    } catch (e: any) {
      showAlert('Could not save', e.message || 'Please try again');
    } finally {
      setBusy(false);
    }
  };

  const approve = () => {
    const ins = parseIndianDate(insurance);
    const fit = parseIndianDate(fitness);
    if (!vahan) return showAlert('Check VAHAN first', 'Look up this vehicle number on VAHAN, then tick the box.');
    if (!ins || !fit) return showAlert('Enter the dates', 'Type the insurance and fitness expiry dates from VAHAN as DD/MM/YYYY.');
    send({ decision: 'approve', vahanChecked: true, insuranceExpiry: ins, fitnessExpiry: fit });
  };

  const askFix = () => {
    if (fix.size === 0) return showAlert('Pick photos', 'Choose which photos the driver should take again.');
    if (reason.trim().length < 3) return showAlert('Add a reason', 'Tell the driver what is wrong, e.g. "plate is not readable".');
    send({ decision: 'needs_fix', kinds: Array.from(fix), reason: reason.trim() });
  };

  const reject = () => {
    if (reason.trim().length < 3) return showAlert('Add a reason', 'Tell the driver why, e.g. "white number plate".');
    send({ decision: 'reject', reason: reason.trim() });
  };

  return (
    <View style={styles.userCard}>
      <View style={{ flex: 1 }}>
        <Pressable onPress={() => setOpen(!open)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>{driver.fullName}</Text>
            <Text style={styles.userRole}>
              {driver.vehicle ? `${VEHICLE_LABELS[driver.vehicle.type]} · ${driver.vehicle.number}` : ''} · {driver.phone}
            </Text>
            <Text style={styles.userRole}>Submitted {formatDate(driver.verification?.submittedAt)}</Text>
          </View>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={Colors.textLight} />
        </Pressable>

        {open && (
          <View style={{ marginTop: 14, gap: 12 }}>
            {DOCUMENT_KINDS.map((k) => (
              <View key={k}>
                <Text style={adm.docLabel}>{DOC_LABELS[k]}</Text>
                <AuthImage userId={driver.id} kind={k} />
              </View>
            ))}

            <View style={adm.checklist}>
              <Text style={adm.checkTitle}>Check before approving</Text>
              <Text style={adm.checkLine}>• Plate is yellow, readable, and matches the RC</Text>
              <Text style={adm.checkLine}>• Same vehicle in all four side photos</Text>
              <Text style={adm.checkLine}>• RC owner name matches the licence (or the owner has given permission)</Text>
              <Text style={adm.checkLine}>• Selfie face matches the licence photo</Text>
              <Text style={adm.checkLine}>• On VAHAN: a transport class, insurance and fitness valid</Text>
            </View>

            <Pressable style={adm.linkBtn} onPress={() => Linking.openURL(VAHAN_URL)}>
              <Ionicons name="open-outline" size={16} color={Colors.primary} />
              <Text style={adm.linkText}>Open VAHAN to look up {driver.vehicle?.number}</Text>
            </Pressable>

            <View style={styles.configRow}>
              <Text style={[styles.configLabel, { flex: 1 }]}>I checked this vehicle on VAHAN</Text>
              <Switch value={vahan} onValueChange={setVahan} />
            </View>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Insurance valid till</Text>
              <TextInput style={styles.configInput} value={insurance} onChangeText={setInsurance} placeholder="DD/MM/YYYY" placeholderTextColor={Colors.textLight} />
            </View>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Fitness valid till</Text>
              <TextInput style={styles.configInput} value={fitness} onChangeText={setFitness} placeholder="DD/MM/YYYY" placeholderTextColor={Colors.textLight} />
            </View>

            <Pressable style={[adm.approveBtn, busy && { opacity: 0.6 }]} onPress={approve} disabled={busy}>
              <Ionicons name="checkmark-circle" size={20} color={Colors.secondary} />
              <Text style={adm.approveText}>Approve driver</Text>
            </Pressable>

            <Text style={adm.docLabel}>Or ask for new photos / reject</Text>
            <View style={adm.chipRow}>
              {DOCUMENT_KINDS.map((k) => {
                const on = fix.has(k);
                return (
                  <Pressable
                    key={k}
                    style={[adm.chip, on && adm.chipOn]}
                    onPress={() => {
                      const next = new Set(fix);
                      if (on) next.delete(k); else next.add(k);
                      setFix(next);
                    }}
                  >
                    <Text style={[adm.chipText, on && { color: Colors.secondary }]}>{DOC_LABELS[k]}</Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              style={[styles.configInput, { width: '100%', textAlign: 'left' }]}
              value={reason}
              onChangeText={setReason}
              placeholder="Reason shown to the driver"
              placeholderTextColor={Colors.textLight}
              multiline
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable style={[adm.warnBtn, busy && { opacity: 0.6 }]} onPress={askFix} disabled={busy}>
                <Text style={adm.warnText}>Ask to re-upload</Text>
              </Pressable>
              <Pressable style={[adm.rejectBtn, busy && { opacity: 0.6 }]} onPress={reject} disabled={busy}>
                <Text style={adm.rejectText}>Reject</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

function RidesTab({ rides, statusColor, cancelRide, actionLoading }: {
  rides: Ride[];
  statusColor: (s: string) => string;
  cancelRide: (id: string) => void;
  actionLoading: string | null;
}) {
  const activeRides = rides.filter(r => !['completed', 'cancelled'].includes(r.status));
  const pastRides = rides.filter(r => ['completed', 'cancelled'].includes(r.status));

  return (
    <>
      {activeRides.length > 0 && (
        <>
          <Text style={styles.sectionTitle}>Active Rides ({activeRides.length})</Text>
          {activeRides.map(ride => (
            <RideCard key={ride.id} ride={ride} statusColor={statusColor} cancelRide={cancelRide} actionLoading={actionLoading} canCancel />
          ))}
        </>
      )}

      <Text style={[styles.sectionTitle, activeRides.length > 0 && { marginTop: 16 }]}>
        All Rides ({rides.length})
      </Text>
      {rides.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="car-outline" size={36} color={Colors.textLight} />
          <Text style={styles.emptyText}>No rides yet</Text>
        </View>
      ) : (
        rides.slice(0, 50).map(ride => (
          <RideCard key={ride.id} ride={ride} statusColor={statusColor} cancelRide={cancelRide} actionLoading={actionLoading} canCancel={!['completed', 'cancelled'].includes(ride.status)} />
        ))
      )}
    </>
  );
}

function RideCard({ ride, statusColor, cancelRide, actionLoading, canCancel }: {
  ride: Ride;
  statusColor: (s: string) => string;
  cancelRide: (id: string) => void;
  actionLoading: string | null;
  canCancel: boolean;
}) {
  return (
    <View style={styles.rideCard}>
      <View style={styles.rideHeader}>
        <View style={[styles.rideStatusBadge, { backgroundColor: statusColor(ride.status) + '20' }]}>
          <View style={[styles.rideStatusDot, { backgroundColor: statusColor(ride.status) }]} />
          <Text style={[styles.rideStatusLabel, { color: statusColor(ride.status) }]}>
            {ride.status.replace('_', ' ')}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {ride.fare && <Text style={styles.rideFare}>{formatINR(ride.fare.totalFare)}</Text>}
          {canCancel && (
            <Pressable
              style={styles.cancelBtn}
              onPress={() => cancelRide(ride.id)}
              disabled={actionLoading === ride.id}
            >
              {actionLoading === ride.id ? (
                <ActivityIndicator size="small" color={Colors.error} />
              ) : (
                <Ionicons name="close-circle" size={20} color={Colors.error} />
              )}
            </Pressable>
          )}
        </View>
      </View>
      <View style={styles.rideRoute}>
        <View style={styles.rideRoutePoint}>
          <View style={styles.greenDot} />
          <Text style={styles.rideAddr} numberOfLines={1}>{ride.pickup.address}</Text>
        </View>
        <View style={styles.routeLine} />
        <View style={styles.rideRoutePoint}>
          <View style={styles.orangeDot} />
          <Text style={styles.rideAddr} numberOfLines={1}>{ride.dropoff.address}</Text>
        </View>
      </View>
      <View style={styles.rideMeta}>
        <Text style={styles.rideMetaText}>
          {ride.riderName || 'Unknown'} {ride.driverName ? `\u2192 ${ride.driverName}` : ''} · {VEHICLE_LABELS[ride.vehicleType] ?? ride.vehicleType}
        </Text>
        <Text style={styles.rideMetaTime}>{new Date(ride.createdAt).toLocaleString('en-IN')}</Text>
      </View>
      {ride.review && (
        <View style={styles.reviewBox}>
          <View style={styles.reviewBoxHeader}>
            <View style={styles.reviewStarsRow}>
              {[1, 2, 3, 4, 5].map((s) => (
                <Ionicons key={s} name={s <= ride.review!.rating ? 'star' : 'star-outline'} size={14} color={s <= ride.review!.rating ? '#FFB800' : Colors.border} />
              ))}
            </View>
            <Text style={styles.reviewBoxDate}>{new Date(ride.review.createdAt).toLocaleDateString()}</Text>
          </View>
          {ride.review.comment && (
            <Text style={styles.reviewBoxComment}>"{ride.review.comment}"</Text>
          )}
        </View>
      )}
    </View>
  );
}

function UsersTab({ users, suspendUser, deleteUser, settleFees, actionLoading }: {
  users: User[];
  suspendUser: (id: string) => void;
  deleteUser: (id: string, name: string) => void;
  settleFees: (u: User) => void;
  actionLoading: string | null;
}) {
  const drivers = users.filter(u => u.role === 'driver');
  const riders = users.filter(u => u.role === 'rider');

  return (
    <>
      <Text style={styles.sectionTitle}>InstaDrivers ({drivers.length})</Text>
      {drivers.map(u => (
        <UserCard key={u.id} user={u} suspendUser={suspendUser} deleteUser={deleteUser} settleFees={settleFees} actionLoading={actionLoading} />
      ))}

      <Text style={[styles.sectionTitle, { marginTop: 16 }]}>InstaRiders ({riders.length})</Text>
      {riders.length === 0 ? (
        <View style={styles.emptyState}>
          <Ionicons name="people-outline" size={36} color={Colors.textLight} />
          <Text style={styles.emptyText}>No InstaRiders yet</Text>
        </View>
      ) : (
        riders.map(u => (
          <UserCard key={u.id} user={u} suspendUser={suspendUser} deleteUser={deleteUser} settleFees={settleFees} actionLoading={actionLoading} />
        ))
      )}
    </>
  );
}

const VERIFY_LABEL: Record<string, string> = {
  not_submitted: 'Not submitted',
  pending: 'Waiting for review',
  needs_fix: 'Needs new photos',
  approved: 'Approved',
  rejected: 'Rejected',
};

function UserCard({ user: u, suspendUser, deleteUser, settleFees, actionLoading }: {
  user: User;
  suspendUser: (id: string) => void;
  deleteUser: (id: string, name: string) => void;
  settleFees: (u: User) => void;
  actionLoading: string | null;
}) {
  const isLoading = actionLoading === u.id;
  const due = u.feesDue || 0;
  return (
    <View style={[styles.userCard, u.suspended && styles.userCardSuspended]}>
      <View style={[styles.userAvatar, { backgroundColor: u.role === 'driver' ? 'rgba(0,217,165,0.12)' : 'rgba(0,122,255,0.12)' }]}>
        <Ionicons
          name={u.role === 'driver' ? 'car' : 'person'}
          size={20}
          color={u.suspended ? Colors.error : (u.role === 'driver' ? Colors.primary : '#007AFF')}
        />
      </View>
      <View style={styles.userInfo}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.userName, u.suspended && { color: Colors.error }]}>{u.fullName}</Text>
          {u.suspended && (
            <View style={styles.suspendedBadge}>
              <Text style={styles.suspendedText}>Suspended</Text>
            </View>
          )}
        </View>
        <View style={styles.userMeta}>
          <Text style={styles.userRole}>{u.phone}</Text>
          {u.isOnline && !u.suspended && (
            <View style={styles.onlineBadge}>
              <View style={styles.onlineDotSmall} />
              <Text style={styles.onlineLabel}>Online</Text>
            </View>
          )}
        </View>
        {u.role === 'driver' && (
          <>
            <Text style={styles.userRole}>
              {u.vehicle ? `${VEHICLE_LABELS[u.vehicle.type]} ${u.vehicle.number}` : ''} · {VERIFY_LABEL[u.verification?.status ?? 'not_submitted']}
            </Text>
            <Text style={styles.userRole}>
              {(u.rating || 5.0).toFixed(1)} | {u.totalRides || 0} rides | fees due {formatINR(due)}
            </Text>
            {u.verification?.status === 'approved' && (
              <Text style={styles.userRole}>
                Insurance till {formatDate(u.verification.insuranceExpiry)} · Fitness till {formatDate(u.verification.fitnessExpiry)}
              </Text>
            )}
          </>
        )}
      </View>
      <View style={styles.userActions}>
        {isLoading ? (
          <ActivityIndicator size="small" color={Colors.accent} />
        ) : (
          <>
            {u.role === 'driver' && due > 0 && (
              <Pressable style={styles.actionBtn} onPress={() => settleFees(u)}>
                <Ionicons name="cash" size={22} color={Colors.success} />
              </Pressable>
            )}
            <Pressable style={styles.actionBtn} onPress={() => suspendUser(u.id)}>
              <Ionicons
                name={u.suspended ? 'play-circle' : 'pause-circle'}
                size={24}
                color={u.suspended ? Colors.primary : Colors.warning}
              />
            </Pressable>
            <Pressable style={styles.actionBtn} onPress={() => deleteUser(u.id, u.fullName)}>
              <Ionicons name="trash" size={20} color={Colors.error} />
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

type RateStrings = Record<VehicleType, { baseFare: string; perKm: string; perMinute: string; minimumFare: string }>;

function toRateStrings(c: PlatformConfig): RateStrings {
  const out = {} as RateStrings;
  for (const t of VEHICLE_TYPES) {
    const r = c.rates[t];
    out[t] = {
      baseFare: String(r.baseFare),
      perKm: String(r.perKm),
      perMinute: String(r.perMinute),
      minimumFare: String(r.minimumFare),
    };
  }
  return out;
}

function SettingsTab({ config, updateConfig, showAlert }: {
  config: PlatformConfig;
  updateConfig: (u: Partial<PlatformConfig>) => Promise<void>;
  showAlert: AlertFn;
}) {
  const [rates, setRates] = useState<RateStrings>(toRateStrings(config));
  const [enabled, setEnabled] = useState<Set<VehicleType>>(new Set(config.enabledVehicleTypes));
  const [fee, setFee] = useState(String(config.platformFeePerRide));
  const [maxDue, setMaxDue] = useState(String(config.maxFeesDue));
  const [surge, setSurge] = useState(config.surgePricing);
  const [surgeMultiplier, setSurgeMultiplier] = useState(String(config.surgeMultiplier));
  const [areaName, setAreaName] = useState(config.serviceArea.name);
  const [areaLat, setAreaLat] = useState(String(config.serviceArea.lat));
  const [areaLng, setAreaLng] = useState(String(config.serviceArea.lng));
  const [areaRadius, setAreaRadius] = useState(String(config.serviceArea.radiusKm));
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  // Pick up changes from the server only while the admin is not in the middle of editing.
  useEffect(() => {
    if (dirty) return;
    setRates(toRateStrings(config));
    setEnabled(new Set(config.enabledVehicleTypes));
    setFee(String(config.platformFeePerRide));
    setMaxDue(String(config.maxFeesDue));
    setSurge(config.surgePricing);
    setSurgeMultiplier(String(config.surgeMultiplier));
    setAreaName(config.serviceArea.name);
    setAreaLat(String(config.serviceArea.lat));
    setAreaLng(String(config.serviceArea.lng));
    setAreaRadius(String(config.serviceArea.radiusKm));
  }, [config, dirty]);

  const loadAudit = useCallback(async () => {
    try {
      const res = await apiRequest('GET', '/api/admin/audit');
      setAudit((await res.json()).slice(0, 15));
    } catch {}
  }, []);
  useEffect(() => { loadAudit(); }, [loadAudit]);

  const edit = <T,>(setter: (v: T) => void) => (v: T) => { setDirty(true); setter(v); };

  const num = (s: string): number => {
    const n = Number(s);
    if (s.trim() === '' || !isFinite(n)) throw new Error('Please check the numbers you entered');
    return n;
  };

  const save = async () => {
    setSaving(true);
    try {
      const outRates: any = {};
      for (const t of VEHICLE_TYPES) {
        outRates[t] = {
          baseFare: num(rates[t].baseFare),
          perKm: num(rates[t].perKm),
          perMinute: num(rates[t].perMinute),
          minimumFare: num(rates[t].minimumFare),
        };
      }
      if (enabled.size === 0) throw new Error('Keep at least one vehicle type switched on');
      await updateConfig({
        enabledVehicleTypes: VEHICLE_TYPES.filter((t) => enabled.has(t)),
        rates: outRates,
        platformFeePerRide: num(fee),
        maxFeesDue: num(maxDue),
        surgePricing: surge,
        surgeMultiplier: num(surgeMultiplier),
        serviceArea: { name: areaName.trim(), lat: num(areaLat), lng: num(areaLng), radiusKm: num(areaRadius) },
      });
      setDirty(false);
      setSaved(true);
      loadAudit();
      setTimeout(() => setSaved(false), 2000);
    } catch (e: any) {
      showAlert('Not saved', e.message || 'Please check the values');
    } finally {
      setSaving(false);
    }
  };

  const setRate = (t: VehicleType, key: keyof RateStrings[VehicleType]) => (v: string) => {
    setDirty(true);
    setRates((prev) => ({ ...prev, [t]: { ...prev[t], [key]: v } }));
  };

  return (
    <>
      <Text style={styles.sectionTitle}>Driver fee</Text>
      <View style={styles.settingsCard}>
        <ConfigRow label="Fee per completed ride (₹)" value={fee} onChange={edit(setFee)} />
        <ConfigRow label="Go offline when dues reach (₹)" value={maxDue} onChange={edit(setMaxDue)} />
      </View>

      {VEHICLE_TYPES.map((t) => (
        <View key={t}>
          <Text style={[styles.sectionTitle, { marginTop: 20 }]}>{VEHICLE_LABELS[t]} fares</Text>
          <View style={styles.settingsCard}>
            <View style={styles.configRow}>
              <Text style={styles.configLabel}>Available to book</Text>
              <Switch
                value={enabled.has(t)}
                onValueChange={(v) => {
                  setDirty(true);
                  const next = new Set(enabled);
                  if (v) next.add(t); else next.delete(t);
                  setEnabled(next);
                }}
              />
            </View>
            <ConfigRow label="Base fare (₹)" value={rates[t].baseFare} onChange={setRate(t, 'baseFare')} />
            <ConfigRow label="Per km (₹)" value={rates[t].perKm} onChange={setRate(t, 'perKm')} />
            <ConfigRow label="Per minute (₹)" value={rates[t].perMinute} onChange={setRate(t, 'perMinute')} />
            <ConfigRow label="Minimum fare (₹)" value={rates[t].minimumFare} onChange={setRate(t, 'minimumFare')} />
          </View>
        </View>
      ))}

      <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Surge pricing</Text>
      <View style={styles.settingsCard}>
        <View style={styles.configRow}>
          <Text style={styles.configLabel}>Enable surge</Text>
          <Switch
            value={surge}
            onValueChange={(v) => { setDirty(true); setSurge(v); if (v && Number(surgeMultiplier) <= 1) setSurgeMultiplier('1.5'); }}
            trackColor={{ false: 'rgba(255,255,255,0.1)', true: 'rgba(255,107,53,0.3)' }}
            thumbColor={surge ? Colors.accent : '#ccc'}
          />
        </View>
        {surge && <ConfigRow label="Multiplier (1 to 2)" value={surgeMultiplier} onChange={edit(setSurgeMultiplier)} />}
      </View>

      <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Service area</Text>
      <View style={styles.settingsCard}>
        <View style={styles.configRow}>
          <Text style={styles.configLabel}>Town name</Text>
          <TextInput style={styles.configInput} value={areaName} onChangeText={edit(setAreaName)} placeholderTextColor={Colors.textLight} />
        </View>
        <ConfigRow label="Centre latitude" value={areaLat} onChange={edit(setAreaLat)} />
        <ConfigRow label="Centre longitude" value={areaLng} onChange={edit(setAreaLng)} />
        <ConfigRow label="Radius (km)" value={areaRadius} onChange={edit(setAreaRadius)} />
      </View>
      <Text style={adm.hint}>Rides can only start and end inside this circle. Check the centre on a map.</Text>

      <Pressable style={[styles.saveBtn, saved && styles.saveBtnSaved, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
        <Ionicons name={saved ? 'checkmark-circle' : 'save'} size={20} color={Colors.textWhite} />
        <Text style={styles.saveBtnText}>{saved ? 'Saved' : 'Save changes'}</Text>
      </Pressable>

      <Text style={[styles.sectionTitle, { marginTop: 28 }]}>Recent admin actions</Text>
      {audit.length === 0 ? (
        <Text style={adm.hint}>Nothing yet.</Text>
      ) : (
        audit.map((a) => (
          <View key={a.id} style={adm.auditRow}>
            <Text style={adm.auditAction}>{a.action.replace(/_/g, ' ')}</Text>
            <Text style={adm.auditMeta}>{a.actorName} · {new Date(a.createdAt).toLocaleString('en-IN')}</Text>
          </View>
        ))
      )}
    </>
  );
}

function ConfigRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.configRow}>
      <Text style={styles.configLabel}>{label}</Text>
      <TextInput
        style={styles.configInput}
        value={value}
        onChangeText={onChange}
        keyboardType="decimal-pad"
        placeholderTextColor={Colors.textLight}
      />
    </View>
  );
}

function StatCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <View style={scStyles.card}>
      <Ionicons name={icon as any} size={22} color={color} />
      <Text style={scStyles.value}>{value}</Text>
      <Text style={scStyles.label}>{label}</Text>
    </View>
  );
}

const scStyles = StyleSheet.create({
  card: {
    width: '23%',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 12,
    alignItems: 'center',
    gap: 3,
  },
  value: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.textWhite,
  },
  label: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textLight,
  },
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.backgroundDark,
  },
  loadingContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.accent,
    textTransform: 'uppercase' as const,
    letterSpacing: 1,
  },
  headerName: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: Colors.textWhite,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  switchBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(0,217,165,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoutBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: 'rgba(255,59,48,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    marginHorizontal: 20,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 14,
    padding: 4,
    marginBottom: 16,
  },
  tabItem: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: Colors.accent,
  },
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  revenueCard: {
    backgroundColor: 'rgba(255, 107, 53, 0.08)',
    borderRadius: 20,
    padding: 24,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 53, 0.15)',
  },
  revenueLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.accent,
    marginBottom: 4,
  },
  revenueAmount: {
    fontSize: 40,
    fontFamily: 'Inter_700Bold',
    color: Colors.textWhite,
    marginBottom: 16,
  },
  revenueRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  revenueStat: { alignItems: 'center' },
  revenueStatValue: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.textWhite,
  },
  revenueStatLabel: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textLight,
    marginTop: 2,
  },
  revDivider: {
    width: 1,
    height: 30,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: Colors.textWhite,
    marginBottom: 12,
  },
  compSection: { marginBottom: 20 },
  compCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 16,
    gap: 8,
  },
  compRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  compLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textLight,
  },
  compValue: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: Colors.primary,
  },
  compBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  compBarFill: {
    height: 6,
    borderRadius: 3,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 8,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: Colors.textLight,
  },
  rideCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
  },
  rideHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  rideStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  rideStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  rideStatusLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'capitalize' as const,
  },
  rideFare: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: Colors.textWhite,
  },
  rideRoute: { gap: 4, marginBottom: 10 },
  rideRoutePoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  greenDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  orangeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.accent },
  routeLine: { width: 2, height: 10, backgroundColor: 'rgba(255,255,255,0.1)', marginLeft: 3 },
  rideAddr: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: Colors.textLight,
    flex: 1,
  },
  rideMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rideMetaText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.textWhite,
  },
  rideMetaTime: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: Colors.textLight,
  },
  reviewBox: {
    backgroundColor: 'rgba(255, 184, 0, 0.08)',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#FFB800',
  },
  reviewBoxHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  reviewStarsRow: {
    flexDirection: 'row',
    gap: 2,
  },
  reviewBoxDate: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: Colors.textLight,
  },
  reviewBoxComment: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textWhite,
    fontStyle: 'italic' as const,
    marginTop: 4,
  },
  cancelBtn: {
    padding: 4,
  },
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 14,
    marginBottom: 8,
  },
  userCardSuspended: {
    borderWidth: 1,
    borderColor: 'rgba(255,59,48,0.25)',
    backgroundColor: 'rgba(255,59,48,0.05)',
  },
  userAvatar: {
    width: 44,
    height: 44,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userInfo: { flex: 1 },
  userName: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textWhite,
  },
  userMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  userRole: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textLight,
    textTransform: 'capitalize' as const,
  },
  onlineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  onlineDotSmall: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.success,
  },
  onlineLabel: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.success,
  },
  suspendedBadge: {
    backgroundColor: 'rgba(255,59,48,0.15)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  suspendedText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.error,
  },
  userActions: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  actionBtn: {
    padding: 4,
  },
  settingsCard: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  configRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  configLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textLight,
    flex: 1,
  },
  configInput: {
    width: 90,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: Colors.textWhite,
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
    textAlign: 'right' as const,
  },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: 14,
    paddingVertical: 14,
    marginTop: 20,
  },
  saveBtnSaved: {
    backgroundColor: Colors.success,
  },
  saveBtnText: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textWhite,
  },
});

const adm = StyleSheet.create({
  badge: {
    position: 'absolute', top: -6, right: 4, minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: Colors.error, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontFamily: 'Inter_700Bold' },
  docImage: { width: '100%', height: 220, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.04)' },
  docLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: Colors.textLight, marginBottom: 6 },
  imgFail: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.error, paddingVertical: 20 },
  checklist: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 12, gap: 4 },
  checkTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textWhite, marginBottom: 4 },
  checkLine: { fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textLight, lineHeight: 18 },
  linkBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  linkText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.primary },
  approveBtn: { flexDirection: 'row', gap: 8, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.primary, paddingVertical: 14, borderRadius: 12 },
  approveText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.secondary },
  warnBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.warning },
  warnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.warning },
  rejectBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.error },
  rejectText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.error },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  chipOn: { backgroundColor: Colors.warning, borderColor: Colors.warning },
  chipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: Colors.textWhite },
  hint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textLight, marginTop: 8, lineHeight: 17 },
  auditRow: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.1)' },
  auditAction: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: Colors.textWhite, textTransform: 'capitalize' },
  auditMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textLight, marginTop: 2 },
});

export default function AdminScreen() {
  if (!roleAllowed('admin')) return <Redirect href="/" />;
  return <AdminScreenInner />;
}
