/**
 * Brand-logo registry for company tiles, backed by simple-icons.
 *
 * This module is deliberately **only ever loaded dynamically** (see
 * `CompanyLogo`): each icon carries its own SVG path data, so importing the
 * registry eagerly would put ~100KB of logos in the first paint for a purely
 * decorative flourish. Logos resolve a tick after mount and the monogram
 * fallback covers the gap.
 *
 * Coverage is partial by nature — simple-icons removes brands on trademark
 * request, so many large employers (Amazon, Microsoft, Oracle, Salesforce,
 * LinkedIn, Disney, the Big Four) have no icon and will always render as a
 * monogram. That is expected, not a bug.
 */
import {
  siAbbott, siAccenture, siAcer, siAdidas, siAdyen, siAirbnb, siAirtable, siAmd,
  siAmericanairlines, siAngular, siAnthropic, siApollographql, siApple, siArm,
  siAsana, siAsus, siAtlassian, siAuth0, siBaidu, siBankofamerica, siBarclays,
  siBmw, siBoeing, siBose, siBox, siBytedance, siCalendly, siCisco,
  siCloudflare, siCoinbase, siContentful, siCoursera, siDatabricks, siDatadog,
  siDell, siDelta, siDeutschebank, siDhl, siDigitalocean, siDiscord, siDji,
  siDocker, siDoordash, siDropbox, siDuolingo, siEa, siEbay, siEdx, siElastic,
  siEpicgames, siEtsy, siExpedia, siFacebook, siFedex, siFigma, siFirebase,
  siFitbit, siFiverr, siFord, siGarmin, siGhost, siGithub, siGitlab,
  siGlassdoor, siGoldmansachs, siGoogle, siGooglecloud, siGrab, siGrammarly,
  siGreenhouse, siGusto, siHashicorp, siHilton, siHonda, siHsbc, siHubspot,
  siHuawei, siHuggingface, siIndeed, siInfosys, siInstacart, siIntel, siIntuit,
  siKhanacademy, siKickstarter, siKlarna, siLenovo, siLg, siLinear, siLoom,
  siLyft, siMailchimp, siMarriott, siMastercard, siMcdonalds, siMedium, siMerck,
  siMeta, siMiro, siMixpanel, siMongodb, siMonster, siMonzo, siN26, siNeon,
  siNetflix, siNetlify, siNewrelic, siNginx, siNike, siNikon, siNotion,
  siNubank, siNvidia, siOkta, siOneplus, siPagerduty, siPalantir, siPatreon,
  siPaypal, siPaytm, siPeloton, siPinterest, siPlanetscale, siPlaystation,
  siPostgresql, siPrisma, siQualcomm, siRailway, siRakuten, siRazer,
  siRazorpay, siReddit, siRedis, siRender, siRevolut, siRoblox, siRobinhood,
  siRoku, siSamsung, siSanity, siSap, siSentry, siShopee, siShopify, siSiemens,
  siSnapchat, siSnowflake, siSonos, siSony, siSoundcloud, siSpacex, siSplunk,
  siSpotify, siSquare, siSquarespace, siSteam, siStrapi, siStrava, siStripe,
  siSubstack, siSupabase, siSwiggy, siTarget, siTcs, siTesla, siTiktok,
  siToptal, siToyota, siTripadvisor, siTwitch, siTypeform, siUber, siUbisoft,
  siUdemy, siUnity, siUpwork, siUps, siVercel, siVerizon, siVimeo,
  siVolkswagen, siWebflow, siWellsfargo, siWipro, siWise, siWix, siWordpress,
  siX, siXero, siXiaomi, siYelp, siZendesk, siZillow, siZoho, siZomato, siZoom,
} from "simple-icons";

export interface BrandIcon {
  title: string;
  /** SVG path data, drawn in a 24x24 viewBox. */
  path: string;
  /** Brand color, without the leading '#'. */
  hex: string;
}

/**
 * Common legal suffixes and filler words that shouldn't affect a match.
 *
 * Declared before the registration loop below on purpose: `register` calls
 * `normalizeCompany`, which reads this. A `const` is not hoisted, so moving
 * this further down puts it in the temporal dead zone and the module throws
 * as it evaluates — which, for a lazily imported module, surfaces only as
 * every logo quietly falling back to a monogram.
 */
const NOISE =
  /\b(inc|llc|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|nv|ab|oy|as|pty|group|holdings|technologies|technology|labs|laboratories|software|systems|solutions|services|the)\b/g;

/**
 * Keyed by normalized company name (see `normalizeCompany`). Most entries
 * resolve by normalization alone; the aliases below cover names that
 * normalization can't reach — renames (Twitter → X), parent companies
 * (Alphabet → Google), and product-vs-company mismatches (Block → Square).
 */
const REGISTRY: Record<string, BrandIcon> = {};

function register(icon: BrandIcon, ...aliases: string[]) {
  REGISTRY[normalizeCompany(icon.title)] = icon;
  for (const alias of aliases) REGISTRY[normalizeCompany(alias)] = icon;
}

for (const icon of [
  siAbbott, siAccenture, siAcer, siAdidas, siAdyen, siAirbnb, siAirtable, siAmd,
  siAmericanairlines, siAngular, siAnthropic, siApollographql, siApple, siArm,
  siAsana, siAsus, siAtlassian, siAuth0, siBaidu, siBankofamerica, siBarclays,
  siBmw, siBoeing, siBose, siBox, siBytedance, siCalendly, siCisco,
  siCloudflare, siCoinbase, siContentful, siCoursera, siDatabricks, siDatadog,
  siDell, siDelta, siDeutschebank, siDhl, siDigitalocean, siDiscord, siDji,
  siDocker, siDoordash, siDropbox, siDuolingo, siEa, siEbay, siEdx, siElastic,
  siEpicgames, siEtsy, siExpedia, siFacebook, siFedex, siFigma, siFirebase,
  siFitbit, siFiverr, siFord, siGarmin, siGhost, siGithub, siGitlab,
  siGlassdoor, siGoldmansachs, siGoogle, siGooglecloud, siGrab, siGrammarly,
  siGreenhouse, siGusto, siHashicorp, siHilton, siHonda, siHsbc, siHubspot,
  siHuawei, siHuggingface, siIndeed, siInfosys, siInstacart, siIntel, siIntuit,
  siKhanacademy, siKickstarter, siKlarna, siLenovo, siLg, siLinear, siLoom,
  siLyft, siMailchimp, siMarriott, siMastercard, siMcdonalds, siMedium, siMerck,
  siMeta, siMiro, siMixpanel, siMongodb, siMonster, siMonzo, siN26, siNeon,
  siNetflix, siNetlify, siNewrelic, siNginx, siNike, siNikon, siNotion,
  siNubank, siNvidia, siOkta, siOneplus, siPagerduty, siPalantir, siPatreon,
  siPaypal, siPaytm, siPeloton, siPinterest, siPlanetscale, siPlaystation,
  siPostgresql, siPrisma, siQualcomm, siRailway, siRakuten, siRazer,
  siRazorpay, siReddit, siRedis, siRender, siRevolut, siRoblox, siRobinhood,
  siRoku, siSamsung, siSanity, siSap, siSentry, siShopee, siShopify, siSiemens,
  siSnapchat, siSnowflake, siSonos, siSony, siSoundcloud, siSpacex, siSplunk,
  siSpotify, siSquare, siSquarespace, siSteam, siStrapi, siStrava, siStripe,
  siSubstack, siSupabase, siSwiggy, siTarget, siTcs, siTesla, siTiktok,
  siToptal, siToyota, siTripadvisor, siTwitch, siTypeform, siUber, siUbisoft,
  siUdemy, siUnity, siUpwork, siUps, siVercel, siVerizon, siVimeo,
  siVolkswagen, siWebflow, siWellsfargo, siWipro, siWise, siWix, siWordpress,
  siX, siXero, siXiaomi, siYelp, siZendesk, siZillow, siZoho, siZomato, siZoom,
]) {
  register(icon);
}

register(siGoogle, "Alphabet", "Google DeepMind", "DeepMind", "YouTube", "Waymo");
register(siGooglecloud, "GCP", "Google Cloud Platform");
register(siMeta, "Meta Platforms", "Instagram", "WhatsApp", "Reality Labs");
register(siX, "Twitter", "X Corp");
register(siSquare, "Block", "Cash App", "Afterpay");
register(siTcs, "Tata Consultancy Services");
register(siEa, "Electronic Arts");
register(siEpicgames, "Epic");
register(siHuggingface, "HF");
register(siPlaystation, "Sony Interactive Entertainment");
register(siBytedance, "ByteDance");
register(siElastic, "Elasticsearch", "Elastic Search");
register(siPostgresql, "Postgres");
register(siNewrelic, "New Relic");
register(siGoldmansachs, "Goldman");
register(siAtlassian, "Jira", "Confluence", "Trello", "Bitbucket");

/**
 * Folds a user-typed company name to a registry key: case, punctuation,
 * accents, legal suffixes, and spacing all stop mattering, so "Stripe, Inc.",
 * "stripe" and "STRIPE" are one company.
 */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    // NFD splits accents into combining marks, which the filter below drops.
    .normalize("NFD")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(NOISE, " ")
    .replace(/\s+/g, "");
}

/** The brand icon for a company name, or null when there's no match. */
export function lookupBrandIcon(name: string): BrandIcon | null {
  const key = normalizeCompany(name);
  return key ? (REGISTRY[key] ?? null) : null;
}
