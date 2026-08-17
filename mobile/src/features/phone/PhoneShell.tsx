import { useEffect, useState, useSyncExternalStore } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { CallService } from '../calling/CallService';
import { ContactsPermissionPanel } from '../contacts/ContactsPermissionPanel';
import { getRecentCalls, subscribeRecentCalls, type PhoneTab } from './PhoneActivityStore';

const BLUE = '#075BFF';
const TABS: { key: PhoneTab; label: string }[] = [
  { key: 'capsules', label: 'Capsules' },
  { key: 'recents', label: 'Recents' },
  { key: 'connections', label: 'Connections' },
  { key: 'keypad', label: 'Keypad' },
  { key: 'voice', label: 'Voice' },
];

function TabIcon({ active, name }: { active: boolean; name: PhoneTab }) {
  const color = active ? BLUE : '#7A8496';
  if (name === 'capsules') return <Svg height={22} viewBox="0 0 24 24" width={22}><Rect fill="none" height={18} rx={4} stroke={color} strokeWidth={1.8} width={16} x={4} y={3} /><Line stroke={color} strokeLinecap="round" strokeWidth={1.8} x1={8} x2={16} y1={9} y2={9} /><Line stroke={color} strokeLinecap="round" strokeWidth={1.8} x1={8} x2={14} y1={13} y2={13} /></Svg>;
  if (name === 'recents') return <Svg height={22} viewBox="0 0 24 24" width={22}><Circle cx={12} cy={12} fill="none" r={9} stroke={color} strokeWidth={1.8} /><Path d="M12 7v5l3.5 2" fill="none" stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} /></Svg>;
  if (name === 'connections') return <Svg height={22} viewBox="0 0 24 24" width={22}><Circle cx={9} cy={8} fill="none" r={3} stroke={color} strokeWidth={1.8} /><Circle cx={17} cy={9} fill="none" r={2.4} stroke={color} strokeWidth={1.8} /><Path d="M3.5 19c.5-4 2.4-6 5.5-6s5 2 5.5 6M14 14c3.7-.7 5.8 1 6.5 4.5" fill="none" stroke={color} strokeLinecap="round" strokeWidth={1.8} /></Svg>;
  if (name === 'keypad') return <Svg height={22} viewBox="0 0 24 24" width={22}>{[6, 12, 18].flatMap((x) => [6, 12, 18].map((y) => <Circle key={`${x}-${y}`} cx={x} cy={y} fill={color} r={1.35} />))}</Svg>;
  return <Svg height={22} viewBox="0 0 24 24" width={22}><Line stroke={color} strokeLinecap="round" strokeWidth={1.8} x1={5} x2={5} y1={10} y2={14} /><Line stroke={color} strokeLinecap="round" strokeWidth={1.8} x1={9} x2={9} y1={6} y2={18} /><Line stroke={color} strokeLinecap="round" strokeWidth={1.8} x1={13} x2={13} y1={3} y2={21} /><Line stroke={color} strokeLinecap="round" strokeWidth={1.8} x1={17} x2={17} y1={7} y2={17} /><Line stroke={color} strokeLinecap="round" strokeWidth={1.8} x1={21} x2={21} y1={10} y2={14} /></Svg>;
}

function EmptyScreen({ body, title }: { body: string; title: string }) {
  return <View style={styles.emptyScreen}><View style={styles.emptyOrb}><Text style={styles.emptyOrbText}>•</Text></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text></View>;
}

function KeypadScreen() {
  const [number, setNumber] = useState('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
  const call = () => {
    const target = number.trim();
    if (!target) return;
    void CallService.createCall(target, target).catch((error) => Alert.alert('Unable to connect', error instanceof Error ? error.message : 'Please try again.'));
  };
  return <View style={styles.keypadScreen}>
    <TextInput accessibilityLabel="Phone number" keyboardType="phone-pad" onChangeText={setNumber} placeholder="Enter a number" placeholderTextColor="#98A2B3" style={styles.numberInput} value={number} />
    <View style={styles.keyGrid}>{keys.map((key) => <Pressable key={key} accessibilityRole="button" onPress={() => setNumber((value) => `${value}${key}`)} style={({ pressed }) => [styles.key, pressed && styles.pressed]}><Text style={styles.keyText}>{key}</Text></Pressable>)}</View>
    <Pressable accessibilityLabel="Start call" accessibilityRole="button" disabled={!number.trim()} onPress={call} style={({ pressed }) => [styles.callButton, !number.trim() && styles.disabled, pressed && styles.pressed]}><Text style={styles.callButtonText}>Call</Text></Pressable>
  </View>;
}

function RecentsScreen() {
  const calls = useSyncExternalStore(subscribeRecentCalls, getRecentCalls, getRecentCalls);
  if (!calls.length) return <EmptyScreen body="Completed and missed calls will appear here." title="No recent calls" />;
  return <ScrollView contentContainerStyle={styles.recentList} showsVerticalScrollIndicator={false}>{calls.map((call) => <Pressable key={call.id} accessibilityLabel={`Call ${call.label}`} accessibilityRole="button" disabled={!call.phone} onPress={() => void CallService.createCall(call.phone, call.label).catch((error) => Alert.alert('Unable to connect', error instanceof Error ? error.message : 'Please try again.'))} style={({ pressed }) => [styles.recentRow, !call.phone && styles.disabled, pressed && styles.pressed]}><View style={[styles.recentDirection, call.kind === 'missed' && styles.recentMissed]}><Text style={[styles.recentDirectionText, call.kind === 'missed' && styles.recentMissedText]}>{call.kind === 'incoming' ? '↙' : call.kind === 'outgoing' ? '↗' : '×'}</Text></View><View style={styles.recentCopy}><Text numberOfLines={1} style={[styles.recentName, call.kind === 'missed' && styles.recentMissedText]}>{call.label}</Text><Text style={styles.recentMeta}>{call.kind.charAt(0).toUpperCase() + call.kind.slice(1)} call · Tap to call</Text></View><Text style={styles.recentTime}>{new Date(call.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</Text></Pressable>)}</ScrollView>;
}

export function PhoneShell({ initialTab = 'connections', onClose }: { initialTab?: PhoneTab; onClose: () => void }) {
  const [tab, setTab] = useState<PhoneTab>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  return <View style={styles.shell}>
    <View style={styles.topBar}><Pressable accessibilityRole="button" onPress={onClose} style={styles.done}><Text style={styles.doneText}>Home</Text></Pressable>{tab !== 'connections' ? <Text style={styles.screenTitle}>{TABS.find((item) => item.key === tab)?.label}</Text> : <View />}</View>
    <View style={styles.content}>
      {tab === 'connections' ? <ContactsPermissionPanel onBack={onClose} showHeader={false} /> : null}
      {tab === 'capsules' ? <EmptyScreen body="Your completed conversation summaries and action items will appear here." title="No Capsules yet" /> : null}
      {tab === 'recents' ? <RecentsScreen /> : null}
      {tab === 'keypad' ? <KeypadScreen /> : null}
      {tab === 'voice' ? <EmptyScreen body="Saved voice messages will appear here." title="No Voice messages" /> : null}
    </View>
    <View style={styles.tabBar}>{TABS.map((item) => <Pressable key={item.key} accessibilityRole="tab" accessibilityState={{ selected: tab === item.key }} onPress={() => setTab(item.key)} style={styles.tab}><TabIcon active={tab === item.key} name={item.key} /><Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>{item.label}</Text></Pressable>)}</View>
  </View>;
}

const styles = StyleSheet.create({
  shell: { backgroundColor: '#FFFFFF', flex: 1 },
  topBar: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', minHeight: 36 },
  done: { paddingHorizontal: 4, paddingVertical: 8 },
  doneText: { color: BLUE, fontSize: 16, fontWeight: '700' },
  screenTitle: { color: '#101828', fontSize: 22, fontWeight: '800' },
  content: { flex: 1, paddingTop: 8 },
  emptyScreen: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 34 },
  emptyOrb: { alignItems: 'center', backgroundColor: '#EEF4FF', borderRadius: 36, height: 72, justifyContent: 'center', width: 72 },
  emptyOrbText: { color: BLUE, fontSize: 38, lineHeight: 40 },
  emptyTitle: { color: '#101828', fontSize: 23, fontWeight: '800', marginTop: 18 },
  emptyBody: { color: '#667085', fontSize: 15, lineHeight: 22, marginTop: 8, maxWidth: 320, textAlign: 'center' },
  keypadScreen: { alignItems: 'center', flex: 1, paddingTop: 12 },
  numberInput: { borderBottomColor: '#DDE5F1', borderBottomWidth: 1, color: '#101828', fontSize: 24, minHeight: 52, textAlign: 'center', width: '84%' },
  keyGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 22, maxWidth: 286, rowGap: 12, width: '100%' },
  key: { alignItems: 'center', backgroundColor: '#F4F7FB', borderRadius: 34, height: 68, justifyContent: 'center', width: '33.333%' },
  keyText: { color: '#101828', fontSize: 25, fontWeight: '600' },
  callButton: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 30, marginTop: 22, paddingHorizontal: 42, paddingVertical: 16 },
  callButtonText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
  recentList: { paddingBottom: 24, paddingTop: 6 },
  recentRow: { alignItems: 'center', borderBottomColor: '#EEF1F5', borderBottomWidth: 1, flexDirection: 'row', minHeight: 68, paddingHorizontal: 4 },
  recentDirection: { alignItems: 'center', backgroundColor: '#EAF1FF', borderRadius: 20, height: 40, justifyContent: 'center', width: 40 },
  recentMissed: { backgroundColor: '#FFF0F0' },
  recentDirectionText: { color: BLUE, fontSize: 20, fontWeight: '700' },
  recentCopy: { flex: 1, marginLeft: 12 },
  recentName: { color: '#101828', fontSize: 16, fontWeight: '700' },
  recentMissedText: { color: '#D92D20' },
  recentMeta: { color: '#667085', fontSize: 12, marginTop: 3 },
  recentTime: { color: '#98A2B3', fontSize: 12 },
  tabBar: { backgroundColor: 'rgba(255,255,255,0.96)', borderTopColor: '#E8EDF5', borderTopWidth: 1, flexDirection: 'row', marginHorizontal: -20, paddingBottom: 8, paddingHorizontal: 8, paddingTop: 9 },
  tab: { alignItems: 'center', flex: 1, minWidth: 0 },
  tabText: { color: '#7A8496', fontSize: 9, marginTop: 4 },
  tabTextActive: { color: BLUE, fontWeight: '700' },
  pressed: { opacity: 0.66, transform: [{ scale: 0.97 }] },
  disabled: { opacity: 0.38 },
});
