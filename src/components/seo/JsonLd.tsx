import { serializeJsonLd } from '@/lib/seo/jsonld';

/** Renders structured data as a JSON-LD <script> (XSS-safe serialization). */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
