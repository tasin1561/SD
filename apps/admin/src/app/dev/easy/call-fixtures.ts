import { ago } from './harness';

/** Shared mock rows for the call-centre test pages. DEV ONLY. */
export const AGENTS = [
  ['a1', 'rina.akter@skydrop.global', true, 3],
  ['a2', 'mohammad.salahuddin.chowdhury@skydrop.global', true, 5],
  ['a3', 'priya@skydrop.global', false, 0],
].map(([agentId, email, isAvailable, activeAssigned]) => ({
  agentId,
  email,
  activeAssigned,
  settings: {
    agentId,
    maxActiveCalls: 5,
    isAvailable,
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    workingDays: [1, 2, 3, 4, 5, 6],
    timezone: 'Asia/Kolkata',
    languages: ['hi', 'en', 'bn'],
    canHandleHighRisk: agentId === 'a1',
    canHandleHighValue: agentId !== 'a3',
  },
}));

export const METRICS = {
  agentId: 'a1',
  totalAttempts: 214,
  byOutcome: { CONFIRMED: 121, NO_ANSWER: 48, BUSY: 19, REJECTED: 14, WRONG_NUMBER: 12 },
  confirmedCount: 121,
  currentAssigned: 3,
  holds: {
    holdsCompleted: 190,
    holdsDropped: 9,
    dropsByReason: { TIMEOUT: 6, RELEASED: 3 },
    avgSecondsToOutcome: 74,
    longestDroppedSeconds: 612,
  },
};

const STATUSES = ['PENDING', 'ASSIGNED', 'PENDING', 'COMPLETED', 'EXPIRED', 'ASSIGNED'] as const;

export const QUEUE = STATUSES.map((status, i) => ({
  id: `q${i + 1}`,
  orderId: `01a1cf45-0000-73cf-8f7e-ff51baf52${String(500 + i)}`,
  status,
  assignedAgentId: status === 'ASSIGNED' ? 'a2' : null,
  assignedAt: status === 'ASSIGNED' ? ago(6 + i) : null,
  availableAt: ago(i % 2 === 0 ? 20 : -45),
  scheduledAttempts: i + 1,
  attemptsLogged: i,
  attemptsCounting: Math.max(0, i - 1),
  maxAttempts: 9,
  createdAt: ago(60 * (i + 1)),
  order: { orderNumber: `SD-2026-26-00007${i}`, sellerId: 's1', status: 'PENDING_CONFIRMATION' },
  agent:
    status === 'ASSIGNED'
      ? { id: 'a2', name: 'mohammad.salahuddin.chowdhury@skydrop.global' }
      : null,
}));

export const SELLERS = {
  items: [
    ['s1', 'Dhaka Threads Ltd'],
    ['s2', 'Chittagong Home & Lifestyle Exports Private Limited'],
  ].map(([id, companyName]) => ({
    id,
    initials: 'DT',
    email: 'owner@example.com',
    companyName,
    contactPersonName: 'Owner',
    status: 'APPROVED',
    approvedAt: ago(60 * 24 * 30),
    createdAt: ago(60 * 24 * 40),
  })),
  total: 2,
  page: 1,
  pageSize: 100,
};

export const AWAITING = [0, 1, 2, 3, 4].map((i) => ({
  id: `01a1cf45-0000-73cf-8f7e-ff51baf52${String(600 + i)}`,
  orderNumber: `SD-2026-26-00008${i}`,
  clientId: i < 3 ? 's1' : 's2',
  clientName: i < 3 ? 'Dhaka Threads Ltd' : 'Chittagong Home & Lifestyle Exports Private Limited',
  recipientName: ['Ananya Sharma', 'Rahul Verma', null, 'Mohammed Irfan', 'Lakshmi Narayanan'][i],
  recipientCity: ['Kolkata', 'New Delhi', 'Bengaluru', null, 'Thiruvananthapuram'][i],
  codAmountInr: ['1499.00', '349.00', null, '12999.00', '799.00'][i],
  itemCount: i + 1,
  createdAt: ago(60 * (i + 1)),
  confirmationDeadlineAt: i === 2 ? null : ago(-60 * (5 - i) + (i === 4 ? 400 : 0)),
  callsRequired: i !== 1,
}));
