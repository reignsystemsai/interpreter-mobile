import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../account/AuthProvider';
import { useCalling } from './CallProvider';

export function CallHistoryPanel({ onBack, onRequireSignIn }: { onBack: () => void; onRequireSignIn: () => void }) {
  const { user } = useAuth();
  const { history, refreshHistory } = useCalling();
  useEffect(() => { if (user) void refreshHistory().catch(() => undefined); }, [refreshHistory, user]);
  if (!user) return <View><Back onPress={onBack} /><Text style={styles.title}>Call History</Text><Text style={styles.empty}>Sign in to see calls across your devices.</Text><Pressable onPress={onRequireSignIn} style={styles.signIn}><Text style={styles.signInText}>Sign In</Text></Pressable></View>;
  return <View><Back onPress={onBack} /><Text style={styles.title}>Call History</Text><ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>{history.map((call) => <View key={call.id} style={styles.row}><View style={styles.avatar}><Text style={styles.avatarText}>{call.otherParty.displayName.slice(0, 1).toUpperCase()}</Text></View><View style={styles.copy}><Text style={styles.name}>{call.otherParty.displayName}</Text><Text style={[styles.meta, call.status === 'missed' && styles.missed]}>{call.callType === 'voice' ? 'Voice' : call.callType === 'video' ? 'Video' : 'Business video'} · {call.status} · {call.durationSeconds ? `${Math.floor(call.durationSeconds / 60)}m ${call.durationSeconds % 60}s` : new Date(call.createdAt).toLocaleDateString()}</Text></View></View>)}{!history.length ? <Text style={styles.empty}>No calls yet.</Text> : null}</ScrollView></View>;
}

function Back({ onPress }: { onPress: () => void }) { return <Pressable onPress={onPress} style={styles.back}><Text style={styles.backText}>‹ Calling</Text></Pressable>; }
const styles = StyleSheet.create({ back: { alignSelf: 'flex-start', marginBottom: 10, paddingVertical: 5 }, backText: { color: '#075BFF', fontSize: 16, fontWeight: '600' }, title: { color: '#101828', fontSize: 27, fontWeight: '800' }, list: { paddingBottom: 40, paddingTop: 12 }, row: { alignItems: 'center', borderBottomColor: '#E5EBF3', borderBottomWidth: 1, flexDirection: 'row', minHeight: 70 }, avatar: { alignItems: 'center', backgroundColor: '#EAF1FF', borderRadius: 21, height: 42, justifyContent: 'center', width: 42 }, avatarText: { color: '#075BFF', fontSize: 17, fontWeight: '800' }, copy: { flex: 1, marginLeft: 12 }, name: { color: '#101828', fontSize: 16, fontWeight: '700' }, meta: { color: '#667085', fontSize: 11, marginTop: 4, textTransform: 'capitalize' }, missed: { color: '#D92D20' }, empty: { color: '#667085', fontSize: 14, paddingVertical: 28, textAlign: 'center' }, signIn: { alignItems: 'center', backgroundColor: '#075BFF', borderRadius: 18, paddingVertical: 15 }, signInText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' } });
