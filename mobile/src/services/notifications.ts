import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { authenticatedRequest } from './api';
import { registerCurrentInstallation } from './deviceRegistration';

export async function registerForAccountNotifications() {
  if (!Device.isDevice) throw new Error('Push notifications require a physical device.');
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('service-alerts', {
      importance: Notifications.AndroidImportance.HIGH,
      name: 'Service alerts',
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const status = current.status === 'granted'
    ? current.status
    : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') throw new Error('Notification permission was not granted.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('Expo project ID is unavailable.');
  const expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await authenticatedRequest<void>('/api/v1/notifications/devices', {
    method: 'POST',
    body: JSON.stringify({ expoPushToken, platform: Platform.OS }),
  });
  await registerCurrentInstallation(expoPushToken);
  return expoPushToken;
}

export async function registerForCallNotifications(requestPermission = true) {
  if (!Device.isDevice) throw new Error('Push notifications require a physical device.');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }),
  });
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('incoming-calls', {
      bypassDnd: false,
      importance: Notifications.AndroidImportance.MAX,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      name: 'Incoming calls',
      sound: 'default',
      vibrationPattern: [0, 500, 250, 500],
    });
  }
  await Notifications.setNotificationCategoryAsync('incoming-call', [
    { buttonTitle: 'Accept', identifier: 'accept', options: { opensAppToForeground: true } },
    { buttonTitle: 'Decline', identifier: 'decline', options: { isDestructive: true, opensAppToForeground: false } },
  ]);
  const current = await Notifications.getPermissionsAsync();
  const status = current.status === 'granted' ? current.status : requestPermission ? (await Notifications.requestPermissionsAsync()).status : current.status;
  if (status !== 'granted') throw new Error('Notification permission was not granted.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error('Expo project ID is unavailable.');
  const expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await authenticatedRequest<void>('/api/v1/notifications/devices', {
    method: 'POST', body: JSON.stringify({ expoPushToken, platform: Platform.OS }),
  });
  await registerCurrentInstallation(expoPushToken);
  return expoPushToken;
}
