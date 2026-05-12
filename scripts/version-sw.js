async function main() {
  const [{ default: fs }, { default: path }] = await Promise.all([
    import('node:fs/promises'),
    import('node:path'),
  ]);
  const swPath = path.join(process.cwd(), 'public', 'sw.js');
  const swContent = await fs.readFile(swPath, 'utf8');
  const version = process.env.VERCEL_GIT_COMMIT_SHA ?? Date.now().toString();
  const cacheName = `perfilio-static-${version}`;
  const cacheDeclarationPattern = /const STATIC_CACHE = '(?:__CACHE_VERSION__|perfilio-static-[^']*)';/;
  const updatedContent = swContent.replace(
    cacheDeclarationPattern,
    `const STATIC_CACHE = '${cacheName}';`
  );

  if (updatedContent === swContent) {
    throw new Error('No se encontró la declaración de STATIC_CACHE en public/sw.js');
  }

  await fs.writeFile(swPath, updatedContent, 'utf8');
}

main().catch((error) => {
  console.error('Error versionando Service Worker:', error);
  process.exit(1);
});
