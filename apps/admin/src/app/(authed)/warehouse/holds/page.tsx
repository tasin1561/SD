import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import { HoldsBoard } from './_components/holds-board';
import { getT } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getT();
  return { title: `${t('holds.title')} · Skydrop` };
}

/**
 * "Who has what" — the live holds board.
 *
 * ── WHY A PAGE OF ITS OWN, NOT A PANEL ON THE ORDER ──────────────────
 * The history belongs on the order (you are already looking at the
 * parcel you are asking about). This is the opposite question: the floor
 * asks it with no parcel in mind — "who has anything, and can I take
 * one?" — so burying it inside one order's page would mean needing the
 * answer before you could look it up. It sits in the warehouse hub,
 * beside the benches, which is where somebody deciding what to work on
 * already is.
 */
export default function WarehouseHoldsPage(): ReactElement {
  return <HoldsBoard />;
}
