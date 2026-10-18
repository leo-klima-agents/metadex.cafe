// Draws favicon.ico (16 and 32 px) and apple-touch-icon.png (180 px) from icon.svg, with Chromium. After changing
// icon.svg, run it from the repository's root: node scripts/icons.ts. Set CHROMIUM to use another Chromium.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const svg = readFileSync("icon.svg").toString("base64");
const browser = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});

// iOS wants an opaque touch icon and rounds its corners itself, so the corners take the tile's colour.
async function draw(size: number, background = "transparent"): Promise<Buffer> {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<body style="margin: 0; background: ${background}"><img src="data:image/svg+xml;base64,${svg}" width="${size}" height="${size}" style="display: block"></body>`,
  );
  await page.locator("img").evaluate((img: HTMLImageElement) => img.decode());
  const png = await page.screenshot({ omitBackground: background === "transparent" });
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
  "favicon.ico",
  ico([
    { size: 16, png: await draw(16) },
    { size: 32, png: await draw(32) },
  ]),
);
writeFileSync("apple-touch-icon.png", await draw(180, "#251a15"));
await browser.close();
