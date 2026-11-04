import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useMemo, useState } from 'react';
import { HapticPressable as Pressable } from '@/components/haptic-pressable';
import { Text, View } from 'react-native';

import { Button, ErrorText } from '@/components/form';
import { messageParts } from '@/mail/message-links';
import { useColors } from '@/theme/colors';

export function MessageBody({ body }: { body: string }) {
  const c = useColors();
  const parts = useMemo(() => messageParts(body), [body]);
  const [copied, setCopied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = async (url: string) => {
    setError(null);
    try {
      const ok = await Clipboard.setStringAsync(url);
      if (!ok) throw new Error();
      setCopied(url);
    } catch { setError('Could not copy this link. Try again.'); }
  };
  const open = async (url: string) => {
    setError(null);
    try { await WebBrowser.openBrowserAsync(url); }
    catch { setError('Could not open this link. Copy it and paste it into your browser.'); }
  };
  return <View style={{gap:12}}>
    {parts.flatMap((part,index) => part.kind === 'text'
      ? part.value.split(/\n\s*\n/).filter((p)=>p.trim()).map((paragraph,p)=><Text key={`${index}-${p}`} selectable style={{color:c.label,fontSize:16,lineHeight:23}}>{paragraph.trim()}</Text>)
      : [<View key={index} style={{gap:2}}>
          <Pressable onPress={()=>void open(part.value)} onLongPress={()=>void copy(part.value)} accessibilityRole="link" accessibilityLabel={part.value} accessibilityHint="Opens in your browser. Long press to copy this link." style={{minHeight:44,justifyContent:'center'}}>
            <Text style={{color:c.tint,fontSize:16,lineHeight:23,textDecorationLine:'underline'}}>{part.value}</Text>
          </Pressable>
          <View style={{alignSelf:'flex-start'}}><Button title={copied===part.value?'Copied link':'Copy link'} variant="plain" size="compact" onPress={()=>void copy(part.value)}/></View>
        </View>])}
    <ErrorText>{error}</ErrorText>
  </View>;
}
