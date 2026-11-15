import type { Metadata } from 'next';
import ControlScreen from '@/components/control/ControlScreen';

export const metadata: Metadata = {
  title: 'Control · Marsfinder',
};

export default function ControlPage() {
  return <ControlScreen />;
}
