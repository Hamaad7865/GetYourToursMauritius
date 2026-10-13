'use client';

import NextLink from 'next/link';
import type { ComponentProps } from 'react';
import { localiseHref } from '@/lib/i18n/routing';
import { useLanguage } from './PreferencesProvider';

/**
 * `next/link` that keeps a visitor — and a crawler — in the language of the page they are on.
 *
 * Write the href the English way (`/activities/seaplane`); on a French page it renders as
 * `/fr/activities/seaplane`. The public site imports this instead of `next/link`
 * (tests/unit/locale-link-usage.test.ts enforces it), so a new page links same-language without
 * anyone remembering to call `localePath`. What gets a prefix is decided in one place:
 * `localiseHref` in src/lib/i18n/routing.ts.
 */
export default function Link({ href, ...rest }: ComponentProps<typeof NextLink>) {
  const language = useLanguage();
  return (
    <NextLink href={typeof href === 'string' ? localiseHref(language, href) : href} {...rest} />
  );
}
