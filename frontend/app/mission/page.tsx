import type { Metadata } from 'next';
import MissionScreen from '@/components/mission/MissionScreen';

export const metadata: Metadata = {
  title: 'Mission · Mars Map',
};

export default function MissionPage() {
  return <MissionScreen />;
}
