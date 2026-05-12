/**
 * Genera iconos PWA (192 y 512): logo.png centrado sobre fondo navy con esquinas redondeadas.
 * Requiere `sharp` resoluble desde Node (p. ej. dependencia transitiva de Next).
 */
function cornerRadius(size) {
  return Math.round(size * 0.22);
}

function roundedNavySvg(size) {
  const r = cornerRadius(size);
  return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#1a365d"/>
</svg>`;
}

async function writePng(sharp, logoPath, size, outPath) {
  const maxLogo = Math.round(size * 0.75);
  const bg = await sharp(Buffer.from(roundedNavySvg(size))).png().toBuffer();

  const logoLayer = await sharp(logoPath)
    .resize({
      width: maxLogo,
      height: maxLogo,
      fit: 'inside',
    })
    .toBuffer();

  await sharp(bg)
    .composite([{ input: logoLayer, gravity: 'center' }])
    .png()
    .toFile(outPath);
}

async function main() {
  const [{ default: path }, { default: sharp }] = await Promise.all([
    import('node:path'),
    import('sharp'),
  ]);
  const root = path.join(process.cwd());
  const logoPath = path.join(root, 'public', 'logo.png');
  const iconsDir = path.join(root, 'public', 'icons');

  await writePng(sharp, logoPath, 192, path.join(iconsDir, 'icon-192x192.png'));
  await writePng(sharp, logoPath, 512, path.join(iconsDir, 'icon-512x512.png'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
