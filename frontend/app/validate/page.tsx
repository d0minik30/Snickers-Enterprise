import type { Metadata } from 'next';
import ValidateScreen from '@/components/locate/ValidateScreen';

export const metadata: Metadata = {
  title: 'Validate · Marsfinder',
};

export default function ValidatePage() {
  return <ValidateScreen />;
}
