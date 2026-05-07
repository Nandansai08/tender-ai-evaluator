const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { buildEvaluationReport, extractCriteria, evaluateBidder, summarizeEvaluation } = require("../core.js");

const repoRoot = path.join(__dirname, "..");
let failures = 0;

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function runTest(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error.stack);
  }
}

runTest("extractCriteria returns the four representative tender checks", () => {
  const tenderText = readText("data/tender_sample.txt");
  const criteria = extractCriteria(tenderText);

  assert.equal(criteria.length, 4);
  assert.deepEqual(
    criteria.map((criterion) => criterion.id),
    ["FIN-001", "TECH-001", "COMP-001", "CERT-001"],
  );
});

runTest("Alpha Builders is fully eligible in the sample scenario", () => {
  const criteria = extractCriteria(readText("data/tender_sample.txt"));
  const bidder = readJson("data/bidders/alpha_builders.json");
  const result = evaluateBidder(bidder, criteria);

  assert.equal(result.overall, "Eligible");
  assert.equal(result.summary.eligible, 4);
  assert.equal(result.summary.notEligible, 0);
  assert.equal(result.summary.review, 0);
});

runTest("Bravo Infra is not eligible because core thresholds fail", () => {
  const criteria = extractCriteria(readText("data/tender_sample.txt"));
  const bidder = readJson("data/bidders/bravo_infra.json");
  const result = evaluateBidder(bidder, criteria);

  assert.equal(result.overall, "Not Eligible");

  const turnover = result.criteria.find((criterion) => criterion.title === "Minimum annual turnover");
  const iso = result.criteria.find((criterion) => criterion.title === "ISO 9001 certification");

  assert.equal(turnover.verdict, "Not Eligible");
  assert.equal(iso.verdict, "Not Eligible");
});

runTest("Civic Structures is routed to manual review for ambiguous evidence", () => {
  const criteria = extractCriteria(readText("data/tender_sample.txt"));
  const bidder = readJson("data/bidders/civic_structures.json");
  const result = evaluateBidder(bidder, criteria);

  assert.equal(result.overall, "Needs Manual Review");
  assert.ok(result.summary.review >= 1);

  const turnover = result.criteria.find((criterion) => criterion.title === "Minimum annual turnover");
  assert.equal(turnover.verdict, "Needs Manual Review");
  assert.match(turnover.reason, /Contradictory turnover values/i);
});

runTest("summarizeEvaluation builds a manual-review queue across bidders", () => {
  const criteria = extractCriteria(readText("data/tender_sample.txt"));
  const results = [
    evaluateBidder(readJson("data/bidders/alpha_builders.json"), criteria),
    evaluateBidder(readJson("data/bidders/bravo_infra.json"), criteria),
    evaluateBidder(readJson("data/bidders/civic_structures.json"), criteria),
  ];

  const summary = summarizeEvaluation(results);

  assert.equal(summary.bidders, 3);
  assert.equal(summary.overallEligible, 1);
  assert.equal(summary.overallNotEligible, 1);
  assert.equal(summary.overallReview, 1);
  assert.ok(summary.manualReviewQueue.length >= 1);
  assert.equal(summary.manualReviewQueue[0].bidderName, "Civic Structures Consortium");
});

runTest("buildEvaluationReport produces exportable procurement report data", () => {
  const criteria = extractCriteria(readText("data/tender_sample.txt"));
  const results = [evaluateBidder(readJson("data/bidders/alpha_builders.json"), criteria)];

  const report = buildEvaluationReport({
    tenderSource: "tender_sample.txt",
    criteria,
    results,
    audit: [{ event: "Evaluation executed", detail: "Demo audit entry." }],
    solutionScope: ["Representative mock-data prototype."],
    generatedAt: "2026-05-01T12:00:00.000Z",
  });

  assert.equal(report.tenderSource, "tender_sample.txt");
  assert.equal(report.criteriaExtracted.length, 4);
  assert.equal(report.summary.bidders, 1);
  assert.equal(report.bidderResults[0].bidderName, "Alpha Builders Pvt Ltd");
  assert.equal(report.auditTrail.length, 1);
});

if (failures > 0) {
  process.exitCode = 1;
} else {
  console.log("All evaluator tests passed.");
}
