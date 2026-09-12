# Running the whole OS by talking to Claude Code

BioRegional OS ships an MCP server. Claude Code picks it up automatically from
`.mcp.json` in the project root, so there is nothing to configure.

## Setup

```
cd "path/to/Bioregional-OS"
claude
```

That's it. Claude Code now has all 49 tools. Try:

> what is the state of the commons?

## What you can ask for

| Ask | What happens |
|---|---|
| "What's the state of the commons?" | Chapter identity, seasonal dashboard, viability test, care gaps, benefit flow |
| "Which quests are blocked and by what?" | Reads every consent and safety gate, names the specific blockers |
| "Locate every place" | Resolves each place against EPA ecoregions and USGS watershed boundaries |
| "Pull the latest water data" | Ingests live USGS gage readings as Hydrological signals |
| "What ecoregions are in this bounding box?" | Queries the same layer the 3D map draws |
| "Find our neighbours" | Searches the Murmurations network and records peers |
| "Propose a decision about X" | Refuses without a Land Seat report — by design |
| "What should we do today?" | `whats_next` — every stage checked, ranked by what blocks other work |
| "Someone brought a need" | Records it, and tracks that they are owed an answer |
| "Close the land access gate on X" | Refuses without evidence and a named reviewer |
| "Advance that project to prototype" | Refuses, with the specific blockers, until it is ready |
| "Record this week's reading" | Says whether it moved toward or away from the target |
| "What can we fix first?" | Runs the Minimum Viable Chapter Test and ranks the failures |

## The guardrails are in the code, not the prompt

Claude cannot route around these, because they live in the engines, not the
system prompt:

- **A council item without a Land Seat report is refused.** Ecological
  observations, downstream effects, uncertainty and red flags are mandatory.
- **An irreversible decision cannot use a light decision method.** It gets
  bounced to supermajority/consensus with an affected-party process.
- **A decision with an open red flag cannot be finalised.**
- **A quest cannot reach the build stage with an open consent gate**, or without
  a named maintenance owner and a defined smallest experiment.
- **A gate closes only on evidence plus a named reviewer.** A boolean is refused.
- **Paid, apprentice, credit and work-trade contributions are refused without
  acknowledged terms.**
- **AI may not decide** membership worth, punishment, project legitimacy, funding
  winners, cultural permission, land rights, safety clearance, the truth of
  contested testimony, or who deserves care. `log_ai_use` rejects those purposes
  outright.
- **Restricted and sacred material is filtered by clearance**, and exports report
  what was withheld rather than silently dropping it.
- **Required fields are enforced centrally**, so a tool call that omits a
  mandatory field is refused the same way for Claude Code, the assistant, the
  REST API and the interface.
- **An indicator without a decision trigger is refused.** Measurement that cannot
  change a decision is decoration.
- **Declining an intake item without a reason is refused.**

Run `npm test` to see all 29 of these exercised.

## Logging

When Claude produces something the chapter will publish or act on, it should call
`log_ai_use` with a named human reviewer. That is a requirement of the protocol,
and the tool refuses an entry with no reviewer.

## Claude Desktop

```
npm run connect -- --install-desktop
```

Writes the server into `~/Library/Application Support/Claude/claude_desktop_config.json`.
Quit and reopen Claude Desktop.

## Any other MCP client

```json
{
  "mcpServers": {
    "bioregional-os": { "command": "node", "args": ["/full/path/to/Bioregional-OS/mcp/server.mjs"] }
  }
}
```

The server is plain JSON-RPC 2.0 over stdio with zero dependencies.
