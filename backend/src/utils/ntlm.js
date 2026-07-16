/**
 * Minimal NTLMv2 implementation for WinRM authentication.
 * Builds the three NTLM messages needed for the HTTP handshake.
 */
const crypto = require('crypto');

function buildType1() {
  const buf = Buffer.alloc(40, 0);
  buf.write('NTLMSSP\0', 0, 'ascii');
  buf.writeUInt32LE(1, 8);           // MessageType = 1 (Negotiate)
  buf.writeUInt32LE(0x0000b207, 12); // Flags
  // Domain (empty, offset 40)
  buf.writeUInt16LE(0, 16); buf.writeUInt16LE(0, 18); buf.writeUInt32LE(40, 20);
  // Workstation (empty, offset 40)
  buf.writeUInt16LE(0, 24); buf.writeUInt16LE(0, 26); buf.writeUInt32LE(40, 28);
  // Version: Windows 6.1.7601, revision 15
  buf.writeUInt8(6, 32); buf.writeUInt8(1, 33);
  buf.writeUInt16LE(7601, 34);
  buf.writeUInt8(0x0f, 39);
  return buf;
}

function parseType2(buf) {
  if (buf.length < 32) throw new Error('NTLM Type 2 message too short');
  if (buf.slice(0, 7).toString('ascii') !== 'NTLMSSP') throw new Error('Invalid NTLM Type 2 signature');
  if (buf.readUInt32LE(8) !== 2) throw new Error('Not an NTLM Type 2 message');

  const serverChallenge = buf.slice(24, 32);

  // TargetInfoFields (MS-NLMP 2.2.1.2): Len(2) MaxLen(2) Offset(4), at offset 40.
  // Some minimal/older Type 2 messages omit this block, so fall back to a bare
  // AV_EOL (4 zero bytes) when it isn't present or the offsets don't check out.
  let targetInfo = Buffer.alloc(4, 0);
  if (buf.length >= 48) {
    const len = buf.readUInt16LE(40);
    const offset = buf.readUInt32LE(44);
    if (len > 0 && offset + len <= buf.length) {
      targetInfo = buf.slice(offset, offset + len);
    }
  }

  return { serverChallenge, targetInfo };
}

function buildType3(username, password, domain, serverChallenge, targetInfo = Buffer.alloc(4, 0)) {
  const ntHash    = crypto.createHash('md4').update(Buffer.from(password, 'utf16le')).digest();
  const ntv2Hash  = crypto.createHmac('md5', ntHash)
    .update(Buffer.from((username.toUpperCase() + domain), 'utf16le'))
    .digest();

  const clientChallenge = crypto.randomBytes(8);

  // NTLMv2 blob (zero timestamp is accepted by Windows)
  const blob = Buffer.concat([
    Buffer.from([0x01, 0x01, 0x00, 0x00]), // RespType + HiRespType + Reserved
    Buffer.alloc(4, 0),                     // Reserved
    Buffer.alloc(8, 0),                     // Timestamp (zero)
    clientChallenge,
    Buffer.alloc(4, 0),                     // Reserved
    targetInfo,                             // TargetInfo AV-pairs (from Type 2 challenge; ends in AV_EOL)
  ]);

  const ntProofStr  = crypto.createHmac('md5', ntv2Hash)
    .update(Buffer.concat([serverChallenge, blob])).digest();
  const ntResponse  = Buffer.concat([ntProofStr, blob]);
  const lmResponse  = Buffer.concat([
    crypto.createHmac('md5', ntv2Hash)
      .update(Buffer.concat([serverChallenge, clientChallenge])).digest(),
    clientChallenge,
  ]);

  const domBuf = Buffer.from(domain   || '', 'utf16le');
  const usrBuf = Buffer.from(username || '', 'utf16le');

  const fixedLen = 72;
  let off = fixedLen;
  const lmOff  = off; off += lmResponse.length;
  const ntOff  = off; off += ntResponse.length;
  const domOff = off; off += domBuf.length;
  const usrOff = off; off += usrBuf.length;
  const wsOff  = off;

  const hdr = Buffer.alloc(fixedLen, 0);
  Buffer.from('NTLMSSP\0').copy(hdr, 0);
  hdr.writeUInt32LE(3, 8); // MessageType = 3

  hdr.writeUInt16LE(lmResponse.length, 12); hdr.writeUInt16LE(lmResponse.length, 14); hdr.writeUInt32LE(lmOff,  16);
  hdr.writeUInt16LE(ntResponse.length, 20); hdr.writeUInt16LE(ntResponse.length, 22); hdr.writeUInt32LE(ntOff,  24);
  hdr.writeUInt16LE(domBuf.length,     28); hdr.writeUInt16LE(domBuf.length,     30); hdr.writeUInt32LE(domOff, 32);
  hdr.writeUInt16LE(usrBuf.length,     36); hdr.writeUInt16LE(usrBuf.length,     38); hdr.writeUInt32LE(usrOff, 40);
  hdr.writeUInt16LE(0,                 44); hdr.writeUInt16LE(0,                 46); hdr.writeUInt32LE(wsOff,  48);
  hdr.writeUInt16LE(0,                 52); hdr.writeUInt16LE(0,                 54); hdr.writeUInt32LE(off,    56);
  hdr.writeUInt32LE(0x82880205, 60); // Flags
  hdr.writeUInt8(6, 64); hdr.writeUInt8(1, 65); hdr.writeUInt16LE(7601, 66); hdr.writeUInt8(15, 71);

  return Buffer.concat([hdr, lmResponse, ntResponse, domBuf, usrBuf]);
}

function parseUsername(raw) {
  // DOMAIN\user  →  { username: 'user', domain: 'DOMAIN' }
  // user@domain  →  { username: 'user', domain: 'DOMAIN' }
  // user         →  { username: 'user', domain: ''       }
  if (raw.includes('\\')) {
    const [domain, user] = raw.split('\\');
    return { username: user, domain };
  }
  if (raw.includes('@')) {
    const [user, fqdn] = raw.split('@');
    return { username: user, domain: fqdn.split('.')[0].toUpperCase() };
  }
  return { username: raw, domain: '' };
}

module.exports = { buildType1, parseType2, buildType3, parseUsername };
