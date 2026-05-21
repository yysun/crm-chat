import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const sourcePath = process.argv[2];
const outputPath = process.argv[3];

if (!sourcePath || !outputPath) {
  throw new Error("Usage: node scripts/generate-team0-marp.mjs <crm-actions.json> <out.md>");
}

function firstMatch(value, pattern) {
  return value.match(pattern)?.[1]?.trim() ?? "";
}

function extractSection(part, title, nextTitles) {
  const next = nextTitles.join("|").replaceAll("/", "\\/");
  const pattern = new RegExp(`#### ${title}\\n\\n([\\s\\S]*?)(?=\\n\\n#### (${next})|$)`);
  return part.match(pattern)?.[1]?.trim() ?? "";
}

function stripOrdinal(heading) {
  return heading.replace(/^\d+\.\s*/, "").replace(/\.$/, "").trim();
}

function mdEscape(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

function entityLinks(heading, part) {
  const combined = `${heading}\n${part}`;
  const contactId = firstMatch(combined, /\bcontact\s+(\d+)\b/i);
  const accountId = firstMatch(combined, /\baccount\s+(\d+)\b/i);
  const links = [];

  if (accountId) {
    links.push(`[account ${accountId}](/api/data/accounts/${accountId})`);
  }

  if (contactId) {
    links.push(`[contact ${contactId}](/api/data/contacts/${contactId})`);
  }

  return links.length > 0 ? links.join(" | ") : "No linked account/contact ID found in heading";
}

function parseTeamZero(markdown, sourceRecord) {
  const scopeTeamId = Number(firstMatch(markdown, /- Team ID:\s*(\d+)/));
  if (scopeTeamId !== 0) {
    return [];
  }

  const active = Number(firstMatch(markdown, /- Active actions:\s*(\d+)/));
  const parts = markdown.split(/\n###\s+/).slice(1);
  const slides = [];

  for (const part of parts) {
    const [rawHeading = "", ...rest] = part.split("\n");
    const body = rest.join("\n");
    const heading = rawHeading.trim();
    const displayHeading = stripOrdinal(heading);
    const sourceDate = firstMatch(body, /- Source date:\s*([^\n]+)/);
    const actionsBlock = extractSection(body, "Actions", ["Insight", "Tensions", "Memory"]);
    const insight = extractSection(body, "Insight", ["Tensions", "Memory"]);
    const tensions = extractSection(body, "Tensions", ["Memory"]);
    const memory = extractSection(body, "Memory", []);
    const actions = [...actionsBlock.matchAll(/- \[ \] `([^`]+)`:\s*([^\n]+)/g)];

    if (actions.length === 0) {
      slides.push({
        heading: displayHeading,
        links: entityLinks(heading, body),
        actionLabel: "unparsed action",
        actionText: actionsBlock || "_No action text parsed._",
        insight,
        tensions,
        memory,
        sourceDate,
        sourceRecord,
        active
      });
      continue;
    }

    for (const action of actions) {
      slides.push({
        heading: displayHeading,
        links: entityLinks(heading, body),
        actionLabel: action[1],
        actionText: "- [ ] `" + action[1] + "`: " + action[2].trim(),
        insight,
        tensions,
        memory,
        sourceDate,
        sourceRecord,
        active
      });
    }
  }

  return slides;
}

function slideMarkdown(item, index, total) {
  const sourceLine = [
    `Team 0`,
    `source actionId ${item.sourceRecord.actionId}`,
    item.sourceDate ? `source date ${item.sourceDate}` : "",
    `CRM date 2026-05-20`
  ].filter(Boolean).join(" | ");

  return [
    `<!-- _footer: '${sourceLine.replaceAll("'", "\\'")}' -->`,
    `# ${String(index + 1).padStart(3, "0")} / ${total}: ${item.heading}`,
    "",
    `**Linked record:** ${item.links}`,
    "",
    "**Action label:** `" + item.actionLabel + "`",
    "",
    "## Actions",
    mdEscape(item.actionText),
    "",
    "## Insight",
    mdEscape(item.insight || "_No `Insight` section found in the latest summary artifact._"),
    "",
    "## Tensions",
    mdEscape(item.tensions || "_No `Tensions` section found in the latest summary artifact._"),
    "",
    "## Memory",
    mdEscape(item.memory || "_No `Memory` section found in the latest summary artifact._"),
    "",
  ].join("\n");
}

const raw = JSON.parse(readFileSync(sourcePath, "utf8"));
if (!raw.ok) {
  throw new Error(`CRM source is not ok: ${raw.status} ${raw.statusText}`);
}

const sourceRecords = Array.isArray(raw.body) ? raw.body : [];
const slides = sourceRecords.flatMap((record) => parseTeamZero(record.action ?? "", record));

if (slides.length === 0) {
  throw new Error("No Team 0 action slides were parsed from the CRM source.");
}

const expected = slides[0]?.active;
if (expected && slides.length !== expected) {
  throw new Error(`Parsed ${slides.length} Team 0 action slides, expected ${expected}.`);
}

const deck = [
  "---",
  "marp: true",
  "theme: default",
  "paginate: true",
  "size: 16:9",
  "style: |",
  "  section {",
  "    font-family: Aptos, Arial, sans-serif;",
  "    font-size: 19px;",
  "    line-height: 1.25;",
  "    padding: 34px 44px 46px;",
  "  }",
  "  h1 {",
  "    font-size: 30px;",
  "    margin: 0 0 10px;",
  "  }",
  "  h2 {",
  "    font-size: 19px;",
  "    margin: 12px 0 5px;",
  "  }",
  "  p, ul {",
  "    margin: 4px 0;",
  "  }",
  "  li {",
  "    margin: 2px 0;",
  "  }",
  "  code {",
  "    font-size: 0.9em;",
  "  }",
  "  footer {",
  "    font-size: 10px;",
  "    color: #666;",
  "  }",
  "---",
  "",
  ...slides.flatMap((item, index) => [
    slideMarkdown(item, index, slides.length),
    index < slides.length - 1 ? "---" : "",
    ""
  ])
].join("\n");

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, deck);
console.log(JSON.stringify({ outputPath, slides: slides.length, expected }, null, 2));
