/* InstaRide: a fork of RideFlow (GPL-3.0-or-later). What the other side said about you: riders read what drivers said, drivers read what riders said.
 * The list is anonymous: no name, number or trip details, only the month, the stars, the tags and the written review. */
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card, Empty } from '@/components/ui';
import Colors from '@/constants/colors';
import { apiRequest } from '@/lib/query-client';
import { useAuth } from '@/lib/auth-context';

type Item = { rating: number; tags: string[]; text?: string; month: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceMonth = (m: string) => {
  const [y, mm] = m.split('-');
  return `${MONTHS[Number(mm) - 1] ?? ''} ${y}`.trim();
};
type Data = { average: number | null; count: number; tagCounts: Record<string, number>; items: Item[] };

function Stars({ n, size = 14 }: { n: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 2 }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Ionicons key={i} name={i <= n ? 'star' : 'star-outline'} size={size} color={i <= n ? '#FFB800' : Colors.border} />
      ))}
    </View>
  );
}

export default function MyReviewsScreen() {
  const { user } = useAuth();
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');

  const isDriver = user?.role === 'driver';
  useEffect(() => {
    if (!user) return;
    let live = true;
    (async () => {
      try {
        const res = await apiRequest('GET', isDriver ? '/api/driver/reviews' : '/api/rider/reviews');
        const d = (await res.json()) as Data;
        if (live) setData(d);
      } catch {
        if (live) setError('Could not load your reviews. Please try again.');
      }
    })();
    return () => { live = false; };
  }, [user?.role]);

  const tagList = data ? Object.entries(data.tagCounts).sort((a, b) => b[1] - a[1]) : [];

  return (
    <Screen title="My reviews">
      {error ? (
        <Empty icon="alert-circle-outline" title="Something went wrong" text={error} />
      ) : !data ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={Colors.primary} />
      ) : data.count === 0 ? (
        <Empty
          icon="star-outline"
          title="No reviews yet"
          text={isDriver ? "After a trip, the rider can rate you and write a few words. They will show up here without the rider's name." : "After a trip, the driver can rate you and write a few words. They will show up here without the driver's name."}
        />
      ) : (
        <>
          <Card>
            <View style={styles.summary} accessibilityLabel="Review summary">
              <Text style={styles.avg}>{data.average?.toFixed(1)}</Text>
              <View style={{ gap: 4 }}>
                <Stars n={Math.round(data.average ?? 0)} size={18} />
                <Text style={styles.count}>{data.count} {data.count === 1 ? 'review' : 'reviews'}</Text>
              </View>
            </View>
            {tagList.length > 0 && (
              <View style={styles.tagRow}>
                {tagList.map(([tag, n]) => (
                  <View key={tag} style={styles.tagPill}>
                    <Text style={styles.tagText}>{tag} · {n}</Text>
                  </View>
                ))}
              </View>
            )}
          </Card>

          {data.items.map((it, i) => (
            <Card key={`${it.month}-${i}`} style={{ marginTop: 10 }}>
              <View style={styles.itemBox} accessibilityLabel={isDriver ? "A rider's review" : "A driver's review"}>
                <View style={styles.itemHead}>
                  <Stars n={it.rating} />
                  <Text style={styles.date}>{niceMonth(it.month)}</Text>
                </View>
                {it.tags.length > 0 && <Text style={styles.itemTags}>{it.tags.join(' · ')}</Text>}
                {!!it.text && <Text style={styles.itemText}>“{it.text}”</Text>}
              </View>
            </Card>
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  summary: { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
  avg: { fontSize: 44, fontFamily: 'Inter_700Bold', color: Colors.text },
  count: { fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.textLight },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, paddingBottom: 16 },
  tagPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, backgroundColor: Colors.background },
  tagText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: Colors.text },
  itemBox: { padding: 16, gap: 8 },
  itemHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  date: { fontSize: 12, fontFamily: 'Inter_400Regular', color: Colors.textLight },
  itemTags: { fontSize: 12, fontFamily: 'Inter_500Medium', color: Colors.primary },
  itemText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: Colors.text, lineHeight: 20 },
});
