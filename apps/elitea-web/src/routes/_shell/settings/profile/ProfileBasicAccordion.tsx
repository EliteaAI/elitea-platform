/**
 * ProfileBasicAccordion — a lightweight BasicAccordion with title/content props.
 */
import type { ReactNode } from 'react';

import { BasicAccordion, type BasicAccordionProps } from '@/shared/ui/BasicAccordion';

interface ProfileBasicAccordionProps extends Omit<BasicAccordionProps, 'items'> {
  title: ReactNode;
  content: ReactNode;
}

export function ProfileBasicAccordion({ title, content, ...rest }: ProfileBasicAccordionProps) {
  return <BasicAccordion items={[{ title, content }]} {...rest} />;
}
