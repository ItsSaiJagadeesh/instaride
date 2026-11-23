import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator,
  Dimensions, Platform, KeyboardAvoidingView,
} from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker } from 'react-native-maps';
import Colors from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import LocationPicker from '@/components/LocationPicker';
import { getRideType, calculateIntercityFare } from '@/lib/service-area';

const { width, height } = Dimensions.get('window');

interface RideRequest {
  pickupLat: number;
  pickupLng: number;
  pickupAddress: string;
  destinationLat: number;
  destinationLng: number;
  destinationAddress: string;
  vehicleType: 'bike' | 'auto' | 'car';
  journeyType: 'LOCAL' | 'INTERCITY';
}

export default function RiderHomeScreen() {
  const { user } = useAuth();
  const [currentLocation, setCurrentLocation] = useState({ lat: 17.3521, lng: 80.8341 });
  const [pickupAddress, setPickupAddress] = useState('Current Location');
  const [pickupLat, setPickupLat] = useState(17.3521);
  const [pickupLng, setPickupLng] = useState(80.8341);
  const [destinationAddress, setDestinationAddress] = useState('');
  const [destinationLat, setDestinationLat] = useState<number | null>(null);
  const [destinationLng, setDestinationLng] = useState<number | null>(null);
  const [vehicleType, setVehicleType] = useState<'bike' | 'auto' | 'car'>('auto');
  const [loading, setLoading] = useState(false);
  const [showIntercityConfirmation, setShowIntercityConfirmation] = useState(false);
  const [estimatedFare, setEstimatedFare] = useState(0);
  const mapRef = useRef(null);

  // Handle pickup location change
  const handlePickupChange = useCallback((address: string, lat: number, lng: number) => {
    setPickupAddress(address);
    setPickupLat(lat);
    setPickupLng(lng);
  }, []);

  // Handle destination location change
  const handleDestinationChange = useCallback((address: string, lat: number, lng: number) => {
    setDestinationAddress(address);
    setDestinationLat(lat);
    setDestinationLng(lng);
  }, []);

  // Check if destination is outside service area
  const handleRequestRide = useCallback(async () => {
    if (!destinationAddress || destinationLat === null || destinationLng === null) {
      alert('Please select a destination');
      return;
    }

    const journeyType = getRideType(pickupLat, pickupLng, destinationLat, destinationLng);

    if (journeyType === 'INTERCITY') {
      // Show intercity confirmation
      const fare = calculateIntercityFare(
        pickupLat,
        pickupLng,
        destinationLat,
        destinationLng,
        vehicleType
      );
      setEstimatedFare(fare);
      setShowIntercityConfirmation(true);
      return;
    }

    // Proceed with local ride
    setLoading(true);
    try {
      const response = await fetch('/api/rider/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickupLat,
          pickupLng,
          pickupAddress,
          destinationLat,
          destinationLng,
          destinationAddress,
          vehicleType,
          journeyType: 'LOCAL',
        }),
      });

      if (!response.ok) throw new Error('Booking failed');

      const { rideId } = await response.json();
      router.push({ pathname: '/rider/ride', params: { rideId } });
    } catch (error) {
      console.error('Booking error:', error);
      alert('Failed to request ride');
    } finally {
      setLoading(false);
    }
  }, [
    pickupLat, pickupLng, pickupAddress,
    destinationLat, destinationLng, destinationAddress,
    vehicleType
  ]);

  // Handle intercity confirmation
  const handleIntercityConfirm = useCallback(async () => {
    if (!destinationLat || !destinationLng) return;

    setLoading(true);
    try {
      const response = await fetch('/api/rider/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pickupLat,
          pickupLng,
          pickupAddress,
          destinationLat,
          destinationLng,
          destinationAddress,
          vehicleType,
          journeyType: 'INTERCITY',
          estimatedFare,
        }),
      });

      if (!response.ok) throw new Error('Booking failed');

      const { rideId } = await response.json();
      router.push({ pathname: '/rider/ride', params: { rideId } });
      setShowIntercityConfirmation(false);
    } catch (error) {
      console.error('Intercity booking error:', error);
      alert('Failed to request intercity ride');
    } finally {
      setLoading(false);
    }
  }, [pickupLat, pickupLng, pickupAddress, destinationLat, destinationLng, destinationAddress, vehicleType, estimatedFare]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={{
            latitude: pickupLat,
            longitude: pickupLng,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
        >
          <Marker coordinate={{ latitude: pickupLat, longitude: pickupLng }} />
          {destinationLat && destinationLng && (
            <Marker coordinate={{ latitude: destinationLat, longitude: destinationLng }} />
          )}
        </MapView>
      </View>

      <View style={styles.bookingPanel}>
        <ScrollView showsVerticalScrollIndicator={false}>
          {/* Location Pickers */}
          <LocationPicker
            label="From"
            placeholder="Enter pickup location"
            value={pickupAddress}
            lat={pickupLat}
            lng={pickupLng}
            onLocationChange={handlePickupChange}
            currentLocation={currentLocation}
          />

          <LocationPicker
            label="To"
            placeholder="Enter destination"
            value={destinationAddress}
            lat={destinationLat || undefined}
            lng={destinationLng || undefined}
            onLocationChange={handleDestinationChange}
          />

          {/* Vehicle Selection */}
          <View style={styles.vehicleSection}>
            <Text style={styles.sectionLabel}>Vehicle Type</Text>
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
                    color={vehicleType === type ? Colors.primary : Colors.textLight}
                  />
                  <Text style={[styles.vehicleLabel, vehicleType === type && styles.vehicleLabelActive]}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {/* Request Button */}
          <Pressable
            style={[styles.requestButton, (loading || !destinationAddress) && styles.requestButtonDisabled]}
            onPress={handleRequestRide}
            disabled={loading || !destinationAddress}
          >
            {loading ? (
              <ActivityIndicator color={Colors.white} />
            ) : (
              <>
                <Ionicons name="car" size={20} color={Colors.white} />
                <Text style={styles.requestButtonText}>Request {vehicleType}</Text>
              </>
            )}
          </Pressable>

          {/* Schedule Ride Link */}
          <Pressable
            style={styles.scheduleLink}
            onPress={() => router.push('/rider/schedule')}
          >
            <Ionicons name="calendar" size={16} color={Colors.primary} />
            <Text style={styles.scheduleLinkText}>Schedule a Ride</Text>
          </Pressable>
        </ScrollView>
      </View>

      {/* Intercity Confirmation Modal */}
      {showIntercityConfirmation && (
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Intercity Ride</Text>
            <Text style={styles.modalMessage}>
              Your destination appears to be outside the InstaRide local service area.
            </Text>
            <View style={styles.fareDetails}>
              <View style={styles.fareRow}>
                <Text style={styles.fareLabel}>Estimated Fare</Text>
                <Text style={styles.fareValue}>₹{estimatedFare.toFixed(2)}</Text>
              </View>
            </View>
            <View style={styles.modalButtons}>
              <Pressable
                style={styles.modalButtonCancel}
                onPress={() => setShowIntercityConfirmation(false)}
              >
                <Text style={styles.modalButtonCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={styles.modalButtonConfirm}
                onPress={handleIntercityConfirm}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  mapContainer: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  bookingPanel: {
    maxHeight: height * 0.5,
    backgroundColor: Colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 5,
  },
  vehicleSection: {
    marginVertical: 16,
  },
  sectionLabel: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginBottom: 12,
  },
  vehicleGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  vehicleOption: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    gap: 4,
  },
  vehicleOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  vehicleLabel: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: Colors.text,
  },
  vehicleLabelActive: {
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
    opacity: 0.5,
  },
  requestButtonText: {
    fontSize: 16,
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
  modalOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modal: {
    backgroundColor: Colors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: Colors.textLight,
    marginBottom: 16,
  },
  fareDetails: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 16,
  },
  fareRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  fareLabel: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.textLight,
  },
  fareValue: {
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
    borderRadius: 8,
    borderWidth: 2,
    borderColor: Colors.border,
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
    borderRadius: 8,
    backgroundColor: Colors.primary,
  },
  modalButtonConfirmText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.white,
    textAlign: 'center',
  },
});
