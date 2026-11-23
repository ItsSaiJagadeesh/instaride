import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator,
  Dimensions, Platform, KeyboardAvoidingView, FlatList, Image,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { searchPlaces } from '@/lib/places';
import { getRideType, calculateIntercityFare } from '@/lib/service-area';

const { width, height } = Dimensions.get('window');

interface LocationCoord {
  lat: number;
  lng: number;
  address: string;
}

interface PlaceSuggestion {
  label: string;
  address: string;
  lat: number;
  lng: number;
  placeId: string;
}

interface RecentPlace {
  id: string;
  address: string;
  lat: number;
  lng: number;
  type: 'pickup' | 'destination';
  timestamp: number;
}

type TripType = 'one-way' | 'round-trip';
type VehicleType = 'bike' | 'auto' | 'car';

export default function RiderBookingScreen() {
  const { user } = useAuth();
  const mapRef = useRef<MapView>(null);
  const locationWatchRef = useRef<Location.LocationSubscription | null>(null);

  // Location state
  const [currentLocation, setCurrentLocation] = useState<LocationCoord | null>(null);
  const [locationPermission, setLocationPermission] = useState<Location.PermissionStatus | null>(null);
  const [locationLoading, setLocationLoading] = useState(true);
  const [locationError, setLocationError] = useState<string | null>(null);

  // Pickup state
  const [pickup, setPickup] = useState<LocationCoord | null>(null);
  const [pickupSearchInput, setPickupSearchInput] = useState('');
  const [pickupSuggestions, setPickupSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showPickupSuggestions, setShowPickupSuggestions] = useState(false);
  const [pickupSearching, setPickupSearching] = useState(false);
  const pickupSearchRef = useRef<NodeJS.Timeout>();

  // Destination state
  const [destination, setDestination] = useState<LocationCoord | null>(null);
  const [destinationSearchInput, setDestinationSearchInput] = useState('');
  const [destinationSuggestions, setDestinationSuggestions] = useState<PlaceSuggestion[]>([]);
  const [showDestinationSuggestions, setShowDestinationSuggestions] = useState(false);
  const [destinationSearching, setDestinationSearching] = useState(false);
  const destinationSearchRef = useRef<NodeJS.Timeout>();

  // Booking options
  const [tripType, setTripType] = useState<TripType>('one-way');
  const [vehicleType, setVehicleType] = useState<VehicleType>('auto');
  const [estimatedFare, setEstimatedFare] = useState(0);
  const [estimatedDuration, setEstimatedDuration] = useState(0);
  const [journeyType, setJourneyType] = useState<'LOCAL' | 'INTERCITY'>('LOCAL');
  const [booking Loading, setBookingLoading] = useState(false);

  // UI state
  const [showIntercityConfirm, setShowIntercityConfirm] = useState(false);
  const [recentPlaces, setRecentPlaces] = useState<RecentPlace[]>([]);

  // ============================================================
  // 1. AUTO LOCATION ON LOGIN
  // ============================================================

  useEffect(() => {
    let isMounted = true;

    const initializeLocation = async () => {
      try {
        setLocationLoading(true);
        setLocationError(null);

        // Request permission once
        const { status } = await Location.requestForegroundPermissionsAsync();
        setLocationPermission(status);

        if (status !== 'granted') {
          setLocationError('Location permission denied');
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
              timeInterval: 1000,
              maxAge: 5000,
            });
          } catch (error) {
            attempts++;
            if (attempts < maxAttempts) {
              // Retry with slight delay
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }

        if (!location) {
          throw new Error('Could not get location after retries');
        }

        const { latitude, longitude } = location.coords;

        // Reverse geocode to get address
        const reverseGeocode = await Location.reverseGeocodeAsync({
          latitude,
          longitude,
        });

        const locationName = reverseGeocode[0]
          ? `${reverseGeocode[0].street || reverseGeocode[0].district || 'Current Location'}`
          : 'Current Location';

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

        // Start watching location for updates
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
        if (isMounted) {
          setLocationError('Could not access your location. Please enable location services.');
        }
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
  // 2. GPS BUTTON: RE-CENTER MAP ON RIDER
  // ============================================================

  const handleRecenterMap = useCallback(async () => {
    if (!currentLocation) return;

    mapRef.current?.animateToRegion({
      latitude: currentLocation.lat,
      longitude: currentLocation.lng,
      latitudeDelta: 0.05,
      longitudeDelta: 0.05,
    }, 500);
  }, [currentLocation]);

  // ============================================================
  // PICKUP LOCATION SEARCH
  // ============================================================

  const handlePickupSearch = useCallback((text: string) => {
    setPickupSearchInput(text);
    setShowPickupSuggestions(true);

    if (pickupSearchRef.current) clearTimeout(pickupSearchRef.current);

    if (!text || text.length < 2) {
      setPickupSuggestions([]);
      return;
    }

    setPickupSearching(true);
    pickupSearchRef.current = setTimeout(async () => {
      try {
        const results = await searchPlaces(text, currentLocation?.lat, currentLocation?.lng);
        setPickupSuggestions(results || []);
      } catch (error) {
        console.error('Pickup search error:', error);
        setPickupSuggestions([]);
      } finally {
        setPickupSearching(false);
      }
    }, 300);
  }, [currentLocation]);

  const handlePickupSelect = useCallback((suggestion: PlaceSuggestion) => {
    setPickup({
      lat: suggestion.lat,
      lng: suggestion.lng,
      address: suggestion.label,
    });
    setPickupSearchInput(suggestion.label);
    setShowPickupSuggestions(false);
    setPickupSuggestions([]);
  }, []);

  // ============================================================
  // DESTINATION LOCATION SEARCH (Rapido-style)
  // ============================================================

  const handleDestinationSearch = useCallback((text: string) => {
    setDestinationSearchInput(text);
    setShowDestinationSuggestions(true);

    if (destinationSearchRef.current) clearTimeout(destinationSearchRef.current);

    if (!text || text.length < 2) {
      setDestinationSuggestions([]);
      return;
    }

    setDestinationSearching(true);
    destinationSearchRef.current = setTimeout(async () => {
      try {
        const results = await searchPlaces(text, pickup?.lat, pickup?.lng);
        setDestinationSuggestions(results || []);
      } catch (error) {
        console.error('Destination search error:', error);
        setDestinationSuggestions([]);
      } finally {
        setDestinationSearching(false);
      }
    }, 300);
  }, [pickup]);

  const handleDestinationSelect = useCallback((suggestion: PlaceSuggestion) => {
    setDestination({
      lat: suggestion.lat,
      lng: suggestion.lng,
      address: suggestion.label,
    });
    setDestinationSearchInput(suggestion.label);
    setShowDestinationSuggestions(false);
    setDestinationSuggestions([]);

    // Check if intercity
    if (pickup) {
      const type = getRideType(pickup.lat, pickup.lng, suggestion.lat, suggestion.lng);
      setJourneyType(type);

      if (type === 'INTERCITY') {
        const fare = calculateIntercityFare(
          pickup.lat,
          pickup.lng,
          suggestion.lat,
          suggestion.lng,
          vehicleType
        );
        setEstimatedFare(fare);
        setShowIntercityConfirm(true);
      }
    }
  }, [pickup, vehicleType]);

  // ============================================================
  // ESTIMATE FARE
  // ============================================================

  useEffect(() => {
    if (!pickup || !destination) return;

    // Simple fare calculation (replace with actual backend API)
    const distance = calculateDistance(pickup.lat, pickup.lng, destination.lat, destination.lng);
    const baseFares: Record<VehicleType, number> = {
      bike: 20,
      auto: 30,
      car: 50,
    };
    const perKmRates: Record<VehicleType, number> = {
      bike: 10,
      auto: 12,
      car: 15,
    };

    const baseFare = baseFares[vehicleType];
    const distanceFare = distance * perKmRates[vehicleType];
    const fare = baseFare + distanceFare;

    setEstimatedFare(fare);
    setEstimatedDuration(Math.ceil(distance * 2.5)); // Rough estimate: 2.5 min per km
  }, [pickup, destination, vehicleType]);

  // ============================================================
  // REQUEST RIDE
  // ============================================================

  const handleRequestRide = useCallback(async () => {
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
          journeyType,
          tripType,
          estimatedFare,
          estimatedDuration,
        }),
      });

      if (!response.ok) throw new Error('Booking failed');

      const { rideId } = await response.json();

      // Save to recent places
      const newRecent: RecentPlace[] = [
        {
          id: `${Date.now()}-pickup`,
          address: pickup.address,
          lat: pickup.lat,
          lng: pickup.lng,
          type: 'pickup',
          timestamp: Date.now(),
        },
        {
          id: `${Date.now()}-dest`,
          address: destination.address,
          lat: destination.lat,
          lng: destination.lng,
          type: 'destination',
          timestamp: Date.now(),
        },
        ...recentPlaces.slice(0, 8),
      ];
      setRecentPlaces(newRecent);

      router.push({ pathname: '/rider/ride', params: { rideId } });
    } catch (error) {
      console.error('Booking error:', error);
      alert('Failed to request ride');
    } finally {
      setBookingLoading(false);
    }
  }, [pickup, destination, vehicleType, journeyType, tripType, estimatedFare, estimatedDuration, recentPlaces]);

  // ============================================================
  // RENDER: PICKUP SUGGESTIONS
  // ============================================================

  const PickupSuggestionsComponent = () => (
    <View style={styles.suggestionsContainer}>
      {pickupSearching ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={Colors.primary} />
          <Text style={styles.loadingText}>Searching...</Text>
        </View>
      ) : pickupSuggestions.length > 0 ? (
        <FlatList
          scrollEnabled={false}
          data={pickupSuggestions}
          keyExtractor={(_, idx) => idx.toString()}
          renderItem={({ item }) => (
            <Pressable
              style={styles.suggestionItem}
              onPress={() => handlePickupSelect(item)}
            >
              <Ionicons name="location-outline" size={16} color={Colors.primary} />
              <View style={styles.suggestionText}>
                <Text style={styles.suggestionLabel}>{item.label}</Text>
                <Text style={styles.suggestionAddress}>{item.address}</Text>
              </View>
            </Pressable>
          )}
        />
      ) : pickupSearchInput.length > 1 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No locations found</Text>
        </View>
      ) : null}
    </View>
  );

  // ============================================================
  // RENDER: DESTINATION SUGGESTIONS (Rapido-style)
  // ============================================================

  const DestinationSuggestionsComponent = () => (
    <View style={styles.suggestionsContainer}>
      {destinationSearching ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      ) : (
        <>
          {/* Recent places */}
          {!destinationSearchInput && recentPlaces.length > 0 && (
            <>
              <Text style={styles.recentPlacesTitle}>Recent Places</Text>
              <FlatList
                scrollEnabled={false}
                data={recentPlaces.slice(0, 4)}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.recentPlaceItem}
                    onPress={() =>
                      handleDestinationSelect({
                        label: item.address,
                        address: item.address,
                        lat: item.lat,
                        lng: item.lng,
                        placeId: item.id,
                      })
                    }
                  >
                    <Ionicons name="time-outline" size={16} color={Colors.textLight} />
                    <Text style={styles.recentPlaceText}>{item.address}</Text>
                  </Pressable>
                )}
              />
            </>
          )}

          {/* Search results */}
          {destinationSearchInput && destinationSuggestions.length > 0 && (
            <FlatList
              scrollEnabled={false}
              data={destinationSuggestions}
              keyExtractor={(_, idx) => idx.toString()}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.suggestionItem}
                  onPress={() => handleDestinationSelect(item)}
                >
                  <Ionicons name="location-outline" size={16} color={Colors.primary} />
                  <View style={styles.suggestionText}>
                    <Text style={styles.suggestionLabel}>{item.label}</Text>
                    <Text style={styles.suggestionAddress}>{item.address}</Text>
                  </View>
                </Pressable>
              )}
            />
          )}

          {/* Empty state */}
          {destinationSearchInput.length > 1 && destinationSuggestions.length === 0 && (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No locations found</Text>
            </View>
          )}
        </>
      )}
    </View>
  );

  // ============================================================
  // MAIN RENDER
  // ============================================================

  if (locationLoading) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color={Colors.primary} />
        <Text style={styles.loadingMessage}>Getting your location...</Text>
      </View>
    );
  }

  if (locationError) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <Ionicons name="alert-circle-outline" size={48} color={Colors.danger} />
        <Text style={styles.errorText}>{locationError}</Text>
        <Pressable style={styles.retryButton} onPress={() => window.location.reload()}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
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
        showsUserLocation={true}
        followsUserLocation={false}
      >
        {pickup && <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} />}
        {destination && <Marker coordinate={{ latitude: destination.lat, longitude: destination.lng }} />}
      </MapView>

      {/* GPS Re-center Button */}
      <Pressable style={styles.gpsButton} onPress={handleRecenterMap}>
        <Ionicons name="locate" size={24} color={Colors.primary} />
      </Pressable>

      {/* Booking Panel */}
      <View style={styles.bookingPanel}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Trip Type Selector */}
          <View style={styles.tripTypeSelector}>
            <Pressable
              style={[styles.tripTypeButton, tripType === 'one-way' && styles.tripTypeButtonActive]}
              onPress={() => setTripType('one-way')}
            >
              <Text style={[styles.tripTypeText, tripType === 'one-way' && styles.tripTypeTextActive]}>
                One-way
              </Text>
            </Pressable>
            <Pressable
              style={[styles.tripTypeButton, tripType === 'round-trip' && styles.tripTypeButtonActive]}
              onPress={() => setTripType('round-trip')}
            >
              <Text style={[styles.tripTypeText, tripType === 'round-trip' && styles.tripTypeTextActive]}>
                Round-trip
              </Text>
            </Pressable>
          </View>

          {/* Pickup Location */}
          <View style={styles.locationInputGroup}>
            <View style={styles.locationInputWrapper}>
              <Ionicons name="location" size={20} color={Colors.primary} />
              <TextInput
                style={styles.locationInput}
                placeholder="Pickup location"
                value={pickupSearchInput}
                onChangeText={handlePickupSearch}
                onFocus={() => setShowPickupSuggestions(true)}
                placeholderTextColor={Colors.textExtraLight}
              />
              {pickup && (
                <Pressable onPress={() => { setPickup(null); setPickupSearchInput(''); }}>
                  <Ionicons name="close-circle" size={20} color={Colors.textLight} />
                </Pressable>
              )}
            </View>
            {showPickupSuggestions && <PickupSuggestionsComponent />}
          </View>

          {/* Destination Location (Rapido-style) */}
          <View style={styles.locationInputGroup}>
            <View style={styles.locationInputWrapper}>
              <Ionicons name="location-sharp" size={20} color={Colors.danger} />
              <TextInput
                style={styles.locationInput}
                placeholder="Where do you want to go?"
                value={destinationSearchInput}
                onChangeText={handleDestinationSearch}
                onFocus={() => setShowDestinationSuggestions(true)}
                placeholderTextColor={Colors.textExtraLight}
              />
              {destination && (
                <Pressable onPress={() => { setDestination(null); setDestinationSearchInput(''); }}>
                  <Ionicons name="close-circle" size={20} color={Colors.textLight} />
                </Pressable>
              )}
            </View>
            {showDestinationSuggestions && <DestinationSuggestionsComponent />}
          </View>

          {/* Vehicle Selection */}
          {destination && (
            <>
              <Text style={styles.sectionLabel}>Select a {vehicleType}</Text>
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
                      color={vehicleType === type ? Colors.white : Colors.textLight}
                    />
                    <Text style={[styles.vehicleLabel, vehicleType === type && styles.vehicleLabelActive]}>
                      {type.charAt(0).toUpperCase() + type.slice(1)}
                    </Text>
                    <Text style={[styles.vehiclePrice, vehicleType === type && styles.vehiclePriceActive]}>
                      ₹{estimatedFare.toFixed(0)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}

          {/* Request Button */}
          {destination && (
            <Pressable
              style={[styles.requestButton, bookingLoading && styles.requestButtonDisabled]}
              onPress={handleRequestRide}
              disabled={bookingLoading}
            >
              {bookingLoading ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <>
                  <Ionicons name="car" size={20} color={Colors.white} />
                  <Text style={styles.requestButtonText}>
                    Request {vehicleType} • ₹{estimatedFare.toFixed(0)}
                  </Text>
                </>
              )}
            </Pressable>
          )}

          {/* Schedule Link */}
          <Pressable style={styles.scheduleLink} onPress={() => router.push('/rider/schedule')}>
            <Ionicons name="calendar" size={16} color={Colors.primary} />
            <Text style={styles.scheduleLinkText}>Schedule a Ride</Text>
          </Pressable>
        </ScrollView>
      </View>

      {/* Intercity Confirmation Modal */}
      {showIntercityConfirm && destination && (
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Pressable style={styles.closeButton} onPress={() => setShowIntercityConfirm(false)}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </Pressable>

            <Text style={styles.modalTitle}>Intercity Ride</Text>
            <Text style={styles.modalMessage}>
              Your destination is outside the local service area. Continue with intercity pricing?
            </Text>

            <View style={styles.modalFareDetails}>
              <View style={styles.modalFareRow}>
                <Text style={styles.modalFareLabel}>Estimated Fare</Text>
                <Text style={styles.modalFareValue}>₹{estimatedFare.toFixed(2)}</Text>
              </View>
              <View style={styles.modalFareRow}>
                <Text style={styles.modalFareLabel}>Estimated Time</Text>
                <Text style={styles.modalFareValue}>{estimatedDuration} mins</Text>
              </View>
            </View>

            <View style={styles.modalButtons}>
              <Pressable
                style={styles.modalButtonCancel}
                onPress={() => setShowIntercityConfirm(false)}
              >
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.modalButtonConfirm}
                onPress={() => {
                  setShowIntercityConfirm(false);
                  handleRequestRide();
                }}
              >
                <Text style={styles.modalButtonConfirmText}>Continue</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
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

// ============================================================
// STYLES
// ============================================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centerContent: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  map: {
    flex: 1,
  },
  gpsButton: {
    position: 'absolute',
    bottom: height * 0.42,
    right: 16,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Colors.white,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  bookingPanel: {
    maxHeight: height * 0.5,
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  tripTypeSelector: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  tripTypeButton: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  tripTypeButtonActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  tripTypeText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    textAlign: 'center',
  },
  tripTypeTextActive: {
    color: Colors.white,
  },
  locationInputGroup: {
    marginBottom: 12,
  },
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
  locationInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
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
  suggestionText: {
    flex: 1,
  },
  suggestionLabel: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  suggestionAddress: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: Colors.textLight,
    marginTop: 2,
  },
  recentPlacesTitle: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.textLight,
    paddingHorizontal: 12,
    paddingVertical: 8,
    textTransform: 'uppercase',
  },
  recentPlaceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  recentPlaceText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textLight,
  },
  emptyState: {
    paddingVertical: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textLight,
  },
  sectionLabel: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginVertical: 12,
  },
  vehicleGrid: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
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
  vehicleOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  vehicleLabel: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  vehicleLabelActive: {
    color: Colors.white,
  },
  vehiclePrice: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: Colors.textLight,
  },
  vehiclePriceActive: {
    color: Colors.white,
  },
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
  requestButtonDisabled: {
    opacity: 0.6,
  },
  requestButtonText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.white,
  },
  scheduleLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    marginBottom: 16,
  },
  scheduleLinkText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.primary,
  },
  loadingMessage: {
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
    marginTop: 12,
  },
  errorText: {
    fontSize: 16,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
    marginTop: 12,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 12,
    backgroundColor: Colors.primary,
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.white,
  },
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 24,
    paddingBottom: 32,
  },
  closeButton: {
    alignSelf: 'flex-end',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: Colors.text,
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textLight,
    marginBottom: 16,
    lineHeight: 20,
  },
  modalFareDetails: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 16,
    gap: 8,
  },
  modalFareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  modalFareLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textLight,
  },
  modalFareValue: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  modalButtonCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  modalButtonCancelText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    textAlign: 'center',
  },
  modalButtonConfirm: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.primary,
  },
  modalButtonConfirmText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.white,
    textAlign: 'center',
  },
});
