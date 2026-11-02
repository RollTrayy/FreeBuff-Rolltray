#!/usr/bin/env node
/**
 * Generates the plugin PNG assets (dependency free: tiny rasterizer + zlib PNG writer).
 * Run: node scripts/gen-icons.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDir = join(root, "com.rolltray.midideck.sdPlugin");

const ACCENT = [77, 225, 193];
const ACCENT_SOFT = [138, 180, 255];
const TRACK = [96, 110, 126];
const INK = [19, 23, 28];

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = (() => {
	const table = new Int32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		table[n] = c;
	}
	return table;
})();

function crc32(buffer) {
	let c = -1;
	for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length, 0);
	const typeBuffer = Buffer.from(type, "ascii");
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
	return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
	const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	const stride = width * 4 + 1;
	const raw = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y += 1) {
		raw[y * stride] = 0; // filter: none
		rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
	}
	return Buffer.concat([
		signature,
		pngChunk("IHDR", ihdr),
		pngChunk("IDAT", deflateSync(raw, { level: 9 })),
		pngChunk("IEND", Buffer.alloc(0)),
	]);
}

/* -------------------------------------------------------------- shapes */
// Every shape works in a 0..1 design space, so one scene renders at any size.

const rect = (x, y, w, h, color) => ({
	color,
	hit: (px, py) => px >= x && px <= x + w && py >= y && py <= y + h,
});

const roundRect = (x, y, w, h, r, color) => {
	const cx = x + w / 2;
	const cy = y + h / 2;
	const hw = w / 2 - r;
	const hh = h / 2 - r;
	return {
		color,
		hit: (px, py) => {
			const qx = Math.abs(px - cx) - hw;
			const qy = Math.abs(py - cy) - hh;
			const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
			const inside = Math.min(Math.max(qx, qy), 0);
			return outside + inside - r <= 0;
		},
	};
};

const circle = (cx, cy, r, color) => ({
	color,
	hit: (px, py) => Math.hypot(px - cx, py - cy) <= r,
});

const ring = (cx, cy, r, thickness, color) => ({
	color,
	hit: (px, py) => Math.abs(Math.hypot(px - cx, py - cy) - r) <= thickness / 2,
});

const capsule = (x1, y1, x2, y2, thickness, color) => ({
	color,
	hit: (px, py) => {
		const dx = x2 - x1;
		const dy = y2 - y1;
		const lengthSquared = dx * dx + dy * dy;
		let u = lengthSquared === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lengthSquared;
		u = Math.max(0, Math.min(1, u));
		return Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy)) <= thickness / 2;
	},
});

const polygon = (points, color) => ({
	color,
	hit: (px, py) => {
		let inside = false;
		for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
			const [xi, yi] = points[i];
			const [xj, yj] = points[j];
			if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
		}
		return inside;
	},
});

/* ------------------------------------------------------------- renderer */

const SUBSAMPLES = 4;

function sample(shapes, x, y) {
	let r = 0;
	let g = 0;
	let b = 0;
	let a = 0;
	for (const shape of shapes) {
		if (!shape.hit(x, y)) continue;
		const [sr, sg, sb] = shape.color;
		const sa = (shape.color[3] ?? 255) / 255;
		const da = a / 255;
		const oa = sa + da * (1 - sa);
		if (oa <= 0) {
			r = 0;
			g = 0;
			b = 0;
			a = 0;
			continue;
		}
		r = (sr * sa + r * da * (1 - sa)) / oa;
		g = (sg * sa + g * da * (1 - sa)) / oa;
		b = (sb * sa + b * da * (1 - sa)) / oa;
		a = oa * 255;
	}
	return [r, g, b, a];
}

function render(size, shapes) {
	const out = Buffer.alloc(size * size * 4);
	for (let py = 0; py < size; py += 1) {
		for (let px = 0; px < size; px += 1) {
			let sumR = 0;
			let sumG = 0;
			let sumB = 0;
			let sumA = 0;
			for (let sy = 0; sy < SUBSAMPLES; sy += 1) {
				for (let sx = 0; sx < SUBSAMPLES; sx += 1) {
					const x = (px + (sx + 0.5) / SUBSAMPLES) / size;
					const y = (py + (sy + 0.5) / SUBSAMPLES) / size;
					const [r, g, b, a] = sample(shapes, x, y);
					sumR += (r * a) / 255;
					sumG += (g * a) / 255;
					sumB += (b * a) / 255;
					sumA += a;
				}
			}
			const total = SUBSAMPLES * SUBSAMPLES;
			const index = (py * size + px) * 4;
			if (sumA > 0) {
				const alpha = sumA / total;
				const scale = 255 / sumA;
				out[index] = Math.round(sumR * scale);
				out[index + 1] = Math.round(sumG * scale);
				out[index + 2] = Math.round(sumB * scale);
				out[index + 3] = Math.round(alpha);
			}
		}
	}
	return encodePng(size, size, out);
}

/* --------------------------------------------------------------- scenes */

function pluginScene() {
	const pins = [];
	for (let i = 0; i < 5; i += 1) {
		const angle = ((-54 + i * 27 - 90) * Math.PI) / 180;
		pins.push(
			circle(
				0.5 + 0.132 * Math.cos(angle),
				0.47 + 0.132 * Math.sin(angle),
				0.034,
				i === 2 ? ACCENT_SOFT : ACCENT,
			),
		);
	}
	return [
		roundRect(0.02, 0.02, 0.96, 0.96, 0.22, [...INK, 255]),
		ring(0.5, 0.47, 0.25, 0.045, ACCENT),
		...pins,
		capsule(0.35, 0.79, 0.65, 0.79, 0.045, ACCENT),
	];
}

function categoryScene() {
	return [ring(0.5, 0.5, 0.32, 0.11, ACCENT), circle(0.5, 0.5, 0.11, ACCENT_SOFT)];
}

function noteScene() {
	return [
		circle(0.37, 0.7, 0.135, ACCENT),
		capsule(0.495, 0.7, 0.495, 0.235, 0.075, ACCENT),
		polygon(
			[
				[0.5, 0.2],
				[0.8, 0.31],
				[0.74, 0.44],
				[0.5, 0.37],
			],
			ACCENT,
		),
	];
}

function ccScene() {
	return [
		capsule(0.5, 0.16, 0.5, 0.84, 0.075, TRACK),
		circle(0.5, 0.16, 0.058, TRACK),
		circle(0.5, 0.84, 0.058, TRACK),
		roundRect(0.24, 0.49, 0.52, 0.14, 0.06, ACCENT),
	];
}

function dialScene() {
	return [
		ring(0.5, 0.52, 0.29, 0.09, ACCENT),
		capsule(0.5, 0.52, 0.5, 0.28, 0.09, ACCENT),
		circle(0.5, 0.52, 0.055, ACCENT_SOFT),
	];
}

/* ---------------------------------------------------------------- write */

const outputs = [
	["imgs/plugin/marketplace", pluginScene, [256, 512]],
	["imgs/plugin/category-icon", categoryScene, [28, 56]],
	["imgs/actions/note", noteScene, [72, 144]],
	["imgs/actions/cc", ccScene, [72, 144]],
	["imgs/actions/cc-dial", dialScene, [72, 144]],
];

for (const [relative, scene, sizes] of outputs) {
	const target = join(pluginDir, relative);
	mkdirSync(dirname(target), { recursive: true });
	sizes.forEach((size, i) => {
		const suffix = i === 0 ? "" : `@${i + 1}x`;
		writeFileSync(`${target}${suffix}.png`, render(size, scene()));
	});
	console.log(`✔ ${relative}.png (${sizes.join("px, ")}px)`);
}
