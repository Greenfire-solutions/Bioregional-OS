#!/usr/bin/env node
// The "I am lost" command. Works from anywhere, always says something useful.
//   npm run help              → the map of everything
//   npm run help map          → help with one topic
import { ROOT, title, step, cmd, info, c, line } from './lib.mjs';

const TOPICS = {
  start: {
    title: 'Getting it running',
    body: [
      ['First time on this computer', 'npm run setup'],
      ['Start it and open the browser', 'npm run os -- --open'],
      ['Stop it', 'Press Control and C in the terminal window'],
      ['It says the port is busy', 'PORT=4190 npm run os'],
      ['Something is broken', 'npm run doctor -- --fix'],
    ],
    note: 'Setup only has to happen once. After that it is always just  npm run os',
  },
  map: {
    title: 'The 3D map',
    body: [
      ['Turn / tilt', 'Hold the right mouse button (or two fingers) and drag'],
      ['Zoom', 'Scroll, or pinch'],
      ['Terrain vs Globe', 'Buttons top-left of the map'],
      ['Level III / Level IV', 'Coarse or fine ecoregion boundaries'],
      ['Relief', 'Raises each ecoregion so you can see the borders in 3D'],
      ['Signals', 'The coloured posts — red is critical, gold is watch, blue is information'],
    ],
    note: 'Gold dots are your places. Green dots are hubs. Hover anything to see what it is.',
  },
  people: {
    title: 'Letting other people in',
    body: [
      ['Show every option, with a QR code', 'npm run connect'],
      ['Let phones on this wifi in', 'npm run os -- --share'],
      ['Stop letting them in', 'Stop the OS (Control + C) and start it without --share'],
    ],
    note: 'Sharing only reaches people already on your wifi. Nothing is published to the internet.',
  },
  ai: {
    title: 'The assistant',
    body: [
      ['Use it from inside the app', 'Add ANTHROPIC_API_KEY to the .env file, then restart'],
      ['Use Claude Code instead (free of that key)', 'cd into this folder and run  claude'],
      ['Use the Claude Desktop app', 'npm run connect -- --install-desktop'],
      ['See what the assistant is allowed to do', 'Open docs/CLAUDE_CODE.md'],
    ],
    note: 'The assistant can read and organize, but it cannot decide legitimacy, rights, funding, ' +
          'cultural permission or care. Those gates are in the code, not just in the instructions.',
  },
  data: {
    title: 'Your data',
    body: [
      ['Where it lives', 'data/commons.db — one file, on this computer'],
      ['Back it up', 'npm run backup'],
      ['Check a backup is really readable', 'npm run backup -- --verify <file>'],
      ['Start over with fresh example data', 'npm run seed -- --reset'],
      ['Get it out as a map file', 'curl http://localhost:4180/api/export/geojson > atlas.geojson'],
      ['Refresh reference data', 'npm run update'],
    ],
    note: 'Nothing is uploaded anywhere. Do not copy commons.db by hand — recent work sits in a ' +
          'separate log file, so a hand copy is usually out of date and gives you no sign of it. ' +
          'npm run backup takes the lot, in one file, while the OS keeps running.',
  },
  today: {
    title: 'Knowing what to do',
    body: [
      ['Open the Today tab', 'It is the first tab, and it is the answer to "what now?"'],
      ['Blocking', 'Other work cannot move until this does'],
      ['Slipped', 'A date the commons committed to has passed'],
      ['Missing', 'The protocol expects this to exist and it does not'],
      ['Every item has a button', 'It opens the exact form that fixes that item'],
      ['From the terminal instead', 'curl -s localhost:4180/api/whats-next'],
    ],
    note: 'Each item quotes the rule it comes from. If you disagree with the rule, the item is wrong — say so.',
  },
  automatic: {
    title: 'What it does on its own',
    body: [
      ['While the OS is running', 'It locates places, refreshes water readings, watches review dates'],
      ['See what it has done', 'curl -s localhost:4180/api/heartbeat'],
      ['Turn it off', 'npm run os -- --no-heartbeat'],
    ],
    note: 'It only runs while the OS is open. That is deliberate — on macOS a background timer ' +
          'cannot read your Desktop and would fail silently, which is worse than not running at all.',
  },
  offline: {
    title: 'Working with no internet',
    body: [
      ['Download the regions you live in', 'npm run data'],
      ['...and the ones next door', 'npm run data -- --near'],
      ['Every ecoregion in the country', 'npm run data -- --all'],
      ['What is downloaded, what is stale', 'npm run data -- --status'],
      ['Prove it reads with the wifi off', 'npm run data -- --offline'],
      ['What is in one', 'docs/LIBRARY.md'],
    ],
    note: 'Each region is about 100 KB — plants, animals, soil, climate, water, hazards and local ' +
          'resources. Stop it with Control + C and run it again whenever; it never refetches ' +
          'anything still current. Threatened species are named but never located, and culture is ' +
          'deliberately not downloaded.',
  },
  protocol: {
    title: 'How the OS thinks',
    body: [
      ['The full manual', 'docs/PROTOCOL.md'],
      ['How it plugs into other projects', 'docs/INTEROP.md'],
      ['Driving it from Claude Code', 'docs/CLAUDE_CODE.md'],
      ['Are we actually a functioning chapter?', 'Open the "My Place" tab'],
      ['Prove the rules really are enforced', 'npm test'],
    ],
    note: 'The OS refuses some things on purpose: a council item without a Land Seat report, ' +
          'a project reaching build with open consent gates, paid work with unacknowledged terms.',
  },
};

const topic = process.argv[2];

if (topic && TOPICS[topic]) {
  const t = TOPICS[topic];
  title(t.title);
  for (const [what, how] of t.body) { console.log(`\n  ${what}`); cmd(how); }
  console.log(`\n  ${c.dim}${t.note}${c.reset}\n`);
} else {
  title('BioRegional OS — what do you need?');
  console.log(`  ${c.dim}Type one of these. You cannot break anything by trying them.${c.reset}\n`);
  for (const [key, t] of Object.entries(TOPICS)) {
    console.log(`  ${c.gold}npm run help ${key.padEnd(9)}${c.reset} ${t.title}`);
  }
  console.log(`\n  ${c.dim}${line()}${c.reset}`);
  step('If you only read one line', '');
  cmd('npm run setup   then   npm run os -- --open');
  console.log(`\n  ${c.dim}Everything runs on this computer. Folder: ${ROOT}${c.reset}\n`);
}
