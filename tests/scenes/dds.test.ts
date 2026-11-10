import { decodeDxt1 } from '../../src/shared/scenes/dds';

function texture(a = 0xf800, b = 0x001f, selectors = 0, width = 4, height = 4): Uint8Array {
    const bytes = new Uint8Array(136), v = new DataView(bytes.buffer);
    for (const [offset, value] of [[0,0x20534444],[4,124],[12,height],[16,width],[76,32],[84,0x31545844]]) v.setUint32(offset, value, true);
    v.setUint16(128,a,true); v.setUint16(130,b,true); v.setUint32(132,selectors,true);
    return bytes;
}
test('decodes known DXT1 endpoints and selectors without modifying retained bytes', () => {
    const bytes = texture(0xf800,0x001f,0b11100100), before = bytes.slice();
    const decoded = decodeDxt1(bytes);
    expect([...decoded.pixels.slice(0,16)]).toEqual([255,0,0,255,0,0,255,255,170,0,85,255,85,0,170,255]);
    expect(bytes).toEqual(before);
});
test('supports DXT1 transparency and partial edge blocks', () => {
    const decoded = decodeDxt1(texture(0,0xffff,0xffffffff,3,2));
    expect(decoded.pixels.length).toBe(24);
    expect([...decoded.pixels]).toEqual(new Array(24).fill(0));
});
test('rejects malformed, truncated and oversized textures before allocation', () => {
    expect(() => decodeDxt1(new Uint8Array(8))).toThrow();
    expect(() => decodeDxt1(texture().slice(0,130))).toThrow('Truncated');
    expect(() => decodeDxt1(texture(0,0,0,9999,9999))).toThrow('large');
    const dxt5 = texture(); dxt5[87] = 53;
    expect(() => decodeDxt1(dxt5)).toThrow('Unsupported');
});
