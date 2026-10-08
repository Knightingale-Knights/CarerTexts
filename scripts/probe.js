// Checks that the Bubble Data API field keys in lib/config.js match your app.
// Usage: BUBBLE_API_BASE=... BUBBLE_API_TOKEN=... node scripts/probe.js
const config = require('../lib/config');
const bubble = require('../lib/bubble');

const F = config.fields;

async function main() {
  const constraints = JSON.stringify([{ key: F.date, constraint_type: 'is_not_empty' }]);
  const r = await bubble.request('GET', '/obj/shift', { query: { limit: '1', sort_field: 'Created Date', descending: 'true', constraints } });
  const shift = r && r.response && r.response.results && r.response.results[0];
  if (!shift) {
    console.log('No shift came back. Check BUBBLE_API_BASE, the token, and that the Shift data type is exposed in the Data API.');
    return;
  }
  console.log('Shift keys returned by Bubble:');
  console.log(Object.keys(shift).sort().join('\n'));
  console.log('\nExpected shift fields:');
  for (const k of ['address', 'attendStart', 'attendEnd', 'attended', 'cancelled', 'carer', 'date', 'startTime', 'endTime', 'progressNote']) {
    const present = shift[F[k]] !== undefined;
    console.log(`${present ? 'present ' : 'absent  '} ${k} -> "${F[k]}"`);
  }
  console.log('\n"absent" is normal for empty fields (Bubble omits them). It is a problem only if the key style looks different from the list above.');

  const carerId = bubble.get(shift, F.carer);
  if (carerId) {
    const u = await bubble.getUser(carerId);
    console.log('\nUser keys that mention name or phone:');
    console.log(Object.keys(u || {}).filter((k) => /name|phone/i.test(k)).join('\n'));
  }
  console.log('\nSample address value:', JSON.stringify(bubble.get(shift, F.address)));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
