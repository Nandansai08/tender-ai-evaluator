(function (globalScope) {
  function extractCriteria(text) {
    const normalized = text.replace(/\r/g, "");
    const criteria = [];

    const turnoverMatch = normalized.match(/minimum annual turnover of INR\s*([0-9.]+)\s*crore/i);
    if (turnoverMatch) {
      criteria.push({
        id: "FIN-001",
        title: "Minimum annual turnover",
        category: "Financial",
        type: "threshold",
        mandatory: true,
        threshold: Number(turnoverMatch[1]),
        thresholdLabel: `>= INR ${turnoverMatch[1]} crore`,
        evidenceNeeded: "CA certificate or audited statement",
        reviewTrigger: "Unreadable or conflicting turnover value",
        source: "Clause 4.2",
      });
    }

    const projectMatch = normalized.match(/at least\s*([0-9]+)\s*similar projects completed in the last\s*([0-9]+)\s*years/i);
    if (projectMatch) {
      criteria.push({
        id: "TECH-001",
        title: "Similar project experience",
        category: "Technical",
        type: "count_with_time_window",
        mandatory: true,
        threshold: Number(projectMatch[1]),
        years: Number(projectMatch[2]),
        thresholdLabel: `>= ${projectMatch[1]} projects in ${projectMatch[2]} years`,
        evidenceNeeded: "Completion certificates or work orders",
        reviewTrigger: "Borderline project similarity or missing completion proof",
        source: "Clause 4.3",
      });
    }

    if (/valid GST registration/i.test(normalized)) {
      criteria.push({
        id: "COMP-001",
        title: "Valid GST registration",
        category: "Compliance",
        type: "document_presence",
        mandatory: true,
        thresholdLabel: "GST certificate must be present and valid",
        evidenceNeeded: "GST registration certificate",
        reviewTrigger: "GST number missing or validity not established",
        source: "Clause 5.1",
      });
    }

    if (/ISO\s*9001/i.test(normalized)) {
      criteria.push({
        id: "CERT-001",
        title: "ISO 9001 certification",
        category: "Certification",
        type: "document_presence",
        mandatory: true,
        thresholdLabel: "ISO 9001 certificate required",
        evidenceNeeded: "Valid ISO certificate",
        reviewTrigger: "Certificate unreadable or expired",
        source: "Clause 5.2",
      });
    }

    return criteria;
  }

  function evaluateBidder(bidder, criteria) {
    const criterionResults = criteria.map((criterion) => evaluateCriterion(bidder, criterion, bidder.documentAnalysis));
    const summary = {
      eligible: criterionResults.filter((item) => item.verdict === "Eligible").length,
      notEligible: criterionResults.filter((item) => item.verdict === "Not Eligible").length,
      review: criterionResults.filter((item) => item.verdict === "Needs Manual Review").length,
    };

    let overall = "Eligible";
    if (summary.notEligible > 0) {
      overall = "Not Eligible";
    } else if (summary.review > 0) {
      overall = "Needs Manual Review";
    }

    return {
      bidderName: bidder.bidderName,
      overall,
      summary,
      criteria: criterionResults,
      documentAnalysis: bidder.documentAnalysis,
    };
  }

  function summarizeEvaluation(results) {
    const portfolio = {
      bidders: results.length,
      overallEligible: 0,
      overallNotEligible: 0,
      overallReview: 0,
      criterionEligible: 0,
      criterionNotEligible: 0,
      criterionReview: 0,
      manualReviewQueue: [],
    };

    results.forEach((result) => {
      const effectiveOverall = getEffectiveOverall(result);
      if (effectiveOverall === "Eligible") portfolio.overallEligible += 1;
      if (effectiveOverall === "Not Eligible") portfolio.overallNotEligible += 1;
      if (effectiveOverall === "Needs Manual Review") portfolio.overallReview += 1;

      result.criteria.forEach((criterionResult) => {
        const effectiveVerdict = getEffectiveVerdict(criterionResult);
        if (effectiveVerdict === "Eligible") portfolio.criterionEligible += 1;
        if (effectiveVerdict === "Not Eligible") portfolio.criterionNotEligible += 1;
        if (effectiveVerdict === "Needs Manual Review") {
          portfolio.criterionReview += 1;
          portfolio.manualReviewQueue.push({
            bidderName: result.bidderName,
            title: criterionResult.title,
            reason: getEffectiveReason(criterionResult),
            document: criterionResult.document,
            evidence: criterionResult.evidence,
          });
        }
      });
    });

    return portfolio;
  }

  function buildEvaluationReport(input) {
    const summary = summarizeEvaluation(input.results);

    return {
      generatedAt: input.generatedAt || new Date().toISOString(),
      tenderSource: input.tenderSource || "Unknown tender source",
      tenderVersions: input.tenderVersions || [],
      amendmentHistory: input.amendmentHistory || [],
      criteriaReview: input.criteriaReview || {
        approved: false,
        rejected: false,
        rejectionReason: "",
        note: "",
        updatedAt: null,
      },
      criteriaExtracted: input.criteria.map((criterion) => ({
        id: criterion.id,
        title: criterion.title,
        category: criterion.category,
        mandatory: criterion.mandatory,
        threshold: criterion.thresholdLabel,
        evidenceNeeded: criterion.evidenceNeeded,
        reviewTrigger: criterion.reviewTrigger,
        source: criterion.source,
        originVersion: criterion.originVersion,
        lastModifiedVersion: criterion.lastModifiedVersion,
        amendment: criterion.amendment,
      })),
      summary,
      bidderResults: input.results,
      reviewOverrides: collectReviewOverrides(input.results),
      auditTrail: input.audit || [],
      solutionScope: input.solutionScope || [],
    };
  }

  function collectReviewOverrides(results) {
    const overrides = [];
    results.forEach((result) => {
      result.criteria.forEach((criterionResult) => {
        if (criterionResult.reviewOverride) {
          overrides.push({
            bidderName: result.bidderName,
            criterion: criterionResult.title,
            originalVerdict: criterionResult.verdict,
            verdict: criterionResult.reviewOverride.verdict,
            reason: criterionResult.reviewOverride.reason,
            note: criterionResult.reviewOverride.note,
            updatedAt: criterionResult.reviewOverride.updatedAt,
          });
        }
      });
    });

    return overrides;
  }

  function getEffectiveVerdict(criterionResult) {
    return criterionResult.reviewOverride && criterionResult.reviewOverride.verdict
      ? criterionResult.reviewOverride.verdict
      : criterionResult.verdict;
  }

  function getEffectiveReason(criterionResult) {
    return criterionResult.reviewOverride && criterionResult.reviewOverride.reason
      ? criterionResult.reviewOverride.reason
      : criterionResult.reason;
  }

  function getEffectiveOverall(result) {
    const summary = { eligible: 0, notEligible: 0, review: 0 };
    result.criteria.forEach((criterionResult) => {
      const verdict = getEffectiveVerdict(criterionResult);
      if (verdict === "Eligible") summary.eligible += 1;
      if (verdict === "Not Eligible") summary.notEligible += 1;
      if (verdict === "Needs Manual Review") summary.review += 1;
    });

    if (summary.notEligible > 0) return "Not Eligible";
    if (summary.review > 0) return "Needs Manual Review";
    return "Eligible";
  }

  function evaluateCriterion(bidder, criterion, documentAnalysis = null) {
    switch (criterion.id) {
      case "FIN-001":
        return evaluateTurnover(bidder, criterion, documentAnalysis);
      case "TECH-001":
        return evaluateProjects(bidder, criterion, documentAnalysis);
      case "COMP-001":
        return evaluateGst(bidder, criterion, documentAnalysis);
      case "CERT-001":
        return evaluateIso(bidder, criterion, documentAnalysis);
      default:
        return {
          title: criterion.title,
          criterion: criterion.thresholdLabel,
          verdict: "Needs Manual Review",
          reason: "No rule configured for this criterion.",
          evidence: "N/A",
          document: "N/A",
          logic: "Manual fallback",
          evidenceLocation: null,
        };
    }
  }

  function evaluateTurnover(bidder, criterion, documentAnalysis = null) {
    const value = bidder.documents.turnover.valueCrore;
    const confidence = bidder.documents.turnover.confidence;
    const conflicting = bidder.documents.turnover.conflicting;
    const evidence = `INR ${value} crore (confidence ${confidence})`;
    const evidenceLocation = documentAnalysis ? createEvidenceLocation(bidder.documents.turnover.document, documentAnalysis) : null;

    if (confidence < 0.7 || conflicting) {
      return {
        title: criterion.title,
        criterion: criterion.thresholdLabel,
        verdict: "Needs Manual Review",
        reason: conflicting
          ? "Contradictory turnover values found across financial documents."
          : "Turnover evidence is low-confidence and should not trigger automatic rejection.",
        evidence,
        document: bidder.documents.turnover.document,
        logic: `Threshold ${criterion.thresholdLabel}; confidence gate applied`,
        evidenceLocation,
      };
    }

    if (value >= criterion.threshold) {
      return {
        title: criterion.title,
        criterion: criterion.thresholdLabel,
        verdict: "Eligible",
        reason: "Threshold met using bidder's turnover document.",
        evidence,
        document: bidder.documents.turnover.document,
        logic: `${value} >= ${criterion.threshold}`,
        evidenceLocation,
      };
    }

    return {
      title: criterion.title,
      criterion: criterion.thresholdLabel,
      verdict: "Not Eligible",
      reason: "Turnover is below the tender's minimum threshold.",
      evidence,
      document: bidder.documents.turnover.document,
      logic: `${value} < ${criterion.threshold}`,
      evidenceLocation,
    };
  }

  function evaluateProjects(bidder, criterion, documentAnalysis = null) {
    const projects = bidder.documents.projects;
    const eligibleProjects = projects.filter((project) => project.similarity === "high" && project.completed);
    const borderlineProjects = projects.filter((project) => project.similarity === "medium");
    const evidenceLocation = documentAnalysis ? createEvidenceLocation("Project experience sheet and completion certificates", documentAnalysis) : null;

    if (eligibleProjects.length >= criterion.threshold) {
      return {
        title: criterion.title,
        criterion: criterion.thresholdLabel,
        verdict: "Eligible",
        reason: `Bidder has ${eligibleProjects.length} sufficiently similar completed projects.`,
        evidence: eligibleProjects.map((project) => project.name).join(", "),
        document: "Project experience sheet and completion certificates",
        logic: `${eligibleProjects.length} >= ${criterion.threshold}`,
        evidenceLocation,
      };
    }

    if (eligibleProjects.length + borderlineProjects.length >= criterion.threshold) {
      return {
        title: criterion.title,
        criterion: criterion.thresholdLabel,
        verdict: "Needs Manual Review",
        reason: "Some claimed projects are only partially similar and require reviewer confirmation.",
        evidence: projects.map((project) => `${project.name} (${project.similarity})`).join(", "),
        document: "Project experience sheet and completion certificates",
        logic: "Borderline semantic match on prior work scope",
        evidenceLocation,
      };
    }

    return {
      title: criterion.title,
      criterion: criterion.thresholdLabel,
      verdict: "Not Eligible",
      reason: "Bidder does not meet the minimum count of similar completed projects.",
      evidence: projects.map((project) => `${project.name} (${project.similarity})`).join(", "),
      document: "Project experience sheet and completion certificates",
      logic: `${eligibleProjects.length} < ${criterion.threshold}`,
      evidenceLocation,
    };
  }

  function evaluateGst(bidder, criterion, documentAnalysis = null) {
    const gst = bidder.documents.gst;
    const evidenceLocation = documentAnalysis ? createEvidenceLocation(gst.document, documentAnalysis) : null;

    if (gst.present && gst.valid) {
      return {
        title: criterion.title,
        criterion: criterion.thresholdLabel,
        verdict: "Eligible",
        reason: "GST certificate is present and valid.",
        evidence: gst.number,
        document: gst.document,
        logic: "Document presence and validity check passed",
        evidenceLocation,
      };
    }

    if (gst.present && !gst.valid) {
      return {
        title: criterion.title,
        criterion: criterion.thresholdLabel,
        verdict: "Needs Manual Review",
        reason: "GST document is present, but validity could not be established with confidence.",
        evidence: gst.number || "GST number not confidently extracted",
        document: gst.document,
        logic: "Manual validation required",
        evidenceLocation,
      };
    }

    return {
      title: criterion.title,
      criterion: criterion.thresholdLabel,
      verdict: "Not Eligible",
      reason: "Mandatory GST registration document is missing.",
      evidence: "No GST evidence found",
      document: "N/A",
      logic: "Mandatory compliance document not found",
      evidenceLocation,
    };
  }

  function evaluateIso(bidder, criterion, documentAnalysis = null) {
    const iso = bidder.documents.iso;
    const evidenceLocation = documentAnalysis ? createEvidenceLocation(iso.document, documentAnalysis) : null;

    if (iso.present && iso.valid && iso.confidence >= 0.8) {
      return {
        title: criterion.title,
        criterion: criterion.thresholdLabel,
        verdict: "Eligible",
        reason: "ISO 9001 certificate is present and appears valid.",
        evidence: iso.certificateId,
        document: iso.document,
        logic: "Certificate presence and validity check passed",
        evidenceLocation,
      };
    }

    if (iso.present) {
      return {
        title: criterion.title,
        criterion: criterion.thresholdLabel,
        verdict: "Needs Manual Review",
        reason: "ISO certificate exists, but validity or OCR confidence is insufficient for automatic acceptance.",
        evidence: iso.certificateId || "Certificate ID unclear",
        document: iso.document,
        logic: "Confidence gate applied to certification evidence",
        evidenceLocation,
      };
    }

    return {
      title: criterion.title,
      criterion: criterion.thresholdLabel,
      verdict: "Not Eligible",
      reason: "Mandatory ISO 9001 certificate is missing.",
      evidence: "No ISO evidence found",
      document: "N/A",
      logic: "Mandatory certification missing",
      evidenceLocation,
    };
  }

  function createEvidenceLocation(documentName, documentAnalysis) {
    if (!documentAnalysis) return null;
    
    // For documents with page data (Azure OCR, synthetic pages from word extraction)
    if (documentAnalysis.pages && documentAnalysis.pages.length > 0) {
      const firstPage = documentAnalysis.pages[0];
      return {
        documentName: documentAnalysis.documentName || documentName,
        page: firstPage.pageNumber || 1,
        pageRange: documentAnalysis.pages.length > 1 
          ? `${firstPage.pageNumber}-${documentAnalysis.pages[documentAnalysis.pages.length - 1].pageNumber}`
          : String(firstPage.pageNumber),
        extractionMode: documentAnalysis.extractionMode,
        locationType: "page-range",
      };
    }

    // Fallback for documents without page data
    return {
      documentName: documentAnalysis.documentName || documentName,
      page: "N/A",
      pageRange: documentAnalysis.paragraphCount 
        ? `${documentAnalysis.paragraphCount} paragraphs` 
        : "document",
      extractionMode: documentAnalysis.extractionMode,
      locationType: "paragraph-count",
    };
  }

  const api = {
    buildEvaluationReport,
    extractCriteria,
    evaluateBidder,
    evaluateCriterion,
    getEffectiveVerdict,
    summarizeEvaluation,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.TenderEvaluatorCore = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
