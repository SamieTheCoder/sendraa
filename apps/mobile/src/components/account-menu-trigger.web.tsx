import { useRef } from 'react';
import type { MenuAction, MenuComponentProps } from '@expo/ui/community/menu';

/** The native MenuView has no web actions. Use a keyboard-accessible browser menu. */
export function AccountMenuTrigger({ children, actions, onPressAction, title }: MenuComponentProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  const render = (action: MenuAction) => action.subactions ? <div key={action.id} style={{ borderTop: '1px solid #8885', marginTop: 6, paddingTop: 6 }}>{action.subactions.map(render)}</div> : <button
    key={action.id} type="button" disabled={action.attributes?.disabled}
    onClick={() => { if (menu.current) menu.current.open = false; onPressAction?.({ nativeEvent: { event: action.id ?? action.title } }); }}
    style={{ display: 'block', width: '100%', padding: '12px 16px', border: 0, background: 'transparent', color: action.attributes?.destructive ? '#d93025' : 'inherit', textAlign: 'left', cursor: 'pointer', font: 'inherit' }}
  >{action.state === 'on' ? '✓ ' : ''}{action.title}</button>;
  return <details ref={menu} style={{ position: 'relative' }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false; }} onKeyDown={(event) => { if (event.key === 'Escape' && menu.current) menu.current.open = false; }}>
    <summary aria-label={title} style={{ listStyle: 'none', cursor: 'pointer' }}>{children}</summary>
    <div style={{ position: 'absolute', right: 0, top: '100%', minWidth: 280, maxWidth: 'calc(100vw - 32px)', borderRadius: 16, padding: 8, background: 'Canvas', color: 'CanvasText', boxShadow: '0 8px 32px #0003', zIndex: 100 }}>{actions.map(render)}</div>
  </details>;
}
