import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

import { Button } from '@/components/form';

/**
 * "Continue with Cloudflare", drawn like the platform sign-in buttons: a solid inverse fill
 * with the provider's own mark. The cloud keeps Cloudflare's orange on both ink and paper.
 */
export function CloudflareButton({ onPress, loading, disabled, title = 'Continue with Cloudflare' }: { onPress: () => void; loading?: boolean; disabled?: boolean; title?: string }) {
  return (
    <Button
      variant="ink"
      title={title}
      onPress={onPress}
      loading={loading}
      disabled={disabled}
      accessibilityHint="Opens Cloudflare to sign in, then returns here"
      leading={<Image source={require('../../assets/images/cloudflare.svg')} style={styles.logo} contentFit="contain" accessible={false} />}
    />
  );
}

const styles = StyleSheet.create({
  // The cloud is 256 × 116; 30 wide sits on the label's cap height.
  logo: { width: 30, height: 14 },
});
