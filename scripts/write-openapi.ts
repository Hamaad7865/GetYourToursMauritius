import { writeFile } from 'node:fs/promises';
import { buildOpenApiDocument } from '../src/lib/openapi/document';

/** Emits a static openapi.json for the mobile team / external tooling. */
async function main(): Promise<void> {
  const doc = buildOpenApiDocument();
  await writeFile('openapi.json', `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  console.log('Wrote openapi.json');
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
