import type { ReactElement } from 'react';
import { BinDetail } from './_components/bin-detail';

export default async function BinDetailPage({
  params,
}: {
  params: Promise<{ binId: string }>;
}): Promise<ReactElement> {
  const { binId } = await params;
  return <BinDetail binId={binId} />;
}
