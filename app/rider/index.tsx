import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator,
  Dimensions, Platform, KeyboardAvoidingView, FlatList, TextInput,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { searchPlaces, type Place } from '@/lib/places';

const { width, height } = Dimensions.get('window');

interface LocationCoord {
  lat: number;
  lng: number;
  address: string;
}

type TripType = 'one-way' | 'round-trip';
type VehicleType = 'bike' | 'auto' | 'car';

export default function RiderBookingScreen() {
  const { user } = useAuth();
  const mapRef = useRef<MapView>(null);
  const locationWatchRef = useRef<Location.LocationSubscription | null>(null);

  // Location state
  const [currentLocation, setCurrentLocation] = useState<LocationCoord | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);

  // Pickup state
  const [pickup, setPickup] = useState<LocationCoord | null>(null);
  const [pickupSearchInput, setPickupSearchInput] = useState('');
  const [pickupSuggestions, setPickupSuggestions] = useState<Place[]>([]);
  const [showPickupSuggestions, setShowPickupSuggestions] = useState(false);
  const pickupSearchRef = useRef<NodeJS.Timeout | null>(null);

  // Destination state
  const [destination, setDestination] = useState<LocationCoord | null>(null);
  const [destinationSearchInput, setDestinationSearchInput] = useState('');
  const [destinationSuggestions, setDestinationSuggestions] = useState<Place[]>([]);
  const [showDestinationSuggestions, setShowDestinationSuggestions] = useState(false);
  const destinationSearchRef = useRef<NodeJS.Timeout | null>(null);

  // Booking options
  const [tripType, setTripType] = useState<TripType>('one-way');
  const [vehicleType, setVehicleType] = useState<VehicleType>('auto');
  const [estimatedFare, setEstimatedFare] = useState(0);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [recentPlaces, setRecentPlaces] = useState<LocationCoord[]>([]);

  // ============================================================
  // 1. AUTO LOCATION ON LOGIN
  // ============================================================

  useEffect(() => {
    let isMounted = true;

    const initializeLocation = async () => {
      try {
        setLocationLoading(true);

        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setLocationLoading(false);
          return;
        }

        // Get high-accuracy location with retry
        let location = null;
        let attempts = 0;
        const maxAttempts = 3;

        while (!location && attempts < maxAttempts) {
          try {
            location = await Location.getCurrentPositionAsync({
              accuracy: Location.Accuracy.High,
            });
          } catch (error) {
            attempts++;
            if (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }

        if (!location) {
          setLocationLoading(false);
          return;
        }

        const { latitude, longitude } = location.coords;

        // Reverse geocode to get address
        const reverseGeocode = await Location.reverseGeocodeAsync({
          latitude,
          longitude,
        });

        const locationName = reverseGeocode[0]?.street || 'Current Location';

        const userLocation: LocationCoord = {
          lat: latitude,
          lng: longitude,
          address: locationName,
        };

        if (isMounted) {
          setCurrentLocation(userLocation);
          setPickup(userLocation);
          setPickupSearchInput(locationName);
        }

        // Start watching location
        locationWatchRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 5000,
            distanceInterval: 10,
          },
          (newLocation) => {
            if (isMounted) {
              setCurrentLocation({
                lat: newLocation.coords.latitude,
                lng: newLocation.coords.longitude,
                address: pickup?.address || 'Current Location',
              });
            }
          }
        );
      } catch (error) {
        console.error('Location error:', error);
      } finally {
        if (isMounted) {
          setLocationLoading(false);
        }
      }
    };

    initializeLocation();

    return () => {
      isMounted = false;
      if (locationWatchRef.current) {
        locationWatchRef.current.remove();
      }
    };
  }, []);

  // ============================================================
  // 2. GPS RE-CENTER BUTTON
  // ============================================================

  const handleRecenterMap = () => {
    if (!currentLocation) return;
    mapRef.current?.animateToRegion({
      latitude: currentLocation.lat,
      longitude: currentLocation.lng,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    }, 500);
  };

  // ============================================================
  // PICKUP LOCATION SEARCH
  // ============================================================

  const handlePickupSearch = (text: string) => {
    setPickupSearchInput(text);
    setShowPickupSuggestions(true);

    if (pickupSearchRef.current) clearTimeout(pickupSearchRef.current);

    if (!text || text.length < 2) {
      setPickupSuggestions([]);
      return;
    }

    pickupSearchRef.current = setTimeout(async () => {
      try {
        const results = await searchPlaces(text, currentLocation || undefined);
        setPickupSuggestions(results || []);
      } catch (error) {
        console.error('Pickup search error:', error);
        setPickupSuggestions([]);
      }
    }, 300);
  };

  const handlePickupSelect = (place: Place) => {
    setPickup({
      lat: place.lat,
      lng: place.lng,
      address: place.label,
    });
    setPickupSearchInput(place.label);
    setShowPickupSuggestions(false);
  };

  // ============================================================
  // DESTINATION SEARCH (Rapido-style)
  // ============================================================

  const handleDestinationSearch = (text: string) => {
    setDestinationSearchInput(text);
    setShowDestinationSuggestions(true);

    if (destinationSearchRef.current) clearTimeout(destinationSearchRef.current);

    if (!text || text.length < 2) {
      setDestinationSuggestions([]);
      return;
    }

    destinationSearchRef.current = setTimeout(async () => {
      try {
        const results = await searchPlaces(text, pickup || undefined);
        setDestinationSuggestions(results || []);
      } catch (error) {
        console.error('Destination search error:', error);
        setDestinationSuggestions([]);
      }
    }, 300);
  };

  const handleDestinationSelect = (place: Place) => {
    setDestination({
      lat: place.lat,
      lng: place.lng,
      address: place.label,
    });
    setDestinationSearchInput(place.label);
    setShowDestinationSuggestions(false);
  };

  // ============================================================
  // ESTIMATE FARE
  // ============================================================

  useEffect(() => {
    if (!pickup || !destination) return;

    const distance = calculateDistance(pickup.lat, pickup.lng, destination.lat, destination.lng);
    const baseFares: Record<VehicleType, number> = { bike: 20, auto: 30, car: 50 };
    const perKmRates: Record<VehicleType, number> = { bike: 10, auto: 12, car: 15 };

    const fare = baseFares[vehicleType] + (distance * perKmRates[vehicleType]);
    setEstimatedFare(fare);
  }, [pickup, destination, vehicleType]);

  // ============================================================
  // REQUEST RIDE
  // ============================================================

  const handleRequestRide = async () => {
    if (!pickup || !destination) {
      alert('Please select both pickup and destination');
      return;
    }

    setBookingLoading(true);
    try {
      const response = await fetch('/api/rider/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          pickupAddress: pickup.address,
          destinationLat: destination.lat,
          destinationLng: destination.lng,
          destinationAddress: destination.address,
          vehicleType,
          tripType,
          estimatedFare,
        }),
      });

      if (!response.ok) throw new Error('Booking failed');

      const { rideId } = await response.json();

      // Save to recent places
      const newRecent = [
        destination,
        ...recentPlaces.filter(p => p.address !== destination.address).slice(0, 4),
      ];
      setRecentPlaces(newRecent);

      router.push({ pathname: '/rider/ride', params: { rideId } });
    } catch (error) {
      console.error('Booking error:', error);
      alert('Failed to request ride');
    } finally {
      setBookingLoading(false);
    }
  };

  // ============================================================
  // RENDER
  // ============================================================

  if (locationLoading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={{ marginTop: 12, color: Colors.text }}>Getting your location...</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.container}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: currentLocation?.lat || 17.3521,
          longitude: currentLocation?.lng || 80.8341,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        showsUserLocation
      >
        {pickup && <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} />}
        {destination && <Marker coordinate={{ latitude: destination.lat, longitude: destination.lng }} />}
      </MapView>

      {/* GPS Button */}
      <Pressable style={styles.gpsButton} onPress={handleRecenterMap}>
        <Ionicons name="locate" size={24} color={Colors.primary} />
      </Pressable>

      {/* Booking Panel */}
      <View style={styles.bookingPanel}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Trip Type */}
          <View style={styles.tripTypeSelector}>
            {(['one-way', 'round-trip'] as const).map((type) => (
              <Pressable
                key={type}
                style={[styles.tripTypeButton, tripType === type && styles.tripTypeButtonActive]}
                onPress={() => setTripType(type)}
              >
                <Text style={[styles.tripTypeText, tripType === type && styles.tripTypeTextActive]}>
                  {type === 'one-way' ? 'One-way' : 'Round-trip'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Pickup */}
          <View style={styles.locationInputGroup}>
            <View style={styles.locationInputWrapper}>
              <Ionicons name="location" size={20} color={Colors.primary} />
              <TextInput
                style={styles.locationInput}
                placeholder="Pickup location"
                value={pickupSearchInput}
                onChangeText={handlePickupSearch}
                onFocus={() => setShowPickupSuggestions(true)}
                placeholderTextColor={Colors.textLight}
              />
            </View>
            {showPickupSuggestions && pickupSuggestions.length > 0 && (
              <View style={styles.suggestionsContainer}>
                {pickupSuggestions.map((place, idx) => (
                  <Pressable
                    key={`${place.label}-${idx}`}
                    style={styles.suggestionItem}
                    onPress={() => handlePickupSelect(place)}
                  >
                    <Ionicons name="location-outline" size={16} color={Colors.primary} />
                    <View style={styles.suggestionText}>
                      <Text style={styles.suggestionLabel}>{place.label}</Text>
                      <Text style={styles.suggestionAddress}>{place.address}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* Destination */}
          <View style={styles.locationInputGroup}>
            <View style={styles.locationInputWrapper}>
              <Ionicons name="location-sharp" size={20} color={Colors.error} />
              <TextInput
                style={styles.locationInput}
                placeholder="Where do you want to go?"
                value={destinationSearchInput}
                onChangeText={handleDestinationSearch}
                onFocus={() => setShowDestinationSuggestions(true)}
                placeholderTextColor={Colors.textLight}
              />
            </View>
            {showDestinationSuggestions && (
              <View style={styles.suggestionsContainer}>
                {!destinationSearchInput && recentPlaces.length > 0 && (
                  <>
                    <Text style={styles.recentPlacesTitle}>Recent</Text>
                    {recentPlaces.slice(0, 4).map((place, idx) => (
                      <Pressable
                        key={`recent-${idx}`}
                        style={styles.suggestionItem}
                        onPress={() =>
                          handleDestinationSelect({
                            lat: place.lat,
                            lng: place.lng,
                            label: place.address,
                            address: place.address,
                          })
                        }
                      >
                        <Ionicons name="time-outline" size={16} color={Colors.textLight} />
                        <Text style={styles.recentPlaceText}>{place.address}</Text>
                      </Pressable>
                    ))}
                  </>
                )}
                {destinationSearchInput && destinationSuggestions.length > 0 && (
                  destinationSuggestions.map((place, idx) => (
                    <Pressable
                      key={`${place.label}-${idx}`}
                      style={styles.suggestionItem}
                      onPress={() => handleDestinationSelect(place)}
                    >
                      <Ionicons name="location-outline" size={16} color={Colors.primary} />
                      <View style={styles.suggestionText}>
                        <Text style={styles.suggestionLabel}>{place.label}</Text>
                        <Text style={styles.suggestionAddress}>{place.address}</Text>
                      </View>
                    </Pressable>
                  ))
                )}
              </View>
            )}
          </View>

          {/* Vehicle Selection */}
          {destination && (
            <>
              <Text style={styles.sectionLabel}>Select Vehicle</Text>
              <View style={styles.vehicleGrid}>
                {(['bike', 'auto', 'car'] as const).map((type) => (
                  <Pressable
                    key={type}
                    style={[styles.vehicleOption, vehicleType === type && styles.vehicleOptionActive]}
                    onPress={() => setVehicleType(type)}
                  >
                    <Ionicons
                      name={type === 'bike' ? 'bicycle' : 'car'}
                      size={24}
                      color={vehicleType === type ? Colors.textWhite : Colors.textLight}
                    />
                    <Text style={[styles.vehicleLabel, vehicleType === type && styles.vehicleLabelActive]}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </Text>
                    <Text style={[styles.vehiclePrice, vehicleType === type && styles.vehiclePriceActive]}>
                      â‚¹{estimatedFare.toFixed(0)}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {/* Request Button */}
              <Pressable
                style={[styles.requestButton, bookingLoading && { opacity: 0.6 }]}
                onPress={handleRequestRide}
                disabled={bookingLoading}
              >
                {bookingLoading ? (
                  <ActivityIndicator color={Colors.textWhite} />
                ) : (
                  <>
                    <Ionicons name="car" size={20} color={Colors.textWhite} />
                    <Text style={styles.requestButtonText}>
                      Request {vehicleType} â€¢ â‚¹{estimatedFare.toFixed(0)}
                    </Text>
                  </>
                )}
              </Pressable>

              {/* Schedule Link */}
              <Pressable style={styles.scheduleLink} onPress={() => router.push('/rider/schedule')}>
                <Ionicons name="calendar" size={16} color={Colors.primary} />
                <Text style={styles.scheduleLinkText}>Schedule a Ride</Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) *
    Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  map: { flex: 1 },
  gpsButton: {
    position: 'absolute',
    bottom: height * 0.42,
    right: 16,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    elevation: 4,
  },
  bookingPanel: {
    maxHeight: height * 0.5,
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
    elevation: 5,
  },
  tripTypeSelector: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tripTypeButton: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  tripTypeButtonActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  tripTypeText: { fontSize: 13, color: Colors.text, textAlign: 'center', fontWeight: '600' },
  tripTypeTextActive: { color: Colors.textWhite },
  locationInputGroup: { marginBottom: 12 },
  locationInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.inputBackground,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 12,
    height: 48,
    gap: 8,
  },
  locationInput: { flex: 1, fontSize: 15, color: Colors.text, paddingVertical: 12 },
  suggestionsContainer: {
    backgroundColor: Colors.background,
    borderRadius: 12,
    marginTop: 4,
    maxHeight: 300,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  suggestionText: { flex: 1 },
  suggestionLabel: { fontSize: 14, color: Colors.text, fontWeight: '600' },
  suggestionAddress: { fontSize: 12, color: Colors.textLight, marginTop: 2 },
  recentPlacesTitle: { fontSize: 12, color: Colors.textLight, paddingHorizontal: 12, paddingVertical: 8, fontWeight: '600' },
  recentPlaceText: { fontSize: 14, color: Colors.text, fontWeight: '500' },
  sectionLabel: { fontSize: 14, color: Colors.text, marginVertical: 12, fontWeight: '600' },
  vehicleGrid: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  vehicleOption: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    gap: 4,
  },
  vehicleOptionActive: { borderColor: Colors.primary, backgroundColor: Colors.primary },
  vehicleLabel: { fontSize: 12, color: Colors.text, fontWeight: '600' },
  vehicleLabelActive: { color: Colors.textWhite },
  vehiclePrice: { fontSize: 11, color: Colors.textLight, fontWeight: '500' },
  vehiclePriceActive: { color: Colors.textWhite },
  requestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    borderRadius: 12,
    marginVertical: 12,
  },
  requestButtonText: { fontSize: 15, color: Colors.textWhite, fontWeight: '600' },
  scheduleLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    marginBottom: 16,
  },
  scheduleLinkText: { fontSize: 14, color: Colors.primary, fontWeight: '600' },
});
