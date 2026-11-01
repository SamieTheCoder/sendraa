import type { Stack } from 'expo-router';
import type { ComponentProps } from 'react';
import type { ImageSourcePropType } from 'react-native';

import type { SFSymbol } from '@/theme/symbols';

import Archive from '@expo/material-symbols/archive.xml';
import AttachFile from '@expo/material-symbols/attach_file.xml';
import Check from '@expo/material-symbols/check.xml';
import Close from '@expo/material-symbols/close.xml';
import Delete from '@expo/material-symbols/delete.xml';
import EditSquare from '@expo/material-symbols/edit_square.xml';
import Forward from '@expo/material-symbols/forward.xml';
import Inbox from '@expo/material-symbols/inbox.xml';
import Label from '@expo/material-symbols/label.xml';
import MarkUnread from '@expo/material-symbols/mark_email_unread.xml';
import Menu from '@expo/material-symbols/menu.xml';
import MoreVert from '@expo/material-symbols/more_vert.xml';
import Move from '@expo/material-symbols/drive_file_move.xml';
import Reply from '@expo/material-symbols/reply.xml';
import ReplyAll from '@expo/material-symbols/reply_all.xml';
import Report from '@expo/material-symbols/report.xml';
import Schedule from '@expo/material-symbols/schedule.xml';
import Send from '@expo/material-symbols/send.xml';
import Star from '@expo/material-symbols/star.xml';

/**
 * Toolbar icons. iOS takes SF Symbol names; Android needs image sources.
 * `process.env.EXPO_OS` is inlined at build time, so each platform only ships
 * its own branch.
 */
type ToolbarIconValue = NonNullable<ComponentProps<typeof Stack.Toolbar.Button>['icon']>;

const pair = (ios: SFSymbol, android: ImageSourcePropType): ToolbarIconValue =>
  (process.env.EXPO_OS === 'ios' ? ios : android) as ToolbarIconValue;

export const ToolbarIcon = {
  menu: pair('line.3.horizontal', Menu),
  compose: pair('square.and.pencil', EditSquare),
  archive: pair('archivebox', Archive),
  unarchive: pair('tray.and.arrow.down', Inbox),
  trash: pair('trash', Delete),
  unread: pair('envelope.badge', MarkUnread),
  more: pair('ellipsis.circle', MoreVert),
  send: pair('paperplane.fill', Send),
  attach: pair('paperclip', AttachFile),
  close: pair('xmark', Close),
  star: pair('star', Star),
  starFill: pair('star.fill', Star),
  reply: pair('arrowshape.turn.up.left', Reply),
  replyAll: pair('arrowshape.turn.up.left.2', ReplyAll),
  forward: pair('arrowshape.turn.up.right', Forward),
  snooze: pair('clock', Schedule),
  move: pair('folder', Move),
  label: pair('tag', Label),
  spam: pair('exclamationmark.octagon', Report),
  check: pair('checkmark', Check),
} as const;
