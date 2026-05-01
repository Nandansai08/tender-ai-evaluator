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
    const criterionResults = criteria.map((criterion) => evaluateCriterion(bidder, criterion));
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
    };
  }

  function evaluateCriterion(bidder, criterion) {
    switch (criterion.id) {
      case "FIN-001":
        return evaluateTurnover(bidder, criterion);
      case "TECH-001":
        return evaluateProjects(bidder, criterion);
      case "COMP-001":
        return evaluateGst(bidder, criterion);
      case "CERT-001":
        return evaluateIso(bidder, criterion);
      default:
        return {
          title: criterion.title,
          criterion: criterion.thresholdLabel,
          verdict: "Needs Manual Review",
          reason: "No rule configured for this criterion.",
          evidence: "N/A",
          document: "N/A",
          logic: "Manual fallback",
        };
    }
  }

  function evaluateTurnover(bidder, criterion) {
    const value = bidder.documents.turnover.valueCrore;
    const confidence = bidder.documents.turnover.confidence;
    const conflicting = bidder.documents.turnover.conflicting;
    const evidence = `INR ${value} crore (confidence ${confidence})`;

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
    };
  }

  function evaluateProjects(bidder, criterion) {
    const projects = bidder.documents.projects;
    const eligibleProjects = projects.filter((project) => project.similarity === "high" && project.completed);
    const borderlineProjects = projects.filter((project) => project.similarity === "medium");

    if (eligibleProjects.length >= criterion.threshold) {
      return {
        title: criterion.title,
        criterion: criterion.thresholdLabel,
        verdict: "Eligible",
        reason: `Bidder has ${eligibleProjects.length} sufficiently similar completed projects.`,
        evidence: eligibleProjects.map((project) => project.name).join(", "),
        document: "Project experience sheet and completion certificates",
        logic: `${eligibleProjects.length} >= ${criterion.threshold}`,
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
    };
  }

  function evaluateGst(bidder, criterion) {
    const gst = bidder.documents.gst;
    if (gst.present && gst.valid) {
      return {
        title: criterion.title,
        criterion: criterion.thresholdLabel,
        verdict: "Eligible",
        reason: "GST certificate is present and valid.",
        evidence: gst.number,
        document: gst.document,
        logic: "Document presence and validity check passed",
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
    };
  }

  function evaluateIso(bidder, criterion) {
    const iso = bidder.documents.iso;

    if (iso.present && iso.valid && iso.confidence >= 0.8) {
      return {
        title: criterion.title,
        criterion: criterion.thresholdLabel,
        verdict: "Eligible",
        reason: "ISO 9001 certificate is present and appears valid.",
        evidence: iso.certificateId,
        document: iso.document,
        logic: "Certificate presence and validity check passed",
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
    };
  }

  const api = {
    extractCriteria,
    evaluateBidder,
    evaluateCriterion,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  globalScope.TenderEvaluatorCore = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
