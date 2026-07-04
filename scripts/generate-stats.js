// Generates custom-branded stat cards (stats.svg, streak.svg, langs.svg)
// using live GitHub data, instead of pulling from the shared
// github-readme-stats / streak-stats public services.
//
// Requires: GH_TOKEN (a PAT with 'read:user' + 'public_repo' scope, stored
// as a repo secret) and GH_USERNAME env vars. Run via GitHub Actions
// (see .github/workflows/update-stats.yml) so it stays fresh automatically.

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.GH_TOKEN;
const USERNAME = process.env.GH_USERNAME;

if (!TOKEN || !USERNAME) {
  console.error("Missing GH_TOKEN or GH_USERNAME env vars.");
  process.exit(1);
}

const BG = "#0D0D0D";
const AMBER = "#F59E0B";
const WHITE = "#FFFFFF";
const GRAY = "#B0B0B0";
const FONT = "IBM Plex Mono, monospace";

const QUERY = `
query ($login: String!) {
  user(login: $login) {
    contributionsCollection {
      totalCommitContributions
      totalIssueContributions
      totalPullRequestContributions
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount } }
      }
    }
    repositories(first: 100, ownerAffiliations: OWNER, isFork: false) {
      totalCount
      nodes {
        stargazerCount
        languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
          edges { size node { name } }
        }
      }
    }
  }
}`;

async function fetchGithubData() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: QUERY, variables: { login: USERNAME } }),
  });
  const json = await res.json();
  if (json.errors) {
    console.error(JSON.stringify(json.errors, null, 2));
    process.exit(1);
  }
  return json.data.user;
}

function computeStreaks(weeks) {
  const days = weeks
    .flatMap((w) => w.contributionDays)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  let longest = 0;
  let running = 0;
  let current = 0;

  for (let i = 0; i < days.length; i++) {
    if (days[i].contributionCount > 0) {
      running++;
      longest = Math.max(longest, running);
    } else {
      running = 0;
    }
  }

  // current streak: walk backward from the most recent day
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].contributionCount > 0) {
      current++;
    } else {
      // allow today to be zero (day not over yet) without breaking streak
      if (i === days.length - 1) continue;
      break;
    }
  }

  return { current, longest };
}

function topLanguages(repos) {
  const totals = {};
  for (const repo of repos) {
    for (const edge of repo.languages.edges) {
      totals[edge.node.name] = (totals[edge.node.name] || 0) + edge.size;
    }
  }
  const sumAll = Object.values(totals).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, size]) => ({ name, pct: ((size / sumAll) * 100).toFixed(1) }));
}

function card(width, height, content) {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="${BG}" stroke="${AMBER}" stroke-width="1.5"/>
  ${content}
</svg>`;
}

function statBlock(x, label, value) {
  return `
  <text x="${x}" y="55" text-anchor="middle" font-family="${FONT}" font-size="30" font-weight="700" fill="${AMBER}">${value}</text>
  <text x="${x}" y="80" text-anchor="middle" font-family="${FONT}" font-size="11" letter-spacing="1" fill="${GRAY}">${label}</text>`;
}

function buildStatsSvg(user) {
  const totalStars = user.repositories.nodes.reduce((a, r) => a + r.stargazerCount, 0);
  const c = user.contributionsCollection;
  const content = `
  <text x="20" y="28" font-family="${FONT}" font-size="13" letter-spacing="2" fill="${WHITE}">// GITHUB STATS</text>
  <line x1="20" y1="38" x2="480" y2="38" stroke="#1A1A1A"/>
  ${statBlock(90, "REPOS", user.repositories.totalCount)}
  ${statBlock(210, "STARS", totalStars)}
  ${statBlock(330, "COMMITS (YR)", c.totalCommitContributions)}
  ${statBlock(450, "PRS", c.totalPullRequestContributions)}`;
  return card(500, 100, content);
}

function buildStreakSvg(user) {
  const c = user.contributionsCollection.contributionCalendar;
  const { current, longest } = computeStreaks(user.contributionsCollection.contributionCalendar.weeks);
  const content = `
  <text x="20" y="28" font-family="${FONT}" font-size="13" letter-spacing="2" fill="${WHITE}">// CONTRIBUTION STREAK</text>
  <line x1="20" y1="38" x2="480" y2="38" stroke="#1A1A1A"/>
  ${statBlock(90, "TOTAL (YR)", c.totalContributions)}
  ${statBlock(250, "CURRENT STREAK", current)}
  ${statBlock(410, "LONGEST STREAK", longest)}`;
  return card(500, 100, content);
}

function buildLangsSvg(user) {
  const langs = topLanguages(user.repositories.nodes);
  let y = 55;
  let rows = "";
  for (const l of langs) {
    rows += `
    <text x="20" y="${y}" font-family="${FONT}" font-size="13" fill="${WHITE}">${l.name}</text>
    <rect x="180" y="${y - 11}" width="${(l.pct / 100) * 260}" height="10" fill="${AMBER}"/>
    <rect x="180" y="${y - 11}" width="260" height="10" fill="none" stroke="#1A1A1A"/>
    <text x="450" y="${y}" font-family="${FONT}" font-size="12" fill="${GRAY}">${l.pct}%</text>`;
    y += 30;
  }
  const content = `
  <text x="20" y="28" font-family="${FONT}" font-size="13" letter-spacing="2" fill="${WHITE}">// TOP LANGUAGES</text>
  <line x1="20" y1="38" x2="480" y2="38" stroke="#1A1A1A"/>
  ${rows}`;
  return card(500, y + 10, content);
}

async function main() {
  const user = await fetchGithubData();
  const outDir = path.join(__dirname, "..", "assets");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "stats.svg"), buildStatsSvg(user));
  fs.writeFileSync(path.join(outDir, "streak.svg"), buildStreakSvg(user));
  fs.writeFileSync(path.join(outDir, "langs.svg"), buildLangsSvg(user));
  console.log("Stat cards generated in /assets");
}

main();
