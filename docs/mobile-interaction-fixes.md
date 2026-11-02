# Mobile interaction pass — 2026-11-02

## Scope

Login and account-security composition; native compact headers; Android folder navigation and tab order; iOS selection/swipe layers; keyboard-aware input forms and Android composer. Existing mail operations and Cloudflare resources are unchanged.

## Decisions and implementation

- Design Taste dealt Editorial greeting, seed 1416836670. Existing yellow/League Gothic identity and native system text are retained. Native app constraints override the desktop 12-column shell: phone forms use one bounded column, 20-point gutters, 28-point login title and a single primary action. No redraws or invented sample data.
- Login answers “How do I enter my existing mail or connect my domain?” The Cloudflare action leads; email is adjacent in reading order, not at the bottom of an otherwise empty screen. Native safe-area edges own the login frame. Other screens use native stack headers and automatic content insets without a second top inset.
- Security answers “Which sign-in and recovery methods are available?” Status stays visible, with forms disclosed on demand. Passkey messages distinguish Expo Go, server configuration, unsupported builds/devices and network failure.
- Live API capability check returned passkey ios=false, android=false, web=false and recovery=false. Missing signing/domain setup cannot be repaired through styling. See account-security.md. Passkey responses now supply required WebAuthn type/extension defaults that some native responses omit; server challenge and origin verification remain intact.
- Mail/search/settings use compact opaque system headers with the same title treatment. iOS tab behavior is retained. Android order is Mail, Search, Settings.
- Android's long native popup is replaced by a scrollable native route with mailbox identity, folders, counts, labels and account switching. Back dismisses it normally. iOS keeps its native toolbar menu.
- Swipe children now have an opaque base under translucent press/selection fills. Action layers are invisible at zero progress. Selection resets the swipe and disables gestures without unmounting the wrapper. iOS has a wider activation threshold and no overshoot; Android retains its existing threshold and overshoot behavior. Gesture transforms remain in Gesture Handler/Reanimated.
- Keyboard Controller 1.22.7 (Expo SDK 58's recommended version) is installed with KeyboardProvider. Login, password recovery, security, onboarding and invite forms use KeyboardAwareScrollView with 24-point caret clearance. Android compose uses it for multiline cursor tracking; iOS compose retains its ScrollView/automatic keyboard insets. Custom builds need rebuilding to include the native dependency; Expo SDK 58 Go includes keyboard-controller, but not react-native-passkey.

## Evidence and limits

Lint, mobile typecheck and all-platform export are run for this pass. Production login previews are inspected at 390, 768 and 1440. Web previews validate layout only, not native gestures or keyboard animation. No iOS simulator was booted and adb was unavailable. Authenticated security/folder screens and long multiline caret tracking still need device verification.

Device check: long-press a stationary mail row; cancel selection; swipe both ways slowly, reverse midway, and release; scroll vertically near a row without triggering actions. On Android, type at least 30 lines, move the cursor into the middle, open/close the keyboard, and test To/Cc/Subject focus. Confirm iOS compose remains unchanged. Test both themes and large text.

## References

- https://docs.expo.dev/versions/v58.0.0/sdk/keyboard-controller/
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/api/components/keyboard-aware-scroll-view
- https://kirillzyusko.github.io/react-native-keyboard-controller/docs/installation
- User-supplied video https://youtu.be/Y51mDfAhd4E was opened; its transcript was not available through the browser tool. Implementation follows the library's official versioned documentation and installed types.
