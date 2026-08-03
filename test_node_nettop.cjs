const { exec } = require('child_process');
console.time('nettop');
exec('nettop -l 1 -J bytes_in,bytes_out,state 2>/dev/null', (err, stdout) => {
  console.timeEnd('nettop');
  console.log("Len:", stdout.length);
});
