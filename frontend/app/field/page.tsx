import type { Metadata } from 'next';
import FieldScreen from '@/components/field/FieldScreen';

export const metadata: Metadata = {
  title: 'Field · Mars Map',
};

export default function FieldPage() {
  return <FieldScreen />;
}
