// Draws site/favicon.ico (16 and 32 px), for browsers and tools that read no SVG icon, from site/icon.svg with
// Chromium. After changing the icon, run it from the repository's root: node scripts/icons.ts. CHROMIUM names another
// Chromium.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const svg = readFileSync("site/icon.svg").toString("base64");
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});

async function draw(size: number): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<body style="margin: 0"><img src="data:image/svg+xml;base64,${svg}" width="${size}" height="${size}" style="display: block"></body>`,
  );
  await page.locator("img").evaluate((img: HTMLImageElement) => img.decode());
  const png = await page.screenshot();
  await page.close();
  return png;
}

// An ICO file with PNG images inside, which every current browser reads.
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(1, 2);
  head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i;
    head.writeUInt8(size, entry);
    head.writeUInt8(size, entry + 1);
    head.writeUInt16LE(1, entry + 4);
    head.writeUInt16LE(32, entry + 6);
    head.writeUInt32LE(png.length, entry + 8);
    head.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([head, ...images.map(({ png }) => png)]);
}

writeFileSync(
  "site/favicon.ico",
  ico([
    { size: 16, png: await draw(16) },
    { size: 32, png: await draw(32) },
  ]),
);
await browser.close();
