import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const workerRequire = createRequire(new URL('../../../workers/sendraa-mail/package.json', import.meta.url));
const { build } = workerRequire('esbuild');
const result = await build({
  entryPoints: [new URL('../src/lib/notifications.ts', import.meta.url).pathname],
  bundle: true, format: 'esm', platform: 'node', write: false,
  plugins: [{ name: 'notification-native-mocks', setup(builder) {
    builder.onResolve({filter: /^(expo-crypto|expo-constants|expo-device|expo-secure-store|expo-notifications|react-native|\.\/api)$/}, args => ({path: args.path, namespace:'mock'}));
    builder.onLoad({filter: /.*/, namespace:'mock'}, ({path}) => ({contents: {
      'expo-crypto': 'export const randomUUID=()=>"test-device";',
      'expo-constants': 'export default {executionEnvironment:"bare",easConfig:{projectId:"test-project"}};',
      'expo-device': 'export const isDevice=true;',
      'expo-secure-store': 'export const getItemAsync=async()=>null; export const setItemAsync=async()=>{};',
      'react-native': 'export const Platform={OS:"android"};',
      './api': 'export const api=async(...args)=>{globalThis.testPush.calls.push(["api",...args]);};',
      'expo-notifications': `
        export const AndroidImportance={HIGH:4};
        export const AndroidNotificationVisibility={PRIVATE:0};
        export async function setNotificationCategoryAsync(id,actions){
          if(!actions.length)throw new Error('Must provide at least one action.');
          if(/[:-]/.test(id))throw new Error('Unsafe category identifier');
          globalThis.testPush.calls.push(['category',id,actions]);
        }
        export async function setNotificationChannelAsync(...args){globalThis.testPush.calls.push(['channel',...args]);}
        export async function getPermissionsAsync(){globalThis.testPush.calls.push(['permission']);return {granted:globalThis.testPush.granted};}
        export async function requestPermissionsAsync(){globalThis.testPush.calls.push(['prompt']);return {granted:globalThis.testPush.allow};}
        export async function getExpoPushTokenAsync(){globalThis.testPush.calls.push(['token']);return {data:'ExponentPushToken[test]'};}
        export async function dismissAllNotificationsAsync(){}
      `,
    }[path]}));
  }}],
});
const notifications = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
try {
  globalThis.testPush={calls:[],granted:false,allow:true};
  await notifications.registerNotifications({preference:'all',copyOtp:true},true);
  let calls=globalThis.testPush.calls;
  assert.equal(calls.filter(c=>c[0]==='category').length,1);
  assert.equal(calls.find(c=>c[0]==='category')[1],'mail_otp');
  assert.equal(calls.find(c=>c[0]==='category')[2][0].identifier,'COPY_OTP');
  assert.ok(calls.findIndex(c=>c[0]==='channel')<calls.findIndex(c=>c[0]==='prompt'));
  assert.ok(calls.findIndex(c=>c[0]==='prompt')<calls.findIndex(c=>c[0]==='token'));
  assert.equal(calls.at(-1)[1],'/v1/devices/test-device');
  assert.equal(calls.at(-1)[2].body.platform,'android');
  globalThis.testPush={calls:[],granted:false,allow:false};
  await assert.rejects(()=>notifications.registerNotifications({preference:'all',copyOtp:false},true),/Allow Sendraa notifications/);
  assert.ok(!globalThis.testPush.calls.some(c=>c[0]==='token'||c[0]==='api'));
  globalThis.testPush={calls:[],granted:false,allow:true};
  await assert.rejects(()=>notifications.registerNotifications({preference:'all',copyOtp:true},false),/Allow Sendraa notifications/);
  assert.ok(!globalThis.testPush.calls.some(c=>c[0]==='prompt'));
  globalThis.testPush={calls:[],granted:true,allow:false};
  await notifications.registerNotifications({preference:'important',copyOtp:false},false);
  assert.ok(!globalThis.testPush.calls.some(c=>c[0]==='prompt'));
  assert.equal(globalThis.testPush.calls.at(-1)[2].body.preference,'important');
  assert.equal(globalThis.testPush.calls.at(-1)[2].body.copyOtp,false);
  console.log('Android registration regression checks passed: nonempty categories, permission ordering, denied permissions, and silent reconnect. No real device or push used.');
} finally { delete globalThis.testPush; }
