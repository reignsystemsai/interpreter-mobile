import { Linking, Platform } from 'react-native';
import Purchases, { LOG_LEVEL, type PurchasesPackage } from 'react-native-purchases';

import { REVENUECAT_ANDROID_API_KEY } from '../config/runtime';

let configured = false;

export function membershipConfigured() {
  return Platform.OS === 'android' && Boolean(REVENUECAT_ANDROID_API_KEY);
}

export async function configureMembership(userId: string) {
  if (!membershipConfigured()) return false;
  if (!configured) {
    if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.DEBUG);
    Purchases.configure({ apiKey: REVENUECAT_ANDROID_API_KEY, appUserID: userId });
    configured = true;
  } else {
    await Purchases.logIn(userId);
  }
  return true;
}

export async function availablePackages() {
  const offerings = await Purchases.getOfferings();
  return offerings.current?.availablePackages ?? [];
}

export async function purchaseMembership(selectedPackage: PurchasesPackage) {
  return Purchases.purchasePackage(selectedPackage);
}

export async function restoreMembership() {
  return Purchases.restorePurchases();
}

export async function openGooglePlaySubscriptions() {
  await Linking.openURL('https://play.google.com/store/account/subscriptions');
}
