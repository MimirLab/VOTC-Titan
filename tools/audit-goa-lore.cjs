// Authoring audit only: no model calls, game mutation, player data or runtime rewriting.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const repo = path.resolve(__dirname, '..');
const [baselineArgument, outputArgument] = process.argv.slice(2);
assert(baselineArgument && outputArgument, 'Supply a preserved package and output JSON path.');
const baseline = path.resolve(baselineArgument), output = path.resolve(outputArgument);
assert(output.startsWith(path.join(repo, 'out') + path.sep), 'Keep detailed audit output isolated.');
const read = (root, file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const templates = read(repo, 'public/goaLore/templates.json'), previous = read(baseline, 'public/goaLore/templates.json');
const catalogue = read(repo, 'public/goaLore/catalog.json');
const extension = read(repo, 'public/goaLore/racial-extension.json');
const compositions = read(repo, 'public/goaLore/compositions.json');
const { getEncoding } = require('js-tiktoken'); const encoder = getEncoding('cl100k_base');
const variants = ['male','female','neutral','named'];
const slots = new Set(['name','ancestry_names','controller_name','binding_limits','resolved_magic_aptitudes','resolved_magic_defences','rank','ranked_elements','elemental_powers']);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const canonicalSha = value => crypto.createHash('sha256').update(JSON.stringify(value, Object.keys(value).sort())).digest('hex');
const toneRewrites = new Map();
let attachmentCoverage, essenceCoverage, experienceCoverage;
// Keep earlier reviews intact. A later refinement must prove each authored
// transition, including when this audit starts from an older preserved package.
for (const file of ['revised-tone-authoring.json', 'attachment-tone-authoring.json', 'essence-tone-authoring.json', 'experience-tone-authoring.json', 'full-steering-authoring.json']) {
  if (!fs.existsSync(path.join(repo, 'docs/goa-lore', file))) continue;
  const review = read(repo, 'docs/goa-lore/' + file);
  assert.equal(sha(path.join(repo, 'docs/goa-lore', review.sourcePacket.path)), review.sourcePacket.sha256);
  for (const revision of review.revisions) {
    assert(revision.reason && revision.review, 'Missing semantic review: '+revision.key);
    const transitions = toneRewrites.get(revision.key) || [];
    transitions.push(revision); toneRewrites.set(revision.key, transitions);
  }
}
if (fs.existsSync(path.join(repo, 'docs/goa-lore/attachment-tone-review.json'))) {
  const review = read(repo, 'docs/goa-lore/attachment-tone-review.json');
  const earlier = read(repo, 'docs/goa-lore/revised-tone-review.json');
  const authoring = read(repo, 'docs/goa-lore/attachment-tone-authoring.json');
  const source = path.join(repo, 'docs/goa-lore', review.sourcePacket.path);
  assert.equal(sha(source), review.sourcePacket.sha256);
  assert.deepEqual(review.sourcePacket, authoring.sourcePacket);
  const sections = [...fs.readFileSync(source, 'utf8').matchAll(/^ENTRY (\d+): ([^\n]+)/gm)];
  assert.equal(sections.length, 153);
  assert.equal(review.sourceEntries, sections.length);
  assert.deepEqual(review.sourceDecisions.map(row => [row.sourceEntry, row.title]),
    sections.map(m => [Number(m[1]), m[2].trim()]));
  const ids = review.races.map(row => row.providerId);
  assert.equal(ids.length, 92);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(review.raceProviders, ids.length);
  assert.deepEqual([...ids].sort(), earlier.races.map(row => row.providerId).sort());
  const counts = {}, refined = new Set();
  for (const row of review.races) {
    assert(row.reason && row.modelReview, 'Missing race review: '+row.providerId);
    assert(['subtle','recognizable','strong-pressure'].includes(row.influence));
    counts[row.influence] = (counts[row.influence] || 0) + 1;
    for (const id of row.sourceEntries) assert(sections.some(m => Number(m[1]) === id));
    for (const key of row.refinedKeys) { assert(templates[key]); refined.add(key); }
  }
  assert.deepEqual(counts, review.influenceCounts);
  assert.deepEqual([...refined].sort(), authoring.revisions.map(row => row.key).sort());
  for (const row of review.sourceDecisions) {
    assert(row.decision);
    for (const id of row.relatedActualProviders) assert(ids.includes(id));
  }
  attachmentCoverage = {sourceEntries: sections.length, raceProviders: ids.length,
    refinedCards: refined.size, influenceCounts: counts};
}
if (fs.existsSync(path.join(repo, 'docs/goa-lore/essence-tone-review.json'))) {
  const review = read(repo, 'docs/goa-lore/essence-tone-review.json');
  const previousReview = read(repo, 'docs/goa-lore/' + review.previousReview);
  const authoring = read(repo, 'docs/goa-lore/essence-tone-authoring.json');
  assert.deepEqual(review.sourcePacket, authoring.sourcePacket);
  assert.equal(review.sourceEntries, previousReview.sourceEntries);
  assert.equal(review.sourceEntries, 153);
  assert.deepEqual(review.sourcePriority, authoring.sourcePriority);
  const ids = review.races.map(row => row.providerId);
  assert.equal(ids.length, 92); assert.equal(new Set(ids).size, 92);
  assert.equal(review.raceProviders, ids.length);
  assert.deepEqual([...ids].sort(), previousReview.races.map(row => row.providerId).sort());
  const counts = {}, refined = new Set();
  for (const row of review.races) {
    const prior = previousReview.races.find(value => value.providerId === row.providerId);
    assert.equal(row.influence, prior.influence);
    assert.deepEqual(row.sourceEntries, prior.sourceEntries);
    assert(row.reason && row.decision && row.baselineQuietReview && row.baselinePressureReview &&
      row.attentionExperimentQuietReview && row.attentionExperimentPressureReview && row.attentionExperimentAssessment,
      'Missing full-race comparative review: ' + row.providerId);
    counts[row.influence] = (counts[row.influence] || 0) + 1;
    for (const key of row.refinedKeys) { assert(templates[key]); refined.add(key); }
  }
  assert.deepEqual(counts, review.influenceCounts);
  assert.deepEqual([...refined].sort(), authoring.revisions.map(row => row.key).sort());
  assert.equal(refined.size, 6);
  essenceCoverage = {sourceEntries: review.sourceEntries, raceProviders: ids.length,
    refinedCards: refined.size, influenceCounts: counts};
}
function provesRewrite(key, before, after) {
  const visited = new Set(), pending = [before];
  while (pending.length) {
    const hash = pending.pop();
    if (hash === after) return true;
    if (visited.has(hash)) continue;
    visited.add(hash);
    for (const revision of toneRewrites.get(key) || [])
      if (revision.beforeSha256 === hash) pending.push(revision.afterSha256);
  }
  return false;
}
if (fs.existsSync(path.join(repo, 'docs/goa-lore/experience-tone-review.json'))) {
  const review = read(repo, 'docs/goa-lore/experience-tone-review.json');
  const parent = read(repo, 'docs/goa-lore/' + review.previousReview);
  const authoring = read(repo, 'docs/goa-lore/experience-tone-authoring.json');
  assert.deepEqual(review.sourcePacket, authoring.sourcePacket);
  assert.deepEqual(review.sourcePriority, authoring.sourcePriority);
  assert.equal(review.sourceEntries, parent.sourceEntries);
  assert.equal(review.sourceEntries, 153);
  const ids = review.races.map(row => row.providerId);
  assert.equal(ids.length, 92); assert.equal(new Set(ids).size, 92);
  assert.deepEqual([...ids].sort(), parent.races.map(row => row.providerId).sort());
  const counts = {}, refined = new Set();
  for (const row of review.races) {
    const earlier = parent.races.find(value => value.providerId === row.providerId);
    assert.equal(row.influence, earlier.influence);
    assert.deepEqual(row.sourceEntries, earlier.sourceEntries);
    assert(row.socialReview && row.selfInterestedReview && row.reason && row.decision,
      'Missing experience review: ' + row.providerId);
    counts[row.influence] = (counts[row.influence] || 0) + 1;
    for (const key of row.refinedKeys) { assert(templates[key]); refined.add(key); }
  }
  assert.deepEqual(counts, review.influenceCounts);
  assert.deepEqual([...refined].sort(), authoring.revisions.map(row => row.key).sort());
  assert.equal(authoring.resolverVersion, review.resolverVersion);
  assert(review.study.manuallyReadReplies > 0 && review.study.engineVerified === false);
  experienceCoverage = {sourceEntries: review.sourceEntries, raceProviders: ids.length,
    refinedCards: refined.size, influenceCounts: counts,
    manuallyReadReplies: review.study.manuallyReadReplies};
}
assert.equal(sha(path.join(repo, 'public/goaLore/catalog.json')), sha(path.join(baseline, 'public/goaLore/catalog.json')), 'Imported source must remain intact.');
assert.equal(catalogue.entries.length, 297);
const predicates = require(path.join(repo, 'dist/main/goa/goaRules.js')).GOA_RULES;
const previousPredicates = require(path.join(baseline, 'dist/main/goa/goaRules.js')).GOA_RULES;
const predicateRevisions = new Map();
let fullSteeringCoverage;
if (fs.existsSync(path.join(repo, 'docs/goa-lore/full-steering-authoring.json'))) {
  const authoring = read(repo, 'docs/goa-lore/full-steering-authoring.json');
  const review = read(repo, 'docs/goa-lore/full-steering-review.json');
  assert.deepEqual(review.sourcePacket, authoring.sourcePacket);
  assert.equal(review.resolverVersion, authoring.resolverVersion);
  assert.equal(review.cards.length, 311);
  assert.equal(new Set(review.cards.map(row => row.key)).size, 311);
  assert.deepEqual(review.cards.map(row => row.key).sort(), Object.keys(templates).sort());
  assert.equal(review.manualSemanticReviewedCards, 311);
  assert.equal(review.sourceProvidersFreshlyRead, 265);
  assert.equal(review.historicalCoverageGaps, 0);
  assert.equal(review.warcraftCoverage.rows, 345);
  assert.equal(review.coreCoverage.rows, 294);
  assert.equal(review.study.manuallyReadReplies, 83);
  assert.equal(review.study.engineVerified, false);
  for (const row of review.cards) {
    assert(row.decision && row.resolution && row.baselineSemanticAssessment.note && row.currentInfluenceReview.note && row.currentFlavorReview.note,
      'Missing full-catalogue semantic decision: ' + row.key);
    assert.equal(canonicalSha(templates[row.key]), row.finalTemplateSha256);
  }
  for (const file of authoring.sourceFiles)
    assert.equal(sha(path.join(repo, file.path)), file.afterSha256, 'Undeclared GoA source changes: ' + file.path);
  for (const revision of authoring.predicateRevisions) {
    assert(revision.before && revision.after && revision.reason);
    assert(!predicateRevisions.has(revision.key), 'Duplicate predicate revision: ' + revision.key);
    assert.equal(predicates[revision.key]?.toString(), revision.after, 'Declared predicate does not match: ' + revision.key);
    predicateRevisions.set(revision.key, revision);
  }
  assert.equal(predicateRevisions.size, 5);
  assert.equal(authoring.revisions.length, 8);
  fullSteeringCoverage = {cards:311,availableSourceProviders:265,warcraftCoverage:345,coreCoverage:294,
    refinedCards:8,declaredPredicateRevisions:5,manuallyReadReplies:83,engineVerified:false};
}
assert.deepEqual(Object.keys(predicates).sort(), Object.keys(previousPredicates).sort(), 'Predicate inventory changed.');
const changedPredicates = [];
for (const key of Object.keys(predicates)) {
  const before = previousPredicates[key]?.toString(), after = predicates[key]?.toString();
  if (before === after) continue;
  const revision = predicateRevisions.get(key);
  assert(revision && before === revision.before && after === revision.after, 'Undeclared predicate change: ' + key);
  changedPredicates.push(key);
}
assert.equal(sha(path.join(repo, 'public/goaLore/compositions.json')), sha(path.join(baseline, 'public/goaLore/compositions.json')), 'Complete compositions must remain intact.');
assert.equal(extension.schemaVersion, 1);
const entries = [...catalogue.entries, ...extension.entries];
assert.equal(new Set(entries.map(e=>e.key)).size, entries.length);
assert.deepEqual(Object.keys(templates).sort(), entries.map(e=>e.key).sort());
const decisions = read(repo, 'docs/goa-lore/racial-guidance-decisions.json');
const packetFile = path.join(repo, 'docs/goa-lore', decisions.sourcePacket.path);
assert.equal(sha(packetFile), decisions.sourcePacket.sha256);
assert.equal(extension.sourcePacketSha256, decisions.sourcePacket.sha256);
const sourceSections = [...fs.readFileSync(packetFile, 'utf8').matchAll(/^ENTRY (\d+): ([^\n]+)/gm)];
assert.equal(sourceSections.length, 115);
assert.equal(decisions.entries.length, sourceSections.length);
assert.deepEqual(decisions.entries.map(e=>[e.sourceId,e.title]), sourceSections.map(m=>[m[1],m[2].trim()]));
for (const row of decisions.entries) for (const key of row.runtimeCandidateKeys) assert(templates[key], 'Unknown decision key: '+key);
for (const entry of extension.entries) assert(decisions.entries.some(row=>row.addedKeys.includes(entry.key)), 'Unaccounted extension: '+entry.key);
const rows = entries.map(entry => {
  const t = templates[entry.key], b = previous[entry.key]; assert(t);
  if (catalogue.entries.includes(entry)) assert(b, 'Missing original baseline card');
  for (const group of [t, ...(t.observer ? [t.observer] : [])]) for (const variant of variants) {
    assert.equal(typeof group[variant], 'string'); assert(group[variant].trim());
    for (const match of group[variant].matchAll(/\{([A-Za-z0-9_]+)\}/g)) assert(slots.has(match[1]), entry.key + ': unknown slot ' + match[1]);
    assert(!/\[(?:S|s|poss|obj|be|have)\]/.test(group[variant]), entry.key + ': unresolved authoring macro');
    assert(!/\b(?:She|He|she|he) (?:are|have|know|prefer|value|wield|do|take|feel|choose|notice|remain|lack|gain|seek|perceive|use|shape|carry)\b/.test(group[variant]), entry.key + ': subject agreement');
    if (variant === 'neutral') assert(!/\b(?:They|they) (?:(?:readily|actually) )?(?:is|has|assesses|weighs|treats|considers|guards|serves)\b/.test(group[variant]), entry.key + ': neutral subject agreement');
  }
  // A curator may rewrite a card without indefinitely appending competing prose.
  // Such rewrites require an exact before/after record and a semantic/model review;
  // byte hashes qualify authorship, not the quality of the resulting roleplay.
  if (b) for (const variant of variants) {
    const original = entry.key === 'race_troll_regeneration' && variant === 'neutral' ?
      b[variant].replace(/\bthey meets\b/g,'they meet').replace(/\bThey meets\b/g,'They meet') : b[variant];
    if (!t[variant].startsWith(original)) {
      assert(provesRewrite(entry.key, canonicalSha(b), canonicalSha(t)),
        'No declared authoring path from baseline to candidate: '+entry.key);
    }
    if (b.observer) assert.deepEqual(t.observer,b.observer,'Observer lore changed: '+entry.key);
  }
  return { key:entry.key,kind:entry.kind,subject:entry.subject,added:!b,changed:JSON.stringify(t)!==JSON.stringify(b),requiresFields:entry.requires_fields || [],
    tokenCounts:Object.fromEntries(variants.map(v=>[v,{baseline:b ? encoder.encode(b[v]).length : null,current:encoder.encode(t[v]).length}])), observerVariants:!!t.observer };
});
for (const c of compositions.compositions) for (const variant of variants) {
  assert(c.variants[variant]); for (const m of c.variants[variant].matchAll(/\{([A-Za-z0-9_]+)\}/g)) assert(slots.has(m[1]));
}
const groups = {};
for (const row of rows) { const key = row.kind || 'unspecified'; (groups[key] ||= []).push(row.key); }
const report = { authoringAudit:true,engineVerified:false,sourceCatalogueUnchanged:true,originalPredicatesRetained:changedPredicates.length===0,changedPredicates,declaredPredicateRevisions:[...predicateRevisions.keys()],originalCompositionsRetained:true,declaredToneRewrites:[...toneRewrites.keys()],sourceSectionsAccounted:sourceSections.length,originalCards:catalogue.entries.length,addedCards:extension.entries.length,cardCount:rows.length,mainVariants:rows.length*4,
  attachmentCoverage, essenceCoverage, experienceCoverage, fullSteeringCoverage,
  changedCards:rows.filter(r=>r.changed).map(r=>r.key),compositions:compositions.compositions.map(c=>({key:c.key,requires:c.keys})),
  guidance:'Static coverage, slots, subject agreement and token inventory complement the recorded semantic review; they do not independently verify Warcraft canon or model behavior.',groups,rows };
fs.mkdirSync(path.dirname(output),{recursive:true}); fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({cards:rows.length,variants:report.mainVariants,changedCards:report.changedCards.length,compositions:report.compositions.length,sourceCatalogueUnchanged:true})+'\n');
