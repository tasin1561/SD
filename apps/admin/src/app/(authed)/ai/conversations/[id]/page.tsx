import type { ReactElement } from 'react';
import { AiConversationDetail } from '../../_components/ai-conversation-detail';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AiConversationPage({ params }: PageProps): Promise<ReactElement> {
  const { id } = await params;
  return <AiConversationDetail id={id} />;
}
