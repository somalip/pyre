function parseBytes(str) {
  if (!str) return 0;
  const match = str.trim().match(/([\d.]+)\s*([KMGTPE]?)i?B?/i);
  if (!match) return 0;
  let val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'K') val *= 1024;
  else if (unit === 'M') val *= 1024 * 1024;
  else if (unit === 'G') val *= 1024 * 1024 * 1024;
  else if (unit === 'T') val *= 1024 * 1024 * 1024 * 1024;
  return Math.round(val);
}

const lines = [
  "                                                                                              state        bytes_in       bytes_out",
  "apsd.375                                                                                                   5627 B            13 KiB",
  "   tcp4 172.16.0.2:53922<->17.242.13.6:443                                              Established        5627 B            13 KiB",
  "airportd.508                                                                                                  0 B             0 B  ",
  "   udp4 *:*<->*:*"
];

for (const row of lines) {
  if (!row || row.includes('bytes_in')) continue;
  
  const parts = row.trimStart().split(/\s{2,}/);
  const nameCol = parts[0];
  
  if (!nameCol.includes('<->')) {
    const rx = parseBytes(parts[1]);
    const tx = parseBytes(parts[2]);
    console.log(`PROC: ${nameCol}, rx: ${rx}, tx: ${tx}`);
  } else {
    let state = '';
    let rx = 0;
    let tx = 0;
    if (parts.length === 4) {
      state = parts[1];
      rx = parseBytes(parts[2]);
      tx = parseBytes(parts[3]);
    } else if (parts.length === 3) {
      // maybe state is missing?
      rx = parseBytes(parts[1]);
      tx = parseBytes(parts[2]);
    }
    console.log(`CONN: ${nameCol}, state: ${state}, rx: ${rx}, tx: ${tx}`);
  }
}
