const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ICONS_DIR = path.join(__dirname, '..', 'FrontEnd', 'assets', 'img', 'icons');
const SOURCE = path.join(__dirname, '..', 'FrontEnd', 'assets', 'img', 'SmartBusLogo.jpeg');

if (!fs.existsSync(SOURCE)) {
    console.error('❌ No se encontró el logo:', SOURCE);
    process.exit(1);
}

fs.mkdirSync(ICONS_DIR, { recursive: true });

const sizes = [
    { name: 'icon-72x72.png', size: 72 },
    { name: 'icon-96x96.png', size: 96 },
    { name: 'icon-128x128.png', size: 128 },
    { name: 'icon-144x144.png', size: 144 },
    { name: 'icon-152x152.png', size: 152 },
    { name: 'icon-192x192.png', size: 192 },
    { name: 'icon-384x384.png', size: 384 },
    { name: 'icon-512x512.png', size: 512 },
    { name: 'apple-touch-icon.png', size: 180 },
    { name: 'apple-touch-icon-152x152.png', size: 152 },
    { name: 'msapplication-icon-144x144.png', size: 144 },
    { name: 'mstile-150x150.png', size: 150 },
];

async function generateIcons() {
    for (const { name, size } of sizes) {
        const outputPath = path.join(ICONS_DIR, name);
        await sharp(SOURCE)
            .resize(size, size, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            })
            .png()
            .toFile(outputPath);
        console.log(`✅ ${name} (${size}x${size})`);
    }

    const maskableOutput = path.join(ICONS_DIR, 'icon-512x512-maskable.png');
    await sharp(SOURCE)
        .resize(440, 440, {
            fit: 'contain',
            background: { r: 10, g: 10, b: 10, alpha: 1 }
        })
        .extend({
            top: 36, bottom: 36, left: 36, right: 36,
            background: { r: 10, g: 10, b: 10, alpha: 1 }
        })
        .png()
        .toFile(maskableOutput);
    console.log(`✅ icon-512x512-maskable.png (512x512 maskable)`);

    console.log('\n🎉 Todos los iconos generados en:', ICONS_DIR);
}

generateIcons().catch(err => {
    console.error('❌ Error:', err.message);
    console.log('\n💡 Tip: ejecuta "npm install sharp" primero en BackEnd/');
    process.exit(1);
});
