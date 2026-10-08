import { rm } from 'node:fs/promises';
import { join } from 'node:path';

export interface BuildOptions {
  outdir?: string;
  production?: boolean;
}

const root = join(import.meta.dir, '..');

/** Bundles the extension client and language server into standalone CommonJS files. */
export async function build({
  outdir = join(root, 'dist'),
  production = false,
}: BuildOptions = {}): Promise<void> {
  await rm(outdir, { recursive: true, force: true });
  const result = await Bun.build({
    entrypoints: [join(root, 'src/extension.ts'), join(root, 'src/server/server.ts')],
    outdir,
    naming: '[name].[ext]',
    target: 'node',
    format: 'cjs',
    external: ['vscode'],
    minify: production,
    sourcemap: production ? 'none' : 'linked',
  });
  if (!result.success) {
    throw new AggregateError(result.logs, 'Build failed');
  }
}

if (import.meta.main) {
  const production = process.argv.includes('--production');
  await build({ production });
  console.log(`Built dist/ (${production ? 'production' : 'development'})`);

  if (process.argv.includes('--watch')) {
    const { watch } = await import('node:fs');
    let timer: ReturnType<typeof setTimeout> | undefined;
    watch(join(root, 'src'), { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        build().then(
          () => console.log(`Rebuilt dist/ at ${new Date().toLocaleTimeString()}`),
          (error: unknown) => console.error(error),
        );
      }, 100);
    });
    console.log('Watching src/ for changes...');
  }
}
