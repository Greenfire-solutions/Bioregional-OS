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
      ['Back it up', 'Copy that one file somewhere safe'],
      ['Start over with fresh example data', 'npm run seed -- --reset'],
      ['Get it out as a map file', 'curl http://localhost:4180/api/export/geojson > atlas.geojson'],
      ['Refresh reference data', 'npm run update'],
    ],
    note: 'Nothing is uploaded anywhere. Deleting that file deletes your commons.',
  },
  protocol: {
    title: 'How the OS thinks',
    body: [
      ['The full manual', 'docs/PROTOCOL.md'],
      ['How it plugs into other projects', 'docs/INTEROP.md'],
      ['Driving it from Claude Code', 'docs/CLAUDE_CODE.md'],
      ['Are we actually a functioning chapter?', 'Open the "My Place" tab'],
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
