/** Decode retained DXT1 artwork for Chromium's canvas. The original DDS bytes stay unchanged. */
export function decodeDxt1(bytes: Uint8Array): { width: number; height: number; pixels: Uint8ClampedArray } {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < 128 || view.getUint32(0, true) !== 0x20534444 ||
        view.getUint32(4, true) !== 124 || view.getUint32(76, true) !== 32 ||
        view.getUint32(84, true) !== 0x31545844) throw new Error('Unsupported scene texture');
    const height = view.getUint32(12, true), width = view.getUint32(16, true);
    if (!width || !height || width > 4096 || height > 4096 || width * height > 8_000_000) throw new Error('Scene texture is too large');
    const blocksX = Math.ceil(width / 4), blocksY = Math.ceil(height / 4);
    if (bytes.byteLength < 128 + blocksX * blocksY * 8) throw new Error('Truncated scene texture');
    const pixels = new Uint8ClampedArray(width * height * 4);
    const rgb = (v: number) => [Math.round((v >> 11 & 31) * 255 / 31), Math.round((v >> 5 & 63) * 255 / 63), Math.round((v & 31) * 255 / 31), 255];
    for (let by = 0; by < blocksY; by++) for (let bx = 0; bx < blocksX; bx++) {
        const offset = 128 + (by * blocksX + bx) * 8;
        const a = view.getUint16(offset, true), b = view.getUint16(offset + 2, true);
        const colors = [rgb(a), rgb(b)];
        if (a > b) {
            colors.push(colors[0].map((v, i) => i === 3 ? 255 : Math.floor((2 * v + colors[1][i]) / 3)));
            colors.push(colors[0].map((v, i) => i === 3 ? 255 : Math.floor((v + 2 * colors[1][i]) / 3)));
        } else {
            colors.push(colors[0].map((v, i) => i === 3 ? 255 : Math.floor((v + colors[1][i]) / 2)), [0, 0, 0, 0]);
        }
        const selectors = view.getUint32(offset + 4, true);
        for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
            const px = bx * 4 + x, py = by * 4 + y;
            if (px < width && py < height) pixels.set(colors[selectors >>> (2 * (y * 4 + x)) & 3], (py * width + px) * 4);
        }
    }
    return { width, height, pixels };
}
