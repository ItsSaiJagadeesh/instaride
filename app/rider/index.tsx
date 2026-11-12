import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, Platform, TextInput,
  ActivityIndicator, Dimensions, ScrollView, Linking, Keyboard, Share,
} from 'react-native';
import { router, Redirect } from 'expo-router';
import MapView, { Marker, PROVIDER_DEFAULT, RouteLine } from '@/components/MapView';
import { MAPPLS_ON, searchPlaces, reversePlace, getRoute, type RouteInfo } from '@/lib/places';
import AppModal, { useAppModal } from '@/components/AppModal';
import * as Location from 'expo-location';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth-context';
import { apiRequest, getApiUrl } from '@/lib/query-client';
import { formatINR, VEHICLE_LABELS } from '@/lib/format';
import Colors from '@/constants/colors';
import { roleAllowed } from '@/lib/variant';
import Animated, { FadeInDown, FadeInUp, SlideInDown, FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import type { Ride, User, VehicleType } from '@shared/schema';

const { width, height } = Dimensions.get('window');
const ASPECT_RATIO = width / height;
const LATITUDE_DELTA = 0.015;
const LONGITUDE_DELTA = LATITUDE_DELTA * ASPECT_RATIO;

type RiderPhase = 'idle' | 'selecting_dropoff' | 'confirming' | 'waiting' | 'matched' | 'riding' | 'completed';

interface NearbyDriver {
  id: string;
  vehicleType?: VehicleType;
  rating?: number;
  currentLocation: { lat: number; lng: number };
  distance: number;
}

interface FareQuote {
  baseFare: number;
  distanceFare: number;
  timeFare: number;
  totalFare: number;
  driverEarnings: number;
  platformFee: number;
  distance: number;
  duration: number;
}

function RiderScreenInner() {
  const insets = useSafeAreaInsets();
  const { user, logout, refreshUser } = useAuth();
  const mapRef = useRef<MapView>(null);

  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<string | null>(null);
  const [phase, setPhase] = useState<RiderPhase>('idle');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [dropoffCoord, setDropoffCoord] = useState<{ lat: number; lng: number } | null>(null);
  const [pickupAddress, setPickupAddress] = useState('Current Location');
  const [nearbyDrivers, setNearbyDrivers] = useState<NearbyDriver[]>([]);
  const [quotes, setQuotes] = useState<Record<string, FareQuote> | null>(null);
  const [vehicleType, setVehicleType] = useState<VehicleType>('bike');
  const fareEstimate: FareQuote | null = quotes ? quotes[vehicleType] ?? null : null;
  const [activeRide, setActiveRide] = useState<Ride | null>(null);
  const [driverInfo, setDriverInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [addressInput, setAddressInput] = useState('');
  const [addressSearching, setAddressSearching] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<Array<{ label: string; address: string; lat: number; lng: number }>>([]);
  const [recents, setRecents] = useState<Array<{ lat: number; lng: number; address: string }>>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [placeLabel, setPlaceLabel] = useState('');
  const [savingPlace, setSavingPlace] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [route, setRoute] = useState<RouteInfo | null>(null);

  const phaseRef = useRef<RiderPhase>(phase);
  const activeRideRef = useRef<Ride | null>(activeRide);
  const locationRef = useRef(location);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { activeRideRef.current = activeRide; }, [activeRide]);
  useEffect(() => { locationRef.current = location; }, [location]);

  // The road route from the rider to the chosen drop-off (Mappls builds only). One request per chosen place,
  // keyed to a rounded position so a small GPS wobble does not trigger another request.
  const routeFrom = location ? `${location.lat.toFixed(3)},${location.lng.toFixed(3)}` : '';
  const routeTo = dropoffCoord ? `${dropoffCoord.lat.toFixed(5)},${dropoffCoord.lng.toFixed(5)}` : '';
  const wantsRoute = MAPPLS_ON && !!routeFrom && !!routeTo && (phase === 'selecting_dropoff' || phase === 'confirming');
  useEffect(() => {
    if (!wantsRoute || !locationRef.current || !dropoffCoord) {
      setRoute(null);
      return;
    }
    let cancelled = false;
    getRoute(locationRef.current, dropoffCoord).then((r) => {
      if (cancelled) return;
      setRoute(r);
      if (r && r.points.length > 1) {
        (mapRef.current as any)?.fitToCoordinates?.(r.points.map((p) => ({ latitude: p.lat, longitude: p.lng })));
      }
    });
    return () => { cancelled = true; };
  }, [wantsRoute, routeFrom, routeTo]);

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => setKeyboardHeight(e.endCoordinates.height)
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0)
    );
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  const { showAlert, showConfirm, showActionSheet, modalProps } = useAppModal();

  const topInset = Platform.OS === 'web' ? 67 : insets.top;
  const bottomInset = Platform.OS === 'web' ? 34 : insets.bottom;

  useEffect(() => {
    requestLocation();
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    checkActiveRide();
    const interval = setInterval(checkActiveRide, 5000);
    return () => clearInterval(interval);
  }, [user?.id]);

  useEffect(() => {
    if (location) {
      fetchNearbyDrivers();
      updateServerLocation();
      const interval = setInterval(fetchNearbyDrivers, 10000);
      return () => clearInterval(interval);
    }
  }, [location]);

  const requestLocation = async () => {
    if (Platform.OS === 'web') {
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            setPermissionStatus('granted');
          },
          () => {
            setLocation({ lat: 17.1225, lng: 81.2945 });
            setPermissionStatus('granted');
          }
        );
      } catch {
        setLocation({ lat: 17.1225, lng: 81.2945 });
        setPermissionStatus('granted');
      }
      return;
    }

    const { status } = await Location.requestForegroundPermissionsAsync();
    setPermissionStatus(status);
    if (status !== 'granted') return;

    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });

    try {
      if (MAPPLS_ON) {
        setPickupAddress(await reversePlace(loc.coords.latitude, loc.coords.longitude));
      } else {
        const geocode = await Location.reverseGeocodeAsync({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
        if (geocode.length > 0) {
          const g = geocode[0];
          setPickupAddress(`${g.street || ''} ${g.city || ''}`.trim() || 'Current Location');
        }
      }
    } catch {}
  };

  const updateServerLocation = async () => {
    if (!user?.id || !location) return;
    try {
      await apiRequest('PUT', `/api/user/${user.id}/location`, location);
    } catch {}
  };

  const fetchNearbyDrivers = async () => {
    const loc = locationRef.current;
    if (!loc) return;
    try {
      const res = await apiRequest('GET', `/api/drivers/nearby?lat=${loc.lat}&lng=${loc.lng}&radius=10`);
      const data = await res.json();
      setNearbyDrivers(Array.isArray(data) ? data : []);
    } catch {}
  };

  const checkActiveRide = async () => {
    if (!user?.id) return;
    try {
      const res = await apiRequest('GET', `/api/rides/rider/${user.id}/active`);
      const data = await res.json();
      if (data && data.id) {
        setActiveRide(data);
        if (data.status === 'requested') setPhase('waiting');
        else if (data.status === 'accepted' || data.status === 'arriving') {
          setPhase('matched');
          setDriverInfo(rideDriver(data));
        }
        else if (data.status === 'arrived' || data.status === 'in_progress') {
          setPhase('riding');
          setDriverInfo(rideDriver(data));
        }
        else if (data.status === 'completed') setPhase('completed');
      } else {
        const currentPhase = phaseRef.current;
        const currentRide = activeRideRef.current;
        if (currentPhase === 'waiting' || currentPhase === 'matched' || currentPhase === 'riding') {
          if (currentRide) {
            setActiveRide(currentRide);
            setPhase('completed');
          } else {
            setPhase('idle');
          }
        }
      }
    } catch {}
  };

  const rideDriver = (r: Ride) => ({
    fullName: r.driverName,
    rating: r.driverRating,
    vehicle: r.driverVehicle,
  });


  const handleMapPress = (e: any) => {
    if (phase !== 'selecting_dropoff') return;
    const coord = e.nativeEvent.coordinate;
    setDropoffCoord({ lat: coord.latitude, lng: coord.longitude });

    if (Platform.OS !== 'web' && !MAPPLS_ON) {
      (async () => {
        try {
          const geocode = await Location.reverseGeocodeAsync({
            latitude: coord.latitude,
            longitude: coord.longitude,
          });
          if (geocode.length > 0) {
            const g = geocode[0];
            setDropoffAddress(`${g.street || ''} ${g.city || ''}`.trim() || 'Selected Location');
          } else {
            setDropoffAddress('Selected Location');
          }
        } catch {
          setDropoffAddress('Selected Location');
        }
      })();
    } else {
      reverseGeocodeWeb(coord.latitude, coord.longitude);
    }
  };

  // Looks the tapped spot up (Mappls on the phone map, our server otherwise). Never fails: falls back to coordinates.
  const reverseGeocodeWeb = async (lat: number, lng: number) => {
    setDropoffAddress(await reversePlace(lat, lng));
  };

  // Search runs only when the rider presses search (the free address service does not allow search-as-you-type).
  const handleAddressInputChange = useCallback((text: string) => {
    setAddressInput(text);
    if (text.trim().length < 3) {
      setAddressSuggestions([]);
      setShowSuggestions(false);
    }
  }, []);

  const moveMapTo = (lat: number, lng: number) => {
    (mapRef.current as any)?.animateToRegion?.({
      latitude: lat,
      longitude: lng,
      latitudeDelta: LATITUDE_DELTA,
      longitudeDelta: LONGITUDE_DELTA,
    }, 500);
  };

  const choosePlace = useCallback((p: { lat: number; lng: number; address: string }) => {
    setAddressInput(p.address);
    setDropoffCoord({ lat: p.lat, lng: p.lng });
    setDropoffAddress(p.address);
    setShowSuggestions(false);
    setAddressSuggestions([]);
    setSaveOpen(false);
    setPhase('selecting_dropoff');
    Keyboard.dismiss();
    moveMapTo(p.lat, p.lng);
  }, []);

  const selectSuggestion = useCallback((x: { label: string; address: string; lat: number; lng: number }) => {
    choosePlace({ lat: x.lat, lng: x.lng, address: x.label });
  }, [choosePlace]);

  const searchAddress = async () => {
    const q = addressInput.trim();
    if (q.length < 3) return;
    setAddressSearching(true);
    setShowSuggestions(false);
    try {
      const places = await searchPlaces(q, locationRef.current);
      if (places.length > 0) {
        setAddressSuggestions(places);
        setShowSuggestions(true);
      } else {
        setAddressSuggestions([]);
        showAlert('No match', 'We could not find that place. Try a nearby landmark, or tap the spot on the map.');
      }
    } catch (e: any) {
      showAlert('Search unavailable', (e.message || 'Please try again') + ' You can still tap the spot on the map.');
    } finally {
      setAddressSearching(false);
    }
  };

  // Recent destinations from past rides, shown as quick choices.
  useEffect(() => {
    if (!user?.id || phase !== 'idle') return;
    (async () => {
      try {
        const res = await apiRequest('GET', `/api/rides/rider/${user.id}`);
        const rides: Ride[] = await res.json();
        const seen = new Set<string>();
        const out: Array<{ lat: number; lng: number; address: string }> = [];
        for (const r of rides) {
          const key = r.dropoff.address;
          if (!key || seen.has(key)) continue;
          seen.add(key);
          out.push({ lat: r.dropoff.lat, lng: r.dropoff.lng, address: key });
          if (out.length >= 5) break;
        }
        setRecents(out);
      } catch {}
    })();
  }, [user?.id, phase]);

  const favourites = user?.favourites ?? [];
  const quickPlaces = [
    ...favourites.map((f) => ({ key: f.id, label: f.label, address: f.address, lat: f.lat, lng: f.lng, fav: true })),
    ...recents
      .filter((r) => !favourites.some((f) => f.address === r.address))
      .map((r) => ({ key: r.address, label: r.address.split(',')[0], address: r.address, lat: r.lat, lng: r.lng, fav: false })),
  ].slice(0, 6);
  const alreadySaved = favourites.some((f) => f.address === dropoffAddress);

  const savePlace = async () => {
    if (!dropoffCoord || !placeLabel.trim()) return;
    setSavingPlace(true);
    try {
      await apiRequest('POST', '/api/me/favourites', {
        label: placeLabel.trim(),
        address: dropoffAddress,
        lat: dropoffCoord.lat,
        lng: dropoffCoord.lng,
      });
      await refreshUser();
      setSaveOpen(false);
      setPlaceLabel('');
    } catch (e: any) {
      showAlert('Could not save', e.message || 'Please try again');
    } finally {
      setSavingPlace(false);
    }
  };

  // Share trip and SOS during a ride
  const createShareLink = async (): Promise<string | null> => {
    const ride = activeRideRef.current;
    if (!ride) return null;
    const res = await apiRequest('POST', `/api/rides/${ride.id}/share`);
    const { path } = await res.json();
    return new URL(path, getApiUrl()).href;
  };

  const handleShare = async () => {
    let link: string | null = null;
    try {
      link = await createShareLink();
      if (!link) return;
      await Share.share({ message: `Follow my ride live: ${link}` });
    } catch (e: any) {
      // No share sheet (for example on a desktop browser): show the link so it can be copied.
      if (link) showAlert('Your trip link', `${link}\n\nCopy this link and send it to someone you trust.`);
      else showAlert('Could not share', e.message || 'Please try again');
    }
  };

  const handleSos = () => {
    const ride = activeRideRef.current;
    if (!ride) return;
    showConfirm(
      'Send an SOS?',
      'This alerts our team with your location. If you are in danger, call 112 first.',
      async () => {
        const call112 = { label: 'Call 112', icon: 'call', onPress: () => { void Linking.openURL('tel:112'); } };
        try {
          const loc = locationRef.current;
          await apiRequest('POST', `/api/rides/${ride.id}/sos`, loc ? { lat: loc.lat, lng: loc.lng } : {});
          const actions = [call112];
          const ec = user?.emergencyContact;
          if (ec) {
            actions.push({
              label: `Message ${ec.name}`,
              icon: 'chatbubble',
              onPress: () => {
                void (async () => {
                  let link = '';
                  try { link = (await createShareLink()) || ''; } catch {}
                  void Linking.openURL(`sms:${ec.phone}?body=${encodeURIComponent(`I need help. ${link ? 'Track my trip: ' + link : ''}`)}`);
                })();
              },
            });
          }
          showAlert('SOS sent', 'Our team has been alerted. Stay on this screen.', actions);
        } catch (e: any) {
          showAlert('Could not send SOS', `${e.message || ''} If you are in danger, call 112 now.`, [call112]);
        }
      },
      'Send SOS',
      true,
    );
  };

  const handleConfirmDropoff = async () => {
    if (!dropoffCoord || !location) return;
    setLoading(true);
    try {
      const res = await apiRequest(
        'GET',
        `/api/fare/estimate?pLat=${location.lat}&pLng=${location.lng}&dLat=${dropoffCoord.lat}&dLng=${dropoffCoord.lng}`,
      );
      const data = await res.json();
      setQuotes(data.quotes);
      const types = Object.keys(data.quotes) as VehicleType[];
      if (!types.includes(vehicleType) && types.length) setVehicleType(types[0]);
      setPhase('confirming');
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e: any) {
      showAlert('Error', e.message || 'Could not get fare estimate');
    } finally {
      setLoading(false);
    }
  };

  const handleRequestRide = async () => {
    if (!location || !dropoffCoord || !user?.id) return;
    setLoading(true);
    try {
      const res = await apiRequest('POST', '/api/rides', {
        vehicleType,
        pickup: { lat: location.lat, lng: location.lng, address: pickupAddress },
        dropoff: { lat: dropoffCoord.lat, lng: dropoffCoord.lng, address: dropoffAddress },
      });
      const ride = await res.json();
      setActiveRide(ride);
      setPhase('waiting');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      showAlert('Error', e.message || 'Could not request ride');
    } finally {
      setLoading(false);
    }
  };

  const doCancelRide = async () => {
    if (!activeRide?.id) return;
    try {
      await apiRequest('PUT', `/api/rides/${activeRide.id}/status`, { status: 'cancelled' });
      setActiveRide(null);
      setPhase('idle');
      setDropoffCoord(null);
      setDropoffAddress('');
      setQuotes(null);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } catch (e: any) {
      showAlert('Cannot cancel', e.message || 'Please try again');
    }
  };

  const handleCancelRide = () => {
    if (!activeRide?.id) return;
    const currentPhase = phaseRef.current;
    if (currentPhase === 'matched' || currentPhase === 'riding') {
      showAlert(
        'Cancel Ride?',
        'Your driver is already on the way. Please cancel only if you really need to. You cannot cancel once the trip has started.',
        [
          { label: 'Keep Ride', onPress: () => {} },
          { label: 'Cancel Anyway', destructive: true, onPress: doCancelRide },
        ]
      );
    } else {
      doCancelRide();
    }
  };

  const submitReview = async () => {
    if (!activeRide || reviewRating === 0) return;
    setReviewSubmitting(true);
    try {
      await apiRequest('PUT', `/api/rides/${activeRide.id}/review`, {
        rating: reviewRating,
        comment: reviewComment.trim() || undefined,
      });
      setReviewSubmitted(true);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      showAlert('Error', 'Failed to submit review. Please try again.');
    } finally {
      setReviewSubmitting(false);
    }
  };

  const handleNewRide = () => {
    setPhase('idle');
    setActiveRide(null);
    setDropoffCoord(null);
    setDropoffAddress('');
    setQuotes(null);
    setDriverInfo(null);
    setAddressInput('');
    setReviewRating(0);
    setReviewComment('');
    setReviewSubmitted(false);
  };

  if (permissionStatus === null) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: Colors.backgroundDark }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingText}>Getting your location...</Text>
      </View>
    );
  }

  if (permissionStatus !== 'granted' && Platform.OS !== 'web') {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: Colors.backgroundDark }]}>
        <Ionicons name="location-outline" size={48} color={Colors.textLight} />
        <Text style={styles.loadingText}>Location access is required</Text>
        <Pressable style={styles.permBtn} onPress={requestLocation}>
          <Text style={styles.permBtnText}>Grant Permission</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {location && (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFillObject}
          provider={PROVIDER_DEFAULT}
          initialRegion={{
            latitude: location.lat,
            longitude: location.lng,
            latitudeDelta: LATITUDE_DELTA,
            longitudeDelta: LONGITUDE_DELTA,
          }}
          showsUserLocation
          showsMyLocationButton={false}
          onPress={handleMapPress}
        >
          {nearbyDrivers.map((driver) => (
            <Marker
              key={driver.id}
              coordinate={{
                latitude: driver.currentLocation.lat,
                longitude: driver.currentLocation.lng,
              }}
              title={driver.vehicleType ? VEHICLE_LABELS[driver.vehicleType] : 'Driver'}
              description={`${driver.distance} km away`}
            >
              <View style={styles.driverMarker}>
                <Ionicons name="car" size={16} color={Colors.textWhite} />
              </View>
            </Marker>
          ))}

          {dropoffCoord && (
            <Marker
              coordinate={{
                latitude: dropoffCoord.lat,
                longitude: dropoffCoord.lng,
              }}
              title="Drop-off"
            >
              <View style={styles.dropoffMarker}>
                <Ionicons name="flag" size={16} color={Colors.textWhite} />
              </View>
            </Marker>
          )}

          {route && route.points.length > 1 && <RouteLine id="trip" coordinates={route.points} />}
        </MapView>
      )}

      <View style={[styles.topBar, { top: topInset + 8 }]}>
        <Pressable style={styles.menuBtn} onPress={() => router.push('/rider/profile')} accessibilityLabel="Open profile">
          <Ionicons name="person-circle-outline" size={26} color={Colors.text} />
        </Pressable>

        <View style={styles.statusChip}>
          <View style={[styles.statusDot, { backgroundColor: Colors.driverOnline }]} />
          <Text style={styles.statusText}>
            {nearbyDrivers.length} driver{nearbyDrivers.length !== 1 ? 's' : ''} nearby
          </Text>
        </View>
      </View>

      {phase === 'idle' && (
        <Animated.View entering={SlideInDown.duration(400)} style={[styles.bottomCard, { paddingBottom: bottomInset + 16 }]}>
          <View style={styles.cardHandle} />
          <Text style={styles.cardTitle}>Where to?</Text>
          <Pressable
            style={styles.destinationInput}
            onPress={() => {
              setPhase('selecting_dropoff');
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }}
          >
            <Ionicons name="search" size={20} color={Colors.textLight} />
            <Text style={styles.destinationPlaceholder}>Search or tap map to set destination</Text>
          </Pressable>
          <View style={styles.pickupRow}>
            <View style={styles.pickupDot} />
            <Text style={styles.pickupText} numberOfLines={1}>{pickupAddress}</Text>
          </View>
          {quickPlaces.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }} contentContainerStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled">
              {quickPlaces.map((p) => (
                <Pressable
                  key={p.key}
                  onPress={() => choosePlace(p)}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface, maxWidth: 200 }}
                >
                  <Ionicons name={p.fav ? 'heart' : 'time-outline'} size={14} color={p.fav ? Colors.accent : Colors.textLight} />
                  <Text numberOfLines={1} style={{ fontFamily: 'Inter_500Medium', fontSize: 13, color: Colors.text }}>{p.label}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </Animated.View>
      )}

      {phase === 'selecting_dropoff' && (
        <Animated.View entering={SlideInDown.duration(400)} style={[styles.bottomCard, { paddingBottom: bottomInset + 16, bottom: keyboardHeight }]}>
          <View style={styles.cardHandle} />
          <Text style={styles.cardTitle}>Set your destination</Text>

          <View style={styles.searchRow}>
            <TextInput
              style={styles.searchInput}
              placeholder="Type an address..."
              placeholderTextColor={Colors.textLight}
              value={addressInput}
              onChangeText={handleAddressInputChange}
              onSubmitEditing={searchAddress}
              returnKeyType="search"
              autoFocus={Platform.OS === 'web'}
            />
            <Pressable
              style={[styles.searchBtn, addressSearching && styles.btnDisabled]}
              onPress={searchAddress}
              disabled={addressSearching}
              accessibilityLabel="Search address"
            >
              {addressSearching ? (
                <ActivityIndicator size="small" color={Colors.secondary} />
              ) : (
                <Ionicons name="search" size={20} color={Colors.secondary} />
              )}
            </Pressable>
          </View>

          {showSuggestions && addressSuggestions.length > 0 && (
            <View style={styles.suggestionsContainer}>
              {addressSuggestions.map((item, idx) => (
                <Pressable
                  key={`${item.lat}-${item.lng}-${idx}`}
                  style={({ pressed }) => [styles.suggestionItem, pressed && { backgroundColor: Colors.background }, idx < addressSuggestions.length - 1 && styles.suggestionBorder]}
                  onPress={() => selectSuggestion(item)}
                >
                  <Ionicons name="location-outline" size={18} color={Colors.primary} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.suggestionPrimary} numberOfLines={1}>{item.label}</Text>
                    <Text style={styles.suggestionSecondary} numberOfLines={1}>{item.address}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={styles.orDividerText}>or tap on the map</Text>

          {dropoffCoord ? (
            <>
              <View style={styles.routeInfo}>
                <View style={styles.routePoint}>
                  <View style={styles.pickupDot} />
                  <Text style={styles.routeText} numberOfLines={1}>{pickupAddress}</Text>
                </View>
                <View style={styles.routeDivider} />
                <View style={styles.routePoint}>
                  <View style={styles.dropoffDot} />
                  <Text style={styles.routeText} numberOfLines={1}>{dropoffAddress}</Text>
                </View>
              </View>

              {!alreadySaved && (saveOpen ? (
                <View style={[styles.searchRow, { marginBottom: 10 }]}>
                  <TextInput
                    style={styles.searchInput}
                    placeholder="Name this place (Home, Work…)"
                    placeholderTextColor={Colors.textLight}
                    value={placeLabel}
                    onChangeText={setPlaceLabel}
                    maxLength={30}
                  />
                  <Pressable style={[styles.searchBtn, (savingPlace || !placeLabel.trim()) && styles.btnDisabled]} onPress={savePlace} disabled={savingPlace || !placeLabel.trim()} accessibilityLabel="Save place name">
                    {savingPlace ? <ActivityIndicator size="small" color={Colors.secondary} /> : <Ionicons name="checkmark" size={20} color={Colors.secondary} />}
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => setSaveOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <Ionicons name="star-outline" size={18} color={Colors.accent} />
                  <Text style={{ fontFamily: 'Inter_500Medium', fontSize: 14, color: Colors.accent }}>Save this place</Text>
                </Pressable>
              ))}

              <View style={styles.btnRow}>
                <Pressable
                  style={({ pressed }) => [styles.cancelBtn, pressed && styles.btnPressed]}
                  onPress={() => { setPhase('idle'); setDropoffCoord(null); setDropoffAddress(''); setAddressInput(''); setShowSuggestions(false); setAddressSuggestions([]); setSaveOpen(false); }}
                >
                  <Ionicons name="close" size={20} color={Colors.textLight} />
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.confirmBtn, pressed && styles.btnPressed, loading && styles.btnDisabled]}
                  onPress={handleConfirmDropoff}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color={Colors.secondary} />
                  ) : (
                    <>
                      <Ionicons name="checkmark" size={20} color={Colors.secondary} />
                      <Text style={styles.confirmBtnText}>Get Fare</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </>
          ) : (
            <View>
              {quickPlaces.slice(0, 4).map((p) => (
                <Pressable key={p.key} onPress={() => choosePlace(p)} style={({ pressed }) => [styles.suggestionItem, pressed && { backgroundColor: Colors.background }]}>
                  <Ionicons name={p.fav ? 'heart' : 'time-outline'} size={18} color={p.fav ? Colors.accent : Colors.textLight} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.suggestionPrimary} numberOfLines={1}>{p.label}</Text>
                    <Text style={styles.suggestionSecondary} numberOfLines={1}>{p.address}</Text>
                  </View>
                </Pressable>
              ))}
              <View style={styles.tapHint}>
                <Ionicons name="location" size={28} color={Colors.textLight} />
                <Text style={styles.tapHintText}>Type a place and press search, or tap the map</Text>
              </View>
            </View>
          )}
        </Animated.View>
      )}

      {phase === 'confirming' && fareEstimate && (
        <Animated.View entering={SlideInDown.duration(400)} style={[styles.bottomCard, { paddingBottom: bottomInset + 16 }]}>
          <View style={styles.cardHandle} />
          <Text style={styles.cardTitle}>Confirm Your Ride</Text>

          {quotes && Object.keys(quotes).length > 1 && (
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
              {(Object.keys(quotes) as VehicleType[]).map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setVehicleType(t)}
                  style={{
                    flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center', borderWidth: 1,
                    borderColor: vehicleType === t ? Colors.primary : Colors.border,
                    backgroundColor: vehicleType === t ? 'rgba(0, 217, 165, 0.12)' : 'transparent',
                  }}
                >
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: Colors.text }}>
                    {VEHICLE_LABELS[t]}
                  </Text>
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.textLight }}>
                    {formatINR(quotes[t].totalFare)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {route && (
            <Text style={styles.routeNote}>
              By road: about {route.km.toFixed(1)} km, {Math.max(1, Math.round(route.minutes))} min
            </Text>
          )}

          <View style={styles.fareCard}>
            <View style={styles.fareMain}>
              <Text style={styles.fareLabel}>Estimated Fare</Text>
              <Text style={styles.farePrice}>{formatINR(fareEstimate.totalFare)}</Text>
            </View>
            <View style={styles.fareDetails}>
              <FareRow label="Base fare" value={formatINR(fareEstimate.baseFare)} />
              <FareRow label={`Distance (~${fareEstimate.distance} km)`} value={formatINR(fareEstimate.distanceFare)} />
              <FareRow label={`Time (~${fareEstimate.duration} min)`} value={formatINR(fareEstimate.timeFare)} />
              <View style={styles.fareDivider} />
              <FareRow label="Pay the driver in cash" value={formatINR(fareEstimate.totalFare)} highlight />
            </View>
          </View>

          <View style={styles.btnRow}>
            <Pressable
              style={({ pressed }) => [styles.cancelBtn, pressed && styles.btnPressed]}
              onPress={() => setPhase('selecting_dropoff')}
            >
              <Ionicons name="arrow-back" size={20} color={Colors.textLight} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.confirmBtn, pressed && styles.btnPressed, loading && styles.btnDisabled]}
              onPress={handleRequestRide}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator size="small" color={Colors.secondary} />
              ) : (
                <>
                  <Ionicons name="car" size={20} color={Colors.secondary} />
                  <Text style={styles.confirmBtnText}>Request Ride</Text>
                </>
              )}
            </Pressable>
          </View>
        </Animated.View>
      )}

      {phase === 'waiting' && (
        <Animated.View entering={SlideInDown.duration(400)} style={[styles.bottomCard, { paddingBottom: bottomInset + 16 }]}>
          <View style={styles.cardHandle} />
          <View style={styles.waitingContent}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.waitingTitle}>Finding your driver...</Text>
            <Text style={styles.waitingSubtitle}>Looking for nearby available drivers</Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.cancelRideBtn, pressed && styles.btnPressed]}
            onPress={handleCancelRide}
          >
            <Text style={styles.cancelRideBtnText}>Cancel Ride</Text>
          </Pressable>
        </Animated.View>
      )}

      {(phase === 'matched' || phase === 'riding') && activeRide && (
        <Animated.View entering={SlideInDown.duration(400)} style={[styles.bottomCard, { paddingBottom: bottomInset + 16 }]}>
          <View style={styles.cardHandle} />

          <View style={styles.rideStatusBar}>
            <View style={[styles.rideStatusDot, { backgroundColor: phase === 'riding' ? Colors.primary : Colors.warning }]} />
            <Text style={styles.rideStatusText}>
              {activeRide.status === 'accepted' && 'Driver on the way'}
              {activeRide.status === 'arriving' && 'Driver is arriving'}
              {activeRide.status === 'arrived' && 'Driver has arrived'}
              {activeRide.status === 'in_progress' && 'Ride in progress'}
            </Text>
          </View>

          {driverInfo && (
            <View style={styles.driverCard}>
              <View style={styles.driverAvatar}>
                <Ionicons name="person" size={24} color={Colors.primary} />
              </View>
              <View style={styles.driverDetails}>
                <Text style={styles.driverName}>{driverInfo.fullName}</Text>
                <View style={styles.driverMeta}>
                  <Ionicons name="star" size={14} color={Colors.warning} />
                  <Text style={styles.driverRating}>{(driverInfo.rating || 5.0).toFixed(1)}</Text>
                  {driverInfo.vehicle && (
                    <Text style={styles.driverVehicle}>
                      {VEHICLE_LABELS[driverInfo.vehicle.type as VehicleType]} {driverInfo.vehicle.make || ''} {driverInfo.vehicle.model || ''}
                    </Text>
                  )}
                </View>
                {driverInfo.vehicle && (
                  <Text style={styles.driverPlate}>{driverInfo.vehicle.number}</Text>
                )}
              </View>
            </View>
          )}

          {activeRide.startOtp && activeRide.status !== 'in_progress' && (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.textLight }}>
                Tell your driver this start code when you meet
              </Text>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 34, letterSpacing: 8, color: Colors.text }}>
                {activeRide.startOtp}
              </Text>
            </View>
          )}

          {activeRide.fare && (
            <View style={styles.rideFareRow}>
              <Text style={styles.rideFareLabel}>Fare</Text>
              <Text style={styles.rideFareValue}>{formatINR(activeRide.fare.totalFare)}</Text>
            </View>
          )}

          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            <Pressable
              onPress={handleShare}
              style={({ pressed }) => [{ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.border }, pressed && styles.btnPressed]}
              accessibilityLabel="Share trip"
            >
              <Ionicons name="share-social-outline" size={18} color={Colors.text} />
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: Colors.text }}>Share trip</Text>
            </Pressable>
            <Pressable
              onPress={handleSos}
              style={({ pressed }) => [{ flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.error }, pressed && styles.btnPressed]}
              accessibilityLabel="SOS"
            >
              <Ionicons name="alert-circle" size={18} color="#fff" />
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: '#fff' }}>SOS</Text>
            </Pressable>
          </View>

          {activeRide.status !== 'in_progress' && (
            <Pressable
              style={({ pressed }) => [styles.cancelRideBtn, pressed && styles.btnPressed]}
              onPress={handleCancelRide}
            >
              <Text style={styles.cancelRideBtnText}>Cancel Ride</Text>
            </Pressable>
          )}
        </Animated.View>
      )}

      {phase === 'completed' && activeRide && (
        <Animated.View entering={SlideInDown.duration(400)} style={[styles.bottomCard, { paddingBottom: bottomInset + 16, bottom: keyboardHeight }]}>
          <View style={styles.cardHandle} />
          <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: height * 0.55 }}>
            <View style={styles.completedContent}>
              <View style={styles.completedIcon}>
                <Ionicons name="checkmark-circle" size={48} color={Colors.success} />
              </View>
              <Text style={styles.completedTitle}>Ride Complete!</Text>
              {activeRide.fare && (
                <Text style={styles.completedFare}>{formatINR(activeRide.fare.totalFare)}</Text>
              )}
            </View>

            {!reviewSubmitted ? (
              <View style={styles.reviewSection}>
                <Text style={styles.reviewTitle}>Rate your driver</Text>
                {driverInfo && (
                  <Text style={styles.reviewDriverName}>{driverInfo.fullName}</Text>
                )}
                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Pressable
                      key={star}
                      onPress={() => {
                        setReviewRating(star);
                        if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      }}
                      hitSlop={8}
                    >
                      <Ionicons
                        name={star <= reviewRating ? 'star' : 'star-outline'}
                        size={40}
                        color={star <= reviewRating ? '#FFB800' : Colors.border}
                      />
                    </Pressable>
                  ))}
                </View>
                <TextInput
                  style={styles.reviewInput}
                  placeholder="Leave a private comment for admin (optional)"
                  placeholderTextColor={Colors.textLight}
                  value={reviewComment}
                  onChangeText={setReviewComment}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  maxLength={500}
                />
                <Text style={styles.reviewPrivacyNote}>
                  <Ionicons name="lock-closed" size={11} color={Colors.textLight} /> Your comment is private and only visible to platform admins
                </Text>
                <View style={styles.reviewBtnRow}>
                  <Pressable
                    style={({ pressed }) => [styles.reviewSkipBtn, pressed && styles.btnPressed]}
                    onPress={handleNewRide}
                  >
                    <Ionicons name="arrow-forward" size={20} color={Colors.textLight} />
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.confirmBtn,
                      reviewRating === 0 && styles.btnDisabled,
                      pressed && styles.btnPressed,
                    ]}
                    onPress={submitReview}
                    disabled={reviewRating === 0 || reviewSubmitting}
                  >
                    {reviewSubmitting ? (
                      <ActivityIndicator size="small" color={Colors.secondary} />
                    ) : (
                      <Text style={styles.confirmBtnText}>Submit Review</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={styles.reviewSection}>
                <View style={styles.reviewThanks}>
                  <Ionicons name="heart" size={28} color={Colors.primary} />
                  <Text style={styles.reviewThanksText}>Thank you for your feedback!</Text>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.confirmBtn, { width: '100%' as any }, pressed && styles.btnPressed]}
                  onPress={handleNewRide}
                >
                  <Text style={styles.confirmBtnText}>Request Another Ride</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
        </Animated.View>
      )}

      <AppModal {...modalProps} />
    </View>
  );
}

function FareRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.fareRow}>
      <Text style={[styles.fareRowLabel, highlight && styles.fareHighlight]}>{label}</Text>
      <Text style={[styles.fareRowValue, highlight && styles.fareHighlight]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  loadingContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16,
  },
  loadingText: {
    fontSize: 16, fontFamily: 'Inter_500Medium', color: Colors.textLight,
  },
  permBtn: {
    backgroundColor: Colors.primary, paddingVertical: 14, paddingHorizontal: 28, borderRadius: 14, marginTop: 8,
  },
  permBtnText: {
    fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.secondary,
  },
  topBar: {
    position: 'absolute', left: 16, right: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', zIndex: 10,
  },
  menuBtn: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: Colors.mapOverlay, justifyContent: 'center', alignItems: 'center',
    ...(Platform.OS !== 'web' ? { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 4 } : {}),
  },
  statusChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.mapOverlay, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20,
    ...(Platform.OS !== 'web' ? { shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 4 } : {}),
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.text },
  driverMarker: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.secondary, justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: Colors.primary,
  },
  dropoffMarker: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.accent, justifyContent: 'center', alignItems: 'center',
  },
  bottomCard: {
    position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: Colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 12, zIndex: 5,
    ...(Platform.OS !== 'web' ? { shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 16, elevation: 10 } : {}),
  },
  cardHandle: {
    width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 16,
  },
  cardTitle: {
    fontSize: 20, fontFamily: 'Inter_700Bold', color: Colors.text, marginBottom: 16,
  },
  destinationInput: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.background, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14,
  },
  destinationPlaceholder: {
    fontSize: 15, fontFamily: 'Inter_400Regular', color: Colors.textLight,
  },
  searchRow: {
    flexDirection: 'row', gap: 8, marginBottom: 8,
  },
  searchInput: {
    flex: 1, backgroundColor: Colors.background, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 15, fontFamily: 'Inter_400Regular', color: Colors.text,
  },
  searchBtn: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center',
  },
  orDividerText: {
    fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textLight, textAlign: 'center', marginBottom: 12,
  },
  suggestionsContainer: {
    backgroundColor: Colors.surface, borderRadius: 14, marginBottom: 8, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 14, paddingVertical: 12,
  },
  suggestionBorder: {
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  suggestionPrimary: {
    fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.text,
  },
  suggestionSecondary: {
    fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textLight, marginTop: 2,
  },
  pickupRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12,
  },
  pickupDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary,
  },
  pickupText: {
    fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.text, flex: 1,
  },
  routeInfo: { gap: 4, marginBottom: 16 },
  routePoint: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  routeDivider: {
    width: 2, height: 16, backgroundColor: Colors.border, marginLeft: 4,
  },
  dropoffDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.accent,
  },
  routeText: {
    fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.text, flex: 1,
  },
  tapHint: {
    alignItems: 'center', gap: 8, paddingVertical: 16,
  },
  tapHintText: {
    fontSize: 15, fontFamily: 'Inter_400Regular', color: Colors.textLight,
  },
  btnRow: {
    flexDirection: 'row', gap: 12, marginTop: 4,
  },
  cancelBtn: {
    width: 52, height: 52, borderRadius: 16, backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center',
  },
  confirmBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, paddingVertical: 16, borderRadius: 14,
  },
  confirmBtnText: {
    fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.secondary,
  },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  btnDisabled: { opacity: 0.6 },
  routeNote: { fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.textLight, textAlign: 'center', marginBottom: 8 },
  fareCard: {
    backgroundColor: Colors.background, borderRadius: 16, padding: 16, marginBottom: 16,
  },
  fareMain: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12,
  },
  fareLabel: {
    fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textLight,
  },
  farePrice: {
    fontSize: 28, fontFamily: 'Inter_700Bold', color: Colors.text,
  },
  fareDetails: { gap: 6 },
  fareRow: {
    flexDirection: 'row', justifyContent: 'space-between',
  },
  fareRowLabel: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textLight,
  },
  fareRowValue: {
    fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.text,
  },
  fareHighlight: { color: Colors.primary, fontFamily: 'Inter_600SemiBold' },
  fareDivider: {
    height: 1, backgroundColor: Colors.border, marginVertical: 4,
  },
  waitingContent: {
    alignItems: 'center', gap: 12, paddingVertical: 20,
  },
  waitingTitle: {
    fontSize: 18, fontFamily: 'Inter_600SemiBold', color: Colors.text,
  },
  waitingSubtitle: {
    fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.textLight,
  },
  cancelRideBtn: {
    backgroundColor: 'rgba(255, 59, 48, 0.1)', paddingVertical: 14, borderRadius: 14, alignItems: 'center', marginTop: 8,
  },
  cancelRideBtnText: {
    fontSize: 15, fontFamily: 'Inter_600SemiBold', color: Colors.error,
  },
  rideStatusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16,
  },
  rideStatusDot: {
    width: 10, height: 10, borderRadius: 5,
  },
  rideStatusText: {
    fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.text,
  },
  driverCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.background, borderRadius: 16, padding: 14, marginBottom: 12,
  },
  driverAvatar: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(0, 217, 165, 0.12)', justifyContent: 'center', alignItems: 'center',
  },
  driverDetails: { flex: 1 },
  driverName: {
    fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.text,
  },
  driverMeta: {
    flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2,
  },
  driverRating: {
    fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.text,
  },
  driverVehicle: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: Colors.textLight,
  },
  driverPlate: {
    fontSize: 14, fontFamily: 'Inter_700Bold', color: Colors.primary, marginTop: 2, letterSpacing: 1,
  },
  rideFareRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8,
  },
  rideFareLabel: {
    fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textLight,
  },
  rideFareValue: {
    fontSize: 20, fontFamily: 'Inter_700Bold', color: Colors.text,
  },
  completedContent: {
    alignItems: 'center', gap: 8, paddingVertical: 12, marginBottom: 4,
  },
  completedIcon: { marginBottom: 4 },
  completedTitle: {
    fontSize: 22, fontFamily: 'Inter_700Bold', color: Colors.text,
  },
  completedFare: {
    fontSize: 32, fontFamily: 'Inter_700Bold', color: Colors.primary,
  },
  completedSubtitle: {
    fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.textLight,
  },
  reviewSection: {
    paddingTop: 8, paddingBottom: 4,
  },
  reviewTitle: {
    fontSize: 17, fontFamily: 'Inter_600SemiBold', color: Colors.text, textAlign: 'center', marginBottom: 4,
  },
  reviewDriverName: {
    fontSize: 14, fontFamily: 'Inter_500Medium', color: Colors.textLight, textAlign: 'center', marginBottom: 12,
  },
  starsRow: {
    flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 16,
  },
  reviewInput: {
    backgroundColor: Colors.background, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.text, minHeight: 80, marginBottom: 6,
  },
  reviewPrivacyNote: {
    fontSize: 11, fontFamily: 'Inter_400Regular', color: Colors.textLight, textAlign: 'center', marginBottom: 16,
  },
  reviewBtnRow: {
    flexDirection: 'row', gap: 12,
  },
  reviewSkipBtn: {
    width: 52, height: 52, borderRadius: 16, backgroundColor: Colors.background, justifyContent: 'center', alignItems: 'center',
  },
  reviewThanks: {
    alignItems: 'center', gap: 10, paddingVertical: 20, marginBottom: 16,
  },
  reviewThanksText: {
    fontSize: 16, fontFamily: 'Inter_600SemiBold', color: Colors.text,
  },
});

export default function RiderScreen() {
  if (!roleAllowed('rider')) return <Redirect href="/" />;
  return <RiderScreenInner />;
}
