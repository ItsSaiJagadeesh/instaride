import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, Pressable, TextInput, StyleSheet, ActivityIndicator,
  ScrollView, Platform, AccessibilityInfo, FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Colors from '@/constants/colors';
import { searchPlaces } from '@/lib/places';

interface PlaceSuggestion {
  label: string;
  address: string;
  lat: number;
  lng: number;
}

interface LocationPickerProps {
  label: string;
  placeholder: string;
  value: string;
  lat?: number;
  lng?: number;
  onLocationChange: (address: string, lat: number, lng: number) => void;
  currentLocation?: { lat: number; lng: number };
  onShowCurrentLocation?: () => void;
  style?: any;
}

export default function LocationPicker({
  label,
  placeholder,
  value,
  lat,
  lng,
  onLocationChange,
  currentLocation,
  onShowCurrentLocation,
  style,
}: LocationPickerProps) {
  const [input, setInput] = useState(value);
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchRef = useRef<NodeJS.Timeout>();

  // Debounced search
  useEffect(() => {
    if (!input || input.length < 2) {
      setSuggestions([]);
      return;
    }

    if (searchRef.current !== undefined) {
      clearTimeout(searchRef.current);
    }

    setLoading(true);
    searchRef.current = setTimeout(async () => {
      try {
        const results = await searchPlaces(input);
        setSuggestions(results || []);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300); // 300ms debounce

    return () => {
      if (searchRef.current !== undefined) {
        clearTimeout(searchRef.current);
      }
    };
  }, [input]);

  const handleSelectSuggestion = useCallback((suggestion: PlaceSuggestion) => {
    setInput(suggestion.label);
    onLocationChange(suggestion.label, suggestion.lat, suggestion.lng);
    setShowSuggestions(false);
    setSuggestions([]);
  }, [onLocationChange]);

  const handleClear = useCallback(() => {
    setInput('');
    setSuggestions([]);
    setShowSuggestions(false);
  }, []);

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.label}>{label}</Text>
      
      <View style={styles.inputWrapper}>
        {/* Location icon or current location indicator */}
        <Ionicons
          name="location"
          size={20}
          color={Colors.primary}
          style={styles.leftIcon}
        />

        {/* Input field */}
        <TextInput
          style={styles.input}
          placeholder={placeholder}
          placeholderTextColor={Colors.textLight}
          value={input}
          onChangeText={setInput}
          onFocus={() => setShowSuggestions(true)}
          returnKeyType="search"
        />

        {/* Loading indicator or clear button */}
        {loading ? (
          <ActivityIndicator size="small" color={Colors.primary} style={styles.rightIcon} />
        ) : input ? (
          <Pressable onPress={handleClear} hitSlop={8}>
            <Ionicons name="close-circle" size={20} color={Colors.textLight} style={styles.rightIcon} />
          </Pressable>
        ) : null}
      </View>

      {/* Suggestions dropdown */}
      {showSuggestions && (
        <View style={styles.suggestionsContainer}>
          {suggestions.length > 0 ? (
            <FlatList
              data={suggestions}
              keyExtractor={(_, idx) => idx.toString()}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <Pressable
                  style={styles.suggestionItem}
                  onPress={() => handleSelectSuggestion(item)}
                >
                  <Ionicons name="location-outline" size={16} color={Colors.textLight} />
                  <View style={styles.suggestionText}>
                    <Text style={styles.suggestionLabel}>{item.label}</Text>
                    <Text style={styles.suggestionAddress}>{item.address}</Text>
                  </View>
                </Pressable>
              )}
            />
          ) : loading ? (
            <View style={styles.emptyState}>
              <ActivityIndicator size="small" color={Colors.primary} />
            </View>
          ) : input && !loading ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>No results found</Text>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Start typing to search</Text>
            </View>
          )}
        </View>
      )}

      {/* Current location button */}
      {currentLocation && onShowCurrentLocation && (
        <Pressable
          style={styles.currentLocationBtn}
          onPress={() => {
            setInput('Current Location');
            onLocationChange('Current Location', currentLocation.lat, currentLocation.lng);
            setShowSuggestions(false);
          }}
        >
          <Ionicons name="locate" size={16} color={Colors.primary} />
          <Text style={styles.currentLocationBtnText}>Use current location</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: Colors.text,
    marginBottom: 8,
  },
  inputWrapper: {
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
  leftIcon: {
    marginRight: 4,
  },
  input: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: Colors.text,
    padding: 0,
  },
  rightIcon: {
    marginLeft: 4,
  },
  suggestionsContainer: {
    position: 'absolute',
    top: 70,
    left: 0,
    right: 0,
    backgroundColor: Colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    maxHeight: 300,
    zIndex: 100,
    ...(Platform.OS !== 'web' ? {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 4,
    } : {}),
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
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
  currentLocationBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  currentLocationBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: Colors.primary,
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
});
