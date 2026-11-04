/**
 * Sample mail for building and testing the interface before the mail API exists.
 * Northwind Labs, its people and every message here are invented.
 */
import type { Account, Label, Message, Settings, Thread } from './types';

export const SAMPLE_VERSION = 1;

const ME = { name: 'Samie Ahmed', address: 'samie@northwind.example' };
const HELLO = { name: 'Northwind Labs', address: 'hello@northwind.example' };

const ananya = { name: 'Ananya Rao', address: 'ananya@bluefin.example' };
const kabir = { name: 'Kabir Shah', address: 'kabir@northwind.example' };
const priya = { name: 'Priya Nair', address: 'priya@northwind.example' };
const rahul = { name: 'Rahul Mehta', address: 'rahul@lexwell.example' };
const meera = { name: 'Meera Iyer', address: 'meera@bluefin.example' };
const stripe = { name: 'Payments', address: 'receipts@payments.example' };
const cloud = { name: 'Cloud billing', address: 'billing@cloudhost.example' };
const lead = { name: 'Arjun Kapoor', address: 'arjun@greenleaf.example' };
const recruit = { name: 'Neha Verma', address: 'neha.verma@talentbridge.example' };
const newsletter = { name: 'The Founder Weekly', address: 'digest@founderweekly.example' };

export const SAMPLE_ACCOUNTS: Account[] = [
  { id: 'acc-samie', address: ME.address, name: ME.name, shared: false },
  { id: 'acc-hello', address: HELLO.address, name: HELLO.name, shared: true },
];

export const SAMPLE_LABELS: Label[] = [
  { id: 'investors', name: 'Investors', color: '#4D6B00' },
  { id: 'legal', name: 'Legal', color: '#7A1E3A' },
  { id: 'team', name: 'Team', color: '#0F6E68' },
  { id: 'receipts', name: 'Receipts', color: '#A8470B' },
];

let seq = 0;
const id = (p: string) => `${p}-${(seq += 1)}`;

function ago(minutes: number, now: number): string {
  return new Date(now - minutes * 60_000).toISOString();
}

function msg(m: Omit<Message, 'id' | 'cc' | 'attachments'> & Partial<Pick<Message, 'cc' | 'attachments'>>): Message {
  return { id: id('m'), cc: [], attachments: [], ...m };
}

function thread(t: Omit<Thread, 'id' | 'labelIds' | 'starred' | 'unread' | 'important' | 'snoozedUntil' | 'scheduledAt' | 'location' | 'accountId'> & Partial<Thread>): Thread {
  return {
    id: id('t'),
    accountId: 'acc-samie',
    location: 'inbox',
    labelIds: [],
    starred: false,
    unread: false,
    important: false,
    snoozedUntil: null,
    scheduledAt: null,
    ...t,
  };
}

export function buildSampleThreads(now = Date.now()): Thread[] {
  seq = 0;
  const d = (min: number) => ago(min, now);

  return [
    thread({
      subject: 'Pitch deck feedback',
      unread: true,
      important: true,
      labelIds: ['investors'],
      messages: [
        msg({
          from: ME,
          to: [ananya],
          date: d(60 * 26),
          body: 'Hi Ananya,\n\nAttaching the updated deck ahead of Thursday. The new slides cover our onboarding numbers and the pricing test.\n\nThanks,\nSamie',
          attachments: [{ id: 'a1', name: 'Northwind-Deck-v7.pdf', size: 4_820_000, type: 'application/pdf' }],
        }),
        msg({
          from: ananya,
          to: [ME],
          cc: [meera],
          date: d(29),
          body: 'Hi Samie,\n\nLoved slide 6. The onboarding funnel is the clearest I have seen at this stage.\n\nTwo questions before Thursday:\n1. How are you calculating CAC for the referral channel?\n2. Can you share churn by cohort for the last three months?\n\nI have copied Meera, who will join the call.\n\nBest,\nAnanya',
        }),
      ],
    }),
    thread({
      subject: 'Intro: Bluefin Ventures',
      unread: true,
      messages: [
        msg({
          from: kabir,
          to: [ME],
          date: d(54),
          body: 'Samie, meet Meera from Bluefin. She leads their seed investments in developer tools.\n\nMeera, Samie is building Northwind. Happy to connect you both. Are you free next Tuesday afternoon?\n\nKabir',
        }),
      ],
    }),
    thread({
      subject: 'Office lease, second draft',
      labelIds: ['legal'],
      starred: true,
      messages: [
        msg({
          from: rahul,
          to: [ME],
          date: d(60 * 20),
          body: 'Hi Samie,\n\nThe second draft is attached. Clause 9 now caps the yearly increase at 5%, and the lock-in drops to 18 months as you asked.\n\nPlease review clauses 12 to 14 on maintenance before we send it to the landlord.\n\nRegards,\nRahul Mehta\nLexwell Associates',
          attachments: [{ id: 'a2', name: 'Lease-Draft-2.docx', size: 182_000, type: 'application/msword' }],
        }),
      ],
    }),
    thread({
      subject: 'Standup notes, 30 Oct',
      labelIds: ['team'],
      messages: [
        msg({
          from: priya,
          to: [ME, kabir],
          date: d(60 * 22),
          body: 'Notes from today:\n\n- Onboarding flow is in review.\n- Android build goes out Friday.\n- Kabir is fixing the invite email links.\n- Next sprint planning moves to Monday 11 am.\n\nPriya',
        }),
        msg({
          from: kabir,
          to: [priya, ME],
          date: d(60 * 21),
          body: 'Invite links are fixed in staging. I will push to production after the Android release.\n\n> Kabir is fixing the invite email links.',
        }),
      ],
    }),
    thread({
      subject: 'Annual plan for a team of ten?',
      accountId: 'acc-hello',
      unread: true,
      messages: [
        msg({
          from: lead,
          to: [HELLO],
          date: d(80),
          body: 'Hi there,\n\nWe are a ten-person agency. Do you offer an annual plan, and is there a discount for paying upfront?\n\nThanks,\nArjun\nGreenleaf Studio',
        }),
      ],
    }),
    thread({
      subject: 'Your receipt from Payments',
      labelIds: ['receipts'],
      messages: [
        msg({
          from: stripe,
          to: [ME],
          date: d(60 * 30),
          body: 'Receipt #4821-2210\n\nAmount paid: ₹4,130.00\nDate paid: 31 Oct\nPayment method: Card ending 5958\n\nThis is a sample receipt.',
        }),
      ],
    }),
    thread({
      subject: 'Invoice for October',
      location: 'archive',
      labelIds: ['receipts'],
      messages: [
        msg({
          from: cloud,
          to: [ME],
          date: d(60 * 50),
          body: 'Your invoice for October is ready.\n\nTotal due: $5.00\nDue date: 15 Nov\n\nThis is a sample invoice.',
        }),
      ],
    }),
    thread({
      subject: 'Senior product designer role',
      snoozedUntil: new Date(now + 2 * 24 * 60 * 60_000).toISOString(),
      messages: [
        msg({
          from: recruit,
          to: [ME],
          date: d(60 * 46),
          body: 'Hi Samie,\n\nI have two strong candidates for the product designer role. Both have shipped mobile apps and worked at early-stage startups. Can we set up a call this week?\n\nNeha',
        }),
      ],
    }),
    thread({
      subject: 'Re: Thursday call agenda',
      location: 'sent',
      labelIds: ['investors'],
      messages: [
        msg({
          from: ME,
          to: [meera],
          date: d(60 * 4),
          body: 'Hi Meera,\n\nFor Thursday I would like to cover the product demo, our numbers since launch, and the round we are raising.\n\nSee you then,\nSamie',
        }),
      ],
    }),
    thread({
      subject: 'How to price a developer tool',
      messages: [
        msg({
          from: newsletter,
          to: [ME],
          date: d(60 * 72),
          body: 'This week: three founders on how they priced their first developer tool, why free tiers convert better with usage limits than with time limits, and a checklist for your pricing page.',
        }),
      ],
    }),
    thread({
      subject: 'You won a free cruise!!!',
      location: 'spam',
      messages: [
        msg({
          from: { name: 'Prize Desk', address: 'winner@promo-deals.example' },
          to: [ME],
          date: d(60 * 9),
          body: 'Click the link to claim your prize before midnight.',
        }),
      ],
    }),
    thread({
      subject: 'Welcome to Northwind Labs',
      accountId: 'acc-hello',
      location: 'sent',
      messages: [
        msg({
          from: HELLO,
          to: [lead],
          date: d(60 * 5),
          body: 'Hi Arjun,\n\nThanks for your interest. Yes, the annual plan is 20% cheaper than paying monthly. I have attached the pricing sheet.\n\nThe Northwind team',
          attachments: [{ id: 'a3', name: 'Pricing-2026.pdf', size: 640_000, type: 'application/pdf' }],
        }),
      ],
    }),
  ];
}

export function defaultSettings(): Settings {
  return {
    accounts: {
      'acc-samie': {
        signature: 'Samie Ahmed\nFounder, Northwind Labs',
        signatureEnabled: true,
        vacation: { enabled: false, subject: 'Out of office', message: '', contactsOnly: false },
      },
      'acc-hello': {
        signature: 'The Northwind team',
        signatureEnabled: true,
        vacation: { enabled: false, subject: 'Out of office', message: '', contactsOnly: false },
      },
    },
    swipeLeading: 'archive',
    swipeTrailing: 'trash',
    conversationView: true,
    undoSendSeconds: 10,
    defaultReply: 'reply',
    showAvatars: true,
    notifications: 'all',
    copyOtp: true,
    haptics: true,
  };
}
