/**
 * How a profile's skills are laid out: at most eight chips at first (the
 * ones the CV put first), the rest behind "+ N others", and the chips
 * grouped as domains, tools and methods by simple word lists. The
 * grouping only decides where a chip sits on the page: it is never
 * stored, never scored, never shown as a judgement, and a skill no list
 * recognises simply reads as a domain. Pure, tested in skills.test.ts.
 */

export type SkillGroup = "domains" | "tools" | "methods";

/** The order the groups are shown in. */
export const SKILL_GROUPS: readonly SkillGroup[] = ["domains", "tools", "methods"];

/** How many chips the profile shows before "+ N others". */
export const SKILLS_SHOWN = 8;

export type GroupedSkills = Record<SkillGroup, string[]>;

/**
 * Software, languages and platforms, matched as a whole skill or as one
 * of its words ("Excel avancé", "Python 3"). Words that are also
 * ordinary words of a sentence stay out of this list (see WHOLE_TOOLS).
 */
const TOOL_WORDS = new Set([
  "excel", "powerpoint", "outlook", "sharepoint", "onedrive", "vba", "sap", "salesforce", "hubspot",
  "jira", "confluence", "figma", "sketch", "photoshop", "illustrator", "indesign", "lightroom",
  "premiere", "canva", "tableau", "looker", "qlik", "qlikview", "qliksense", "snowflake", "bigquery",
  "redshift", "databricks", "python", "java", "javascript", "typescript", "react", "angular", "vue",
  "svelte", "node", "nodejs", "deno", "sql", "nosql", "postgresql", "postgres", "mysql", "mariadb",
  "mongodb", "oracle", "aws", "azure", "gcp", "docker", "kubernetes", "k8s", "git", "github", "gitlab",
  "bitbucket", "linux", "unix", "terraform", "ansible", "jenkins", "kafka", "spark", "hadoop", "airflow",
  "dbt", "pandas", "numpy", "tensorflow", "pytorch", "keras", "scikit-learn", "sklearn", "c++", "c#",
  "php", "laravel", "symfony", "django", "flask", "fastapi", "spring", "ruby", "rails", "golang", "rust",
  "kotlin", "scala", "html", "css", "sass", "tailwind", "bootstrap", "workday", "successfactors", "adp",
  "cegid", "sage", "quickbooks", "xero", "notion", "slack", "zoom", "trello", "asana", "zapier", "shopify",
  "wordpress", "magento", "prestashop", "matlab", "stata", "spss", "autocad", "solidworks", "catia",
  "revit", "sketchup", "amadeus", "sabre", "galileo", "powerbi", "dynamics", "netsuite", "zendesk",
  "intercom", "mailchimp", "marketo", "pardot", "semrush", "ahrefs", "ga4", "gtm", "matomo", "hotjar",
  "mixpanel", "amplitude", "stripe", "twilio", "sendgrid", "cloudflare", "vercel", "netlify", "heroku",
  "supabase", "firebase", "redis", "elasticsearch", "graphql", "unity", "unreal", "blender", "lucca",
  "payfit", "silae", "talentsoft", "smartrecruiters", "greenhouse", "lever", "welcomekit", "linkedin",
  "indeed", "miro", "lucidchart", "visio", "postman", "swagger", "openapi", "grafana", "prometheus",
  "datadog", "splunk", "kibana", "selenium", "cypress", "playwright", "jest", "vitest", "webpack",
  "vite", "babel", "flutter", "swiftui", "xcode", "android", "ios",
]);

/**
 * Tool names that are ordinary words too ("word", "teams", "go", "r"):
 * they count only when the skill is that name and nothing else, so
 * "go-to-market" and "teams management" stay domains.
 */
const WHOLE_TOOLS = new Set([
  "word", "teams", "access", "go", "r", "c", "swift", "office", "google workspace", "microsoft office",
  "microsoft teams", "microsoft word", "google docs", "google sheets", "sheets", "slides", "power bi",
  "power query", "power apps", "power automate", "google analytics", "google ads", "meta ads",
  "after effects", "final cut", "davinci resolve", "visual studio", "vs code", "spring boot",
  "ruby on rails", "scikit learn", "google cloud", "sage x3", "sap hana", "sap s/4hana", "ms project",
  "microsoft project", "adobe xd", "adobe creative suite", "pack office", "suite office",
]);

/** Shapes only software has: a version suffix ("Python 3"), a file-style suffix (".js", ".NET"). */
const TOOL_PATTERNS: readonly RegExp[] = [/\.(js|ts|net|py)$/i, /(c\+\+|c#|f#)$/i];

/** A regex that matches any of `terms` as whole words, accents and case ignored, so "Écoute active" matches at the start of a skill. */
function anyTerm(terms: readonly string[]): RegExp {
  const escaped = terms.map((term) => term.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join("|")})(?![\\p{L}\\p{N}])`, "iu");
}

/**
 * Ways of working: frameworks, certifications and the verbs of
 * organising a team or a project, in both languages.
 */
const METHOD_PATTERN = anyTerm([
  "agile", "agilité", "scrum", "kanban", "lean", "six sigma", "safe", "itil", "prince2", "pmp", "pmi",
  "okr", "kpi", "tdd", "bdd", "ddd", "devops", "ci/cd", "design thinking", "kaizen", "waterfall",
  "cycle en v", "scrum master", "product owner", "sprint", "rétrospective", "retrospective",
  "ux research", "user research", "a/b testing", "growth hacking", "management", "manager", "gestion",
  "pilotage", "conduite", "animation", "négociation", "negociation", "negotiation", "leadership",
  "coaching", "mentoring", "mentorat", "recrutement", "recruiting", "recruitment", "sourcing",
  "planning", "planification", "organisation", "organization", "communication", "coordination",
  "reporting", "audit", "formation", "training", "facilitation", "budgétisation", "budgeting",
  "forecasting", "prévision", "stratégie", "strategy", "change management", "conduite du changement",
  "project management", "gestion de projet", "time management", "prise de parole", "public speaking",
  "écoute active", "esprit d'équipe", "teamwork", "travail en équipe", "autonomie", "rigueur",
  "adaptabilité", "adaptability", "résolution de problèmes", "problem solving", "prise de décision",
  "decision making", "relation client", "customer relationship", "gestion des conflits",
  "conflict resolution",
]);

function words(skill: string): string[] {
  return skill
    .toLowerCase()
    .split(/[\s/,()&]+/)
    .map((word) => word.replace(/^[^a-z0-9+#.]+|[^a-z0-9+#.]+$/g, ""))
    .filter(Boolean);
}

/** Where one skill sits: tools before methods, so "Jira" never reads as a method; everything else is a domain. */
export function classifySkill(skill: string): SkillGroup {
  const lower = skill.trim().toLowerCase().replace(/\s+/g, " ");
  if (!lower) return "domains";
  if (WHOLE_TOOLS.has(lower) || TOOL_WORDS.has(lower)) return "tools";
  if (TOOL_PATTERNS.some((pattern) => pattern.test(lower))) return "tools";
  if (words(lower).some((word) => TOOL_WORDS.has(word))) return "tools";
  if (METHOD_PATTERN.test(lower)) return "methods";
  return "domains";
}

/** The skills, trimmed and without empties, each under its group, in the CV's order within a group. */
export function groupSkills(skills: readonly string[] | null | undefined): GroupedSkills {
  const groups: GroupedSkills = { domains: [], tools: [], methods: [] };
  for (const raw of skills ?? []) {
    const skill = typeof raw === "string" ? raw.trim() : "";
    if (!skill) continue;
    groups[classifySkill(skill)].push(skill);
  }
  return groups;
}

/** The chips on screen and how many wait behind "+ N others": the first `limit` unless `expanded`. */
export function visibleSkills(
  skills: readonly string[] | null | undefined,
  expanded: boolean,
  limit: number = SKILLS_SHOWN,
): { shown: string[]; hidden: number } {
  const clean = (skills ?? []).map((skill) => (typeof skill === "string" ? skill.trim() : "")).filter(Boolean);
  if (expanded || clean.length <= limit) return { shown: clean, hidden: 0 };
  return { shown: clean.slice(0, Math.max(0, limit)), hidden: clean.length - Math.max(0, limit) };
}
