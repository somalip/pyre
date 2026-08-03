const lines = [
  "                                                                                              state        bytes_in       bytes_out",
  "apsd.375                                                                                                   5627 B            13 KiB",
  "   tcp4 172.16.0.2:53922<->17.242.13.6:443                                              Established        5627 B            13 KiB",
  "airportd.508                                                                                                  0 B             0 B  ",
  "   udp4 *:*<->*:*"
];

// the previous regex didn't match `udp4 *:*<->*:*`
// let's try a simpler approach: the name is always at the start and space indented.
// then there might be a state like "Established" or "Listen"
// then bytes in, bytes out.
// but it's hard because name could contain spaces? usually not in nettop.

for (const line of lines) {
  if (line.includes('bytes_in')) continue;
  
  // Since columns are space-aligned, we can also split by multiple spaces!
  // wait, a process name shouldn't have multiple spaces. 
  const parts = line.trimStart().split(/\s{2,}/);
  console.log(`PARTS:`, parts);
}
