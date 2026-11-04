import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { api } from './api';

export type NotificationPreference = 'all' | 'important' | 'none';
export type PushSettings = { preference:NotificationPreference; copyOtp:boolean };
const key='sendraa.push.device';
export const nativePushAvailable = () => Platform.OS !== 'web' && Constants.executionEnvironment !== 'storeClient';
export const pushModule = () => import('expo-notifications');

export async function registerNotifications(settings:PushSettings,askPermission:boolean) {
  if(!nativePushAvailable())throw new Error('Push notifications need a Sendraa development or production build. They are not available in Expo Go or on web.');
  if(!Device.isDevice)throw new Error('Enable notifications on a physical iPhone or Android device.');
  const projectId=Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if(!projectId)throw new Error('This build is not linked to an Expo project. Link the app with EAS and rebuild to enable push notifications.');
  const n=await pushModule();
  // Plain mail has no actions and needs no category. Android rejects empty categories.
  await n.setNotificationCategoryAsync('mail_otp',[{identifier:'COPY_OTP',buttonTitle:'Copy code',options:{opensAppToForeground:true,isAuthenticationRequired:true}}],{previewPlaceholder:'New mail'});
  if(Platform.OS==='android')await n.setNotificationChannelAsync('mail',{name:'New mail',importance:n.AndroidImportance.HIGH,lockscreenVisibility:n.AndroidNotificationVisibility.PRIVATE});
  let permission=await n.getPermissionsAsync();
  if(!permission.granted && askPermission)permission=await n.requestPermissionsAsync();
  if(!permission.granted)throw new Error('Allow Sendraa notifications in your device settings, then try again.');
  const {data:token}=await n.getExpoPushTokenAsync({projectId});
  let deviceId=await SecureStore.getItemAsync(key);
  if(!deviceId) { deviceId=Crypto.randomUUID(); await SecureStore.setItemAsync(key,deviceId); }
  await api(`/v1/devices/${deviceId}`,{method:'PUT',body:{token,platform:Platform.OS,preference:settings.preference,copyOtp:settings.copyOtp}});
}

export async function disableNotifications() {
  if(Platform.OS==='web')return;
  const deviceId=await SecureStore.getItemAsync(key);
  if(deviceId)await api(`/v1/devices/${deviceId}`,{method:'DELETE'});
  if(nativePushAvailable())await (await pushModule()).dismissAllNotificationsAsync();
}

export async function restoreNotifications(settings:PushSettings) {
  if(!nativePushAvailable())return;
  // Never prompt on launch, and never opt an installation in until its owner enables it.
  const deviceId=await SecureStore.getItemAsync(key);
  if(!deviceId)return;
  if(settings.preference==='none')await disableNotifications();
  else await registerNotifications(settings,false);
}
