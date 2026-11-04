/** One canonical certificate list for Digital Asset Links and WebAuthn origins. */
export function androidFingerprints(value: string): string[] {
  return [...new Set(value.split(',').map((value) => value.trim()).filter(Boolean).map((value) => {
    if (!/^(?:[a-f\d]{64}|(?:[a-f\d]{2}:){31}[a-f\d]{2})$/i.test(value)) {
      throw new Error('ANDROID_SHA256_FINGERPRINTS must contain SHA-256 certificate fingerprints.');
    }
    return value.replaceAll(':', '').toUpperCase().match(/.{2}/g)!.join(':');
  }))];
}

export function androidPasskeyOrigins(fingerprints: string[]): string[] {
  return fingerprints.map((value) => `android:apk-key-hash:${Buffer.from(value.replaceAll(':', ''), 'hex').toString('base64url')}`);
}
