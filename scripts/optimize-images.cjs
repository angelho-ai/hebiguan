// 只產生衍生 WebP，不覆寫原圖。需 sharp；網站執行與部署均不需此套件。
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const config = vm.runInNewContext(script.slice(0, script.indexOf('/* 開價、租金與投報率')) + '\nCONFIG;');
const files = [...new Set([...Object.values(config.MEDIA).flat(), '內湖科技園區.jpeg', 'investment-bg.jpg'])]
  .filter(f => f && /\.jpe?g$/i.test(f));
const destination = path.join(root, 'media', 'optimized');
fs.mkdirSync(destination, { recursive: true });
(async () => {
  const manifest = {};
  let originals = 0, small = 0;
  for (const file of files) {
    const input = path.join(root, 'media', file), meta = await sharp(input).metadata();
    const rotated = meta.orientation >= 5 && meta.orientation <= 8;
    const width = rotated ? meta.height : meta.width, height = rotated ? meta.width : meta.height;
    const variants = [];
    for (const size of new Set([Math.min(640, width), Math.min(1280, width)])) {
      const name = path.basename(file).replace(/\.jpe?g$/i, '') + '-' + size + '.webp';
      const info = await sharp(input).rotate().resize({ width: size, withoutEnlargement: true }).webp({ quality: 80, effort: 5 }).toFile(path.join(destination, name));
      variants.push({ file: 'optimized/' + name, width: info.width });
      if (variants.length === 1) small += info.size;
    }
    manifest[file] = { width, height, variants };
    originals += fs.statSync(input).size;
  }
  fs.writeFileSync(path.join(destination, 'manifest.js'), 'window.HEBIGUAN_IMAGES = ' + JSON.stringify(manifest) + ';\n');
  console.log(JSON.stringify({ photos: files.length, originalKB: Math.round(originals / 1024), smallVariantsKB: Math.round(small / 1024) }));
})().catch(error => { console.error(error); process.exitCode = 1; });
