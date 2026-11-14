import type { Metadata } from 'next';
import ControlScreen from '@/components/control/ControlScreen';

export const metadata: Metadata = {
  title: 'Control · Mars Map',
};

export default function ControlPage() {
  return <ControlScreen />;
}
