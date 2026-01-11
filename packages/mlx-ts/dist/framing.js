export function encodeFrame(msg) {
    const body = Buffer.from(JSON.stringify(msg), "utf8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length, 0);
    return Buffer.concat([header, body]);
}
export function createFrameDecoder(onMessage) {
    let buf = Buffer.alloc(0);
    return (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        while (buf.length >= 4) {
            const len = buf.readUInt32BE(0);
            if (buf.length < 4 + len)
                return;
            const body = buf.subarray(4, 4 + len);
            buf = buf.subarray(4 + len);
            try {
                const msg = JSON.parse(body.toString("utf8"));
                if (msg && typeof msg.type === "string")
                    onMessage(msg);
            }
            catch {
                // ignore malformed frames
            }
        }
    };
}
